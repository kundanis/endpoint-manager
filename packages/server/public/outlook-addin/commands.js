// Endpoint Manager — PII Attachment Guard (Outlook "OnMessageSend" add-in)
//
// Runs entirely inside Outlook's own sandboxed add-in runtime, on the OnMessageSend event —
// i.e. every attachment's content is read and scanned right here, in the user's own Outlook
// client, and NEVER leaves it. Only two things ever get sent to this app's server:
//   1. A policy lookup, keyed by the signed-in user's own email address (Office.js hands us
//      that directly — no login flow needed), asking "which PII categories should I check
//      for on this mailbox?"
//   2. A best-effort event report AFTER a block, naming only the matched category labels
//      (e.g. "Credit/debit card number") — never the attachment content or the matched text
//      itself. See PiiEmailBlockEvent's own schema comment for the same discipline.
//
// FAIL-OPEN BY DESIGN: any unexpected error here (a network hiccup reaching this server, a
// parsing failure, anything) must never be able to block someone's email organization-wide.
// Every code path below that can throw is wrapped so a failure always falls through to
// allowing the send — see the try/catch in onMessageSendHandler.

(function () {
  "use strict";

  // Injected ahead of this file by the server (src/emailAddinScript.ts). Classic Outlook on
  // Windows runs this file with no page origin, so every server call must be absolute.
  var BASE_URL = typeof EM_ADDIN_BASE_URL === "string" ? EM_ADDIN_BASE_URL : "";

  // Mirrors packages/shared/src/data/piiPatterns.ts's PII_PATTERN_CATALOG — duplicated here
  // (not imported) because this file ships to Outlook's runtime as a standalone script, not
  // through this monorepo's own bundler. Keep the two in sync if a pattern ever changes.
  var PII_PATTERN_CATALOG = [
    { key: "EMAIL", label: "Email address", pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}" },
    { key: "PHONE_INDIA", label: "Indian mobile number", pattern: "(?<!\\d)(?:\\+?91[-\\s]?)?[6-9]\\d{9}(?!\\d)" },
    { key: "PHONE_GENERIC", label: "International phone number", pattern: "(?<!\\d)\\+\\d{7,14}(?!\\d)" },
    { key: "CREDIT_CARD", label: "Credit/debit card number", pattern: "(?<!\\d)(?:\\d[ -]?){13,16}(?!\\d)" },
    { key: "IP_ADDRESS", label: "IP address", pattern: "(?<!\\d)(?:\\d{1,3}\\.){3}\\d{1,3}(?!\\d)" },
    { key: "IBAN", label: "IBAN (bank account)", pattern: "(?<![A-Z0-9])[A-Z]{2}\\d{2}[A-Z0-9]{10,30}(?![A-Z0-9])" },
    { key: "AADHAAR", label: "Aadhaar number", pattern: "(?<!\\d)[2-9]\\d{3}[ -]?\\d{4}[ -]?\\d{4}(?!\\d)" },
    { key: "PAN_INDIA", label: "PAN (Permanent Account Number)", pattern: "(?<![A-Z0-9])[A-Z]{5}\\d{4}[A-Z](?![A-Z0-9])" },
    { key: "PASSPORT_INDIA", label: "Indian passport number", pattern: "(?<![A-Z0-9])[A-PR-WYa-pr-wy]\\d{7}(?![A-Z0-9])" },
    { key: "GSTIN", label: "GSTIN (GST Identification Number)", pattern: "(?<![A-Z0-9])\\d{2}[A-Z]{5}\\d{4}[A-Z]\\d[Zz][A-Z\\d](?![A-Z0-9])" },
    { key: "IFSC_CODE", label: "IFSC code (bank branch)", pattern: "(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])" },
  ];

  // Extensions whose bytes are already plain text — decoded and scanned directly.
  var TEXT_EXTENSIONS = [".txt", ".csv", ".json", ".xml", ".html", ".htm", ".md", ".log", ".rtf"];
  // Office Open XML formats — ZIP containers; unzipped via JSZip and their text-bearing
  // parts (document body, spreadsheet strings, slide text) are extracted and scanned.
  var OOXML_EXTENSIONS = [".docx", ".xlsx", ".pptx"];
  // Parts inside an OOXML zip that actually carry visible text.
  var OOXML_TEXT_PART_PATTERN = /^(word\/document\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/.*\.xml|ppt\/slides\/slide\d+\.xml)$/;

  function getExtension(filename) {
    var idx = filename.lastIndexOf(".");
    return idx === -1 ? "" : filename.slice(idx).toLowerCase();
  }

  // Narrows CREDIT_CARD's loose digit-run match with a Luhn checksum — same reasoning as
  // this product's agent-side DLP scanner (see piiPatterns.ts's own comment on that rule).
  function passesLuhn(candidate) {
    // Strips everything but digits — not just [ -] — since compilePattern's fallback form
    // can include the one boundary character before the number in the match.
    var digitsOnly = candidate.replace(/\D/g, "");
    var sum = 0;
    var alt = false;
    for (var i = digitsOnly.length - 1; i >= 0; i--) {
      var d = parseInt(digitsOnly.charAt(i), 10);
      if (alt) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  // Every catalog pattern opens with a single-character-class negative lookbehind
  // ((?<!\d) or (?<![A-Z0-9])). Not every JavaScript engine Outlook runs add-ins on is
  // guaranteed to support lookbehind, and a pattern that fails to compile is skipped — which
  // would silently disable that category. So on a compile failure, retry with the
  // lookbehind rewritten as "start of text, or one character outside that class". The
  // rewritten form can consume that one preceding character, which only matters for
  // CREDIT_CARD's Luhn check (handled in passesLuhn).
  var LEADING_LOOKBEHIND = /^\(\?<!(\\d|\[[^\]]+\])\)/;

  function compilePattern(source) {
    try {
      return new RegExp(source, "g");
    } catch (e) {
      var m = LEADING_LOOKBEHIND.exec(source);
      if (!m) return null;
      var negated = m[1] === "\\d" ? "\\D" : "[^" + m[1].slice(1, -1) + "]";
      try {
        return new RegExp("(?:^|" + negated + ")" + source.slice(m[0].length), "g");
      } catch (e2) {
        return null;
      }
    }
  }

  // Returns the sorted, deduped list of category labels found in `text` among `patternKeys`.
  function findMatches(text, patternKeys) {
    var found = [];
    for (var i = 0; i < PII_PATTERN_CATALOG.length; i++) {
      var def = PII_PATTERN_CATALOG[i];
      if (patternKeys.indexOf(def.key) === -1) continue;
      var re = compilePattern(def.pattern);
      if (!re) continue; // A pattern this runtime's regex engine can't compile is skipped, not fatal.
      var match;
      while ((match = re.exec(text)) !== null) {
        if (def.key === "CREDIT_CARD" && !passesLuhn(match[0])) continue;
        if (found.indexOf(def.label) === -1) found.push(def.label);
        break; // One hit per category is enough to flag the attachment.
      }
    }
    return found;
  }

  function stripXmlTags(xml) {
    return xml.replace(/<[^>]+>/g, " ");
  }

  // Unzips an OOXML attachment (.docx/.xlsx/.pptx) and concatenates the text-bearing parts.
  // Any failure here (corrupt file, unexpected format) resolves to "" — an attachment we
  // can't parse is simply not scanned, never treated as a block (fail-open, see file header).
  function extractOoxmlText(base64Content) {
    return JSZip.loadAsync(base64Content, { base64: true })
      .then(function (zip) {
        var names = Object.keys(zip.files).filter(function (name) {
          return OOXML_TEXT_PART_PATTERN.test(name);
        });
        return Promise.all(
          names.map(function (name) {
            return zip.files[name].async("string");
          }),
        );
      })
      .then(function (parts) {
        return stripXmlTags(parts.join(" "));
      })
      .catch(function () {
        return "";
      });
  }

  var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  // atob isn't guaranteed in classic Outlook's JavaScript-only runtime — decode by hand there.
  function base64ToBinaryString(base64Content) {
    if (typeof atob === "function") return atob(base64Content);
    var clean = base64Content.replace(/[^A-Za-z0-9+/]/g, "");
    var out = "";
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < clean.length; i++) {
      buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(clean.charAt(i));
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((buffer >> bits) & 0xff);
      }
    }
    return out;
  }

  function base64ToUtf8(base64Content) {
    try {
      // base64 -> binary string -> UTF-8 decode, so multi-byte characters survive intact.
      var binary = base64ToBinaryString(base64Content);
      if (typeof TextDecoder === "function") {
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder("utf-8").decode(bytes);
      }
      try {
        return decodeURIComponent(escape(binary));
      } catch (e) {
        return binary; // Not valid UTF-8 — scan the raw bytes rather than nothing.
      }
    } catch (e) {
      return "";
    }
  }

  // Minimal JSON-over-HTTP helper: fetch where the runtime has it, XMLHttpRequest otherwise.
  // Resolves to { ok, body } and rejects only on a network-level failure.
  function requestJson(method, url, payload) {
    var headers = payload === undefined ? {} : { "Content-Type": "application/json" };
    var body = payload === undefined ? undefined : JSON.stringify(payload);
    if (typeof fetch === "function") {
      return fetch(url, { method: method, headers: headers, body: body }).then(function (res) {
        if (!res.ok || res.status === 204) return { ok: res.ok, body: null };
        return res.json().then(function (json) {
          return { ok: true, body: json };
        });
      });
    }
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      for (var h in headers) xhr.setRequestHeader(h, headers[h]);
      xhr.onload = function () {
        var ok = xhr.status >= 200 && xhr.status < 300;
        var json = null;
        if (ok && xhr.responseText) {
          try {
            json = JSON.parse(xhr.responseText);
          } catch (e) {
            ok = false;
          }
        }
        resolve({ ok: ok, body: json });
      };
      xhr.onerror = function () {
        reject(new Error("network error"));
      };
      xhr.send(body === undefined ? null : body);
    });
  }

  // Resolves to "" for any attachment type this add-in doesn't know how to read text out of
  // (images, PDFs, legacy .doc/.xls/.ppt, zip files, cloud-attached files with no inline
  // content) — those are allowed through unscanned rather than blocked, a deliberate
  // fail-open choice documented in docs/email-attachment-blocking.md.
  function extractText(attachmentName, base64Content) {
    var ext = getExtension(attachmentName);
    if (OOXML_EXTENSIONS.indexOf(ext) !== -1) return extractOoxmlText(base64Content);
    if (TEXT_EXTENSIONS.indexOf(ext) !== -1) return Promise.resolve(base64ToUtf8(base64Content));
    return Promise.resolve("");
  }

  function getAttachmentsAsync() {
    return new Promise(function (resolve) {
      Office.context.mailbox.item.getAttachmentsAsync(function (result) {
        resolve(result.status === Office.AsyncResultStatus.Succeeded ? result.value : []);
      });
    });
  }

  function getAttachmentContentAsync(attachmentId) {
    return new Promise(function (resolve) {
      Office.context.mailbox.item.getAttachmentContentAsync(attachmentId, function (result) {
        resolve(result.status === Office.AsyncResultStatus.Succeeded ? result.value : null);
      });
    });
  }

  function fetchPatternKeysForCurrentUser() {
    var email = Office.context.mailbox.userProfile.emailAddress;
    return requestJson("GET", BASE_URL + "/api/email-addin/policy?email=" + encodeURIComponent(email)).then(
      function (res) {
        var keys = res.ok && res.body && res.body.patternKeys;
        return { email: email, patternKeys: keys || [] };
      },
    );
  }

  // Fire-and-forget — a logging failure must never affect the send decision, which has
  // already been made by the time this is called.
  function reportEvent(senderEmail, attachmentName, action, matchedCategoryLabels) {
    try {
      requestJson("POST", BASE_URL + "/api/email-addin/event", {
        senderEmail: senderEmail,
        attachmentName: attachmentName,
        action: action,
        matchedCategoryLabels: matchedCategoryLabels,
      }).catch(function () {});
    } catch (e) {
      // Ignore — see function comment.
    }
  }

  function onMessageSendHandler(event) {
    fetchPatternKeysForCurrentUser()
      .then(function (ctx) {
        if (ctx.patternKeys.length === 0) {
          // No policy assigned to this mailbox at all — nothing to check.
          event.completed({ allowEvent: true });
          return;
        }

        getAttachmentsAsync()
          .then(function (attachments) {
            var real = attachments.filter(function (a) {
              // "cloud" attachments (OneDrive/SharePoint links) have no inline content to
              // read here — Outlook only shares a link, not the file — so they're skipped
              // (fail-open, same as any other unscannable attachment type).
              return a.attachmentType !== "cloud";
            });
            if (real.length === 0) {
              event.completed({ allowEvent: true });
              return;
            }

            Promise.all(
              real.map(function (a) {
                return getAttachmentContentAsync(a.id).then(function (content) {
                  if (!content || content.format !== Office.MailboxEnums.AttachmentContentFormat.Base64) return "";
                  return extractText(a.name, content.content);
                });
              }),
            )
              .then(function (texts) {
                var matched = findMatches(texts.join(" \n "), ctx.patternKeys);
                if (matched.length > 0) {
                  var names = real.map(function (a) { return a.name; }).join(", ");
                  reportEvent(ctx.email, names, "BLOCKED", matched);
                  event.completed({
                    allowEvent: false,
                    errorMessage:
                      "This email was blocked: an attachment appears to contain " +
                      matched.join(", ") +
                      ". Remove or redact it, then resend.",
                  });
                } else {
                  event.completed({ allowEvent: true });
                }
              })
              .catch(function () {
                // Scanning failed partway through (e.g. a malformed attachment) — fail open.
                event.completed({ allowEvent: true });
              });
          })
          .catch(function () {
            event.completed({ allowEvent: true });
          });
      })
      .catch(function () {
        // Couldn't even reach the policy endpoint (server down, network issue) — fail open
        // rather than block every send in the organization on an infrastructure hiccup.
        event.completed({ allowEvent: true });
      });
  }

  Office.actions.associate("onMessageSendHandler", onMessageSendHandler);
})();
