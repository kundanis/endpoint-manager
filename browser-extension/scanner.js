// Endpoint IQ Browser Guard - personal-data scanner (email attachments, and AI prompts for AI Guard). Reads a file's text inside the browser (it never
// leaves the device) and returns the personal-data categories found among the ones the policy
// asks for. Same catalogue, file types and rules as the Outlook add-in
// (packages/server/public/outlook-addin/commands.js) and packages/shared/src/data/piiPatterns.ts -
// keep them in sync. PDFs are read with pdf.js (loaded on first use); scanned PDFs with no text
// layer, images, legacy .doc/.xls and archives are allowed through unscanned.

/* global JSZip, pdfjsLib */
(function () {
  "use strict";

  const PII_PATTERN_CATALOG = [
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

  const TEXT_EXTENSIONS = [".txt", ".csv", ".json", ".xml", ".html", ".htm", ".md", ".log", ".rtf"];
  const OOXML_EXTENSIONS = [".docx", ".xlsx", ".pptx"];
  const OOXML_TEXT_PART_PATTERN = /^(word\/document\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/.*\.xml|ppt\/slides\/slide\d+\.xml)$/;
  const MAX_SCAN_BYTES = 25 * 1024 * 1024; // Gmail's own attachment limit
  const MAX_PDF_PAGES = 300;

  function extensionOf(name) {
    const i = name.lastIndexOf(".");
    return i === -1 ? "" : name.slice(i).toLowerCase();
  }

  function passesLuhn(candidate) {
    const digits = candidate.replace(/\D/g, "");
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = Number(digits[i]);
      if (alt) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function findMatches(text, patternKeys) {
    const found = [];
    for (const def of PII_PATTERN_CATALOG) {
      if (!patternKeys.includes(def.key)) continue;
      let re;
      try {
        re = new RegExp(def.pattern, "g");
      } catch (e) {
        continue;
      }
      let m;
      while ((m = re.exec(text)) !== null) {
        if (def.key === "CREDIT_CARD" && !passesLuhn(m[0])) continue;
        found.push(def.label);
        break; // one hit per category is enough
      }
    }
    return found;
  }

  async function extractText(file) {
    const ext = extensionOf(file.name || "");
    if (file.size > MAX_SCAN_BYTES) return "";
    if (TEXT_EXTENSIONS.includes(ext)) return await file.text();
    if (OOXML_EXTENSIONS.includes(ext)) {
      try {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const names = Object.keys(zip.files).filter((n) => OOXML_TEXT_PART_PATTERN.test(n));
        const parts = await Promise.all(names.map((n) => zip.files[n].async("string")));
        return parts.join(" ").replace(/<[^>]+>/g, " ");
      } catch (e) {
        return "";
      }
    }
    if (ext === ".pdf" || file.type === "application/pdf") return await pdfText(file);
    return "";
  }

  function ensurePdfReader() {
    if (globalThis.pdfjsLib) return Promise.resolve(true);
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "loadPdfReader" }, () => resolve(Boolean(globalThis.pdfjsLib)));
      } catch (e) {
        resolve(false);
      }
    });
  }

  // The text layer of every page, one line per text line. A PDF that won't open (damaged or
  // password-protected) yields "" and is allowed, as for any file that can't be read.
  async function pdfText(file) {
    if (!(await ensurePdfReader())) return "";
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
    }).promise;
    try {
      const out = [];
      const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (typeof item.str === "string") out.push(item.str, item.hasEOL ? "\n" : "");
        }
        out.push("\n");
        page.cleanup();
      }
      return out.join("");
    } finally {
      doc.destroy();
    }
  }

  // Returns [{ name, labels }] for every file that contains a protected category.
  async function scanFiles(files, patternKeys) {
    const hits = [];
    for (const file of files) {
      const text = await extractText(file).catch(() => "");
      if (!text) continue;
      const labels = findMatches(text, patternKeys);
      if (labels.length > 0) hits.push({ name: file.name || "attachment", labels });
    }
    return hits;
  }

  // Labels of the categories found in a piece of message text (subject or body).
  function scanText(text, patternKeys) {
    return text ? findMatches(text, patternKeys) : [];
  }

  // ---- AI Guard prompt protection (aiguard.js) ----------------------------------------------

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Letter-and-digit IDs matched in any case in AI prompts (attachments keep the exact patterns).
  const ANY_CASE_IN_PROMPTS = ["PAN_INDIA", "GSTIN", "IFSC_CODE", "PASSPORT_INDIA", "IBAN"];

  // Every match with its position: personal-data patterns and the policy's keyword data types
  // (whole words, any case). [{ label, start, end }], at most `limit`.
  function findDetailed(text, patternKeys, keywordTypes, limit) {
    const out = [];
    const max = limit || 200;
    for (const def of PII_PATTERN_CATALOG) {
      if (!patternKeys.includes(def.key)) continue;
      let re;
      try {
        // People type IDs in lower case in a chat box ("abcde1234f"): any case for prompts.
        re = new RegExp(def.pattern, ANY_CASE_IN_PROMPTS.includes(def.key) ? "gi" : "g");
      } catch (e) {
        continue;
      }
      let m;
      while ((m = re.exec(text)) !== null && out.length < max) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        if (def.key === "CREDIT_CARD" && !passesLuhn(m[0])) continue;
        // Separators the pattern allows after the last digit aren't part of the value.
        const value = m[0].replace(/[\s-]+$/, "");
        out.push({ label: def.label, start: m.index, end: m.index + value.length });
      }
    }
    for (const type of keywordTypes || []) {
      for (const word of type.values || []) {
        const w = String(word).trim();
        if (w.length < 2) continue;
        const edge = /^\w/.test(w) ? "(?<![\\w])" : "";
        const tail = /\w$/.test(w) ? "(?![\\w])" : "";
        const re = new RegExp(edge + escapeRegExp(w) + tail, "gi");
        let m;
        while ((m = re.exec(text)) !== null && out.length < max) out.push({ label: type.label, start: m.index, end: m.index + m[0].length });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  // "4111 1111 1111 1111" -> "4111 •••• •••• 1111": first and last few characters kept.
  function maskValue(value) {
    const keep = value.length >= 12 ? 4 : value.length >= 6 ? 2 : 1;
    let seen = 0;
    const total = value.replace(/[\s-]/g, "").length;
    return value
      .split("")
      .map((c) => {
        if (/[\s-]/.test(c)) return c;
        seen++;
        return seen <= keep || seen > total - keep ? c : "•";
      })
      .join("");
  }

  // The text with every match masked.
  function redactText(text, matches) {
    let out = "";
    let at = 0;
    for (const m of matches) {
      if (m.start < at) continue; // overlapping matches: the first wins
      out += text.slice(at, m.start) + maskValue(text.slice(m.start, m.end));
      at = m.end;
    }
    return out + text.slice(at);
  }

  // Up to three masked matches, for the event report (never the text around them).
  function maskedSample(text, matches) {
    return matches
      .slice(0, 3)
      .map((m) => maskValue(text.slice(m.start, m.end)))
      .join(", ")
      .slice(0, 300);
  }

  function scanPrompt(text, patternKeys, keywordTypes) {
    if (!text) return { labels: [], matches: [], sample: "" };
    const matches = findDetailed(text, patternKeys, keywordTypes);
    return { labels: [...new Set(matches.map((m) => m.label))], matches, sample: maskedSample(text, matches) };
  }

  // Files uploaded to an AI website: [{ name, labels, sample }] for each that contains something.
  async function scanPromptFiles(files, patternKeys, keywordTypes) {
    const hits = [];
    for (const file of files) {
      const text = await extractText(file).catch(() => "");
      if (!text) continue;
      const r = scanPrompt(text, patternKeys, keywordTypes);
      if (r.labels.length > 0) hits.push({ name: file.name || "file", labels: r.labels, sample: r.sample });
    }
    return hits;
  }

  globalThis.EmailGuardScanner = { scanFiles, scanText, scanPrompt, scanPromptFiles, redactText };
})();
