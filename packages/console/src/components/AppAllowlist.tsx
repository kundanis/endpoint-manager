import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check as CheckIcon, FileSearch, Trash2, X } from "lucide-react";
// Source files, not the package entry: the dev server can't hand the compiled package to the browser.
import {
  APP_CATALOG,
  APP_CATALOG_CATEGORIES,
} from "@em/shared/src/data/appCatalog";
import { NotAProgramError, readPeFileInfo } from "@em/shared/src/peFileInfo";
import {
  useAddAppControlRule,
  useDeleteAppControlRule,
  useSeenSigners,
  useUpdateAppControlPolicy,
  type AppControlRuleInput,
} from "../api/hooks";
import type { AppControlPolicyDetail, AppControlRuleView } from "../api/types";
import {
  Alert,
  Button,
  Card,
  Field,
  FormGrid,
  IconButton,
  Switch,
  useConfirm,
  useToast,
} from "./ui";

// Allowlist policies (Application control, mode ALLOWLIST): Windows and what it needs always run;
// every other program and installer is blocked unless allowed here.

type AllowType = "ALLOW_PATH" | "ALLOW_PUBLISHER" | "ALLOW_HASH";

const ALLOW_TYPE_LABEL: Record<AllowType, string> = {
  ALLOW_PATH: "Folder or file",
  ALLOW_PUBLISHER: "Publisher",
  ALLOW_HASH: "File hash",
};

const VERSION_LABEL = {
  ANY: "Any version",
  MIN: "This version or newer",
  EXACT: "Exactly this version",
} as const;

// "O=GOOGLE LLC, L=MOUNTAIN VIEW, ..." -> "GOOGLE LLC"
export function publisherName(dn: string | null | undefined): string {
  if (!dn) return "";
  const m = dn.match(/(?:^|,\s*)O=("(?:[^"]|"")*"|[^,]*)/i);
  return m ? m[1].replace(/^"|"$/g, "").replace(/""/g, '"').trim() : dn;
}

function ruleSummary(r: AppControlRuleView) {
  if (r.ruleType === "ALLOW_PUBLISHER") {
    const version =
      r.versionMatch === "MIN"
        ? `${r.version} or newer`
        : r.versionMatch === "EXACT"
          ? `exactly ${r.version}`
          : "any version";
    return (
      <>
        <b>{publisherName(r.value)}</b>
        <span className="app-row-sub">
          {r.productName ?? "Any product"} · {r.fileName ?? "any file"} ·{" "}
          {version}
        </span>
      </>
    );
  }
  if (r.ruleType === "ALLOW_HASH") {
    return (
      <>
        <b>{r.fileName ?? "Program file"}</b>
        <span className="app-row-sub ep-mono">
          {r.value.slice(0, 16)}…
          {r.fileSize !== null ? ` · ${r.fileSize.toLocaleString()} bytes` : ""}
        </span>
      </>
    );
  }
  return <span className="ep-mono">{r.value}</span>;
}

/* ---- Common applications --------------------------------------------------------------------- */

function CommonApplications({ policy }: { policy: AppControlPolicyDetail }) {
  const addRule = useAddAppControlRule();
  const deleteRule = useDeleteAppControlRule();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = new Map(
    policy.rules
      .filter((r) => r.ruleType === "ALLOW_CATALOG")
      .map((r) => [r.value, r.id]),
  );
  const busy = addRule.isPending || deleteRule.isPending;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggle(key: string, name: string) {
    const ruleId = selected.get(key);
    if (!ruleId) {
      addRule.mutate(
        {
          policyId: policy.id,
          ruleType: "ALLOW_CATALOG",
          value: key,
          label: name,
        },
        { onError: (err) => toast((err as Error).message) },
      );
    } else {
      deleteRule.mutate(
        { policyId: policy.id, ruleId },
        { onError: (err) => toast((err as Error).message) },
      );
    }
  }

  const q = query.trim().toLowerCase();
  const matches = APP_CATALOG.filter(
    (a) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q),
  );
  const chosen = APP_CATALOG.filter((a) => selected.has(a.key));

  return (
    <Card title="Common applications" hint={`${selected.size} selected`}>
      <div className="app-stack">
        <p className="app-text app-muted">
          Choose the applications people may use. Each is allowed from the
          folder it installs to for all users (under Program Files, which only
          administrators can change); copies in a user's own folders, such as
          Downloads, stay blocked.
        </p>
        <div className="app-combo" ref={wrapRef}>
          <input
            type="search"
            className="ep-input"
            role="combobox"
            aria-expanded={open}
            aria-controls="allowlist-catalog"
            aria-label="Search applications"
            placeholder={`Search ${APP_CATALOG.length} applications, e.g. Office, Zoom, VPN`}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          {open && (
            <div
              id="allowlist-catalog"
              className="ep-menu app-combo-pop"
              role="listbox"
              aria-multiselectable="true"
            >
              {matches.length === 0 && (
                <div className="app-combo-empty">
                  No application matches. Add it under Custom applications.
                </div>
              )}
              {APP_CATALOG_CATEGORIES.filter((c) =>
                matches.some((a) => a.category === c),
              ).map((category) => (
                <div key={category} role="group" aria-label={category}>
                  <div className="app-combo-group">{category}</div>
                  {matches
                    .filter((a) => a.category === category)
                    .map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        role="option"
                        aria-selected={selected.has(a.key)}
                        disabled={busy}
                        onClick={() => toggle(a.key, a.name)}
                      >
                        <span
                          aria-hidden
                          style={{ width: 16, display: "inline-flex" }}
                        >
                          {selected.has(a.key) && (
                            <CheckIcon
                              size={16}
                              strokeWidth={2}
                              className="ep-ic"
                            />
                          )}
                        </span>
                        {a.name}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {chosen.length > 0 ? (
          <div className="app-chips">
            {chosen.map((a) => (
              <span key={a.key} className="ep-tag app-chip">
                {a.name}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  disabled={busy}
                  onClick={() => toggle(a.key, a.name)}
                >
                  <X size={12} strokeWidth={2} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className="app-muted">None chosen yet.</span>
        )}
      </div>
    </Card>
  );
}

/* ---- Your own applications ------------------------------------------------------------------- */

interface FileReading {
  name: string;
  publisher: string | null;
  productName: string | null;
  originalFileName: string | null;
  fileVersion: string | null;
  hash: string;
  size: number;
}

// Reads a program's signer, product, version and the hash Windows uses, in the browser.
async function readProgramFile(file: File): Promise<FileReading> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = readPeFileInfo(bytes);
  const total = info.hashRanges.reduce((n, [s, e]) => n + (e - s), 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const [s, e] of info.hashRanges) {
    joined.set(bytes.subarray(s, e), at);
    at += e - s;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
  const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return {
    name: file.name,
    publisher: info.publisher,
    productName: info.productName,
    originalFileName: info.originalFileName,
    fileVersion: info.fileVersion,
    hash,
    size: file.size,
  };
}

const BLANK: AppControlRuleInput & { ruleType: AllowType } = {
  ruleType: "ALLOW_PATH",
  value: "",
  label: "",
  productName: "",
  fileName: "",
  versionMatch: "ANY",
  version: "",
  fileSize: null,
};

function CustomApplications({ policy }: { policy: AppControlPolicyDetail }) {
  const addRule = useAddAppControlRule();
  const deleteRule = useDeleteAppControlRule();
  const confirm = useConfirm();
  const [form, setForm] = useState(BLANK);
  const [reading, setReading] = useState<FileReading | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [signerQuery, setSignerQuery] = useState("");
  const signers = useSeenSigners(signerQuery);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<typeof form>) =>
    setForm((f) => ({ ...f, ...patch }));
  const custom = policy.rules.filter((r) => r.ruleType !== "ALLOW_CATALOG");

  const publisherOptions = useMemo(
    () => [...new Set((signers.data ?? []).map((s) => s.publisher))],
    [signers.data],
  );

  async function onFile(file: File | undefined) {
    setReadError(null);
    setReading(null);
    if (!file) return;
    try {
      const r = await readProgramFile(file);
      setReading(r);
      if (r.publisher) {
        set({
          ruleType: "ALLOW_PUBLISHER",
          value: r.publisher,
          productName: r.productName ?? "",
          fileName: "",
          versionMatch: "ANY",
          version: r.fileVersion ?? "",
          label: form.label || r.productName || r.name,
        });
      } else {
        set({
          ruleType: "ALLOW_HASH",
          value: r.hash,
          fileName: r.originalFileName ?? r.name,
          fileSize: r.size,
          label: form.label || r.name,
        });
      }
    } catch (err) {
      setReadError(
        err instanceof NotAProgramError
          ? err.message
          : `Couldn't read the file: ${(err as Error).message}`,
      );
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const body: AppControlRuleInput = {
      ruleType: form.ruleType,
      value: form.value.trim(),
      label: form.label?.trim() || null,
      ...(form.ruleType === "ALLOW_PUBLISHER"
        ? {
            productName: form.productName?.trim() || null,
            fileName: form.fileName?.trim() || null,
            versionMatch: form.versionMatch ?? "ANY",
            version:
              form.versionMatch === "ANY" ? null : form.version?.trim() || null,
          }
        : form.ruleType === "ALLOW_HASH"
          ? {
              fileName: form.fileName?.trim() || null,
              fileSize: form.fileSize ?? null,
            }
          : {}),
    };
    addRule.mutate(
      { policyId: policy.id, ...body },
      {
        onSuccess: () => {
          setForm(BLANK);
          setReading(null);
        },
      },
    );
  }

  return (
    <Card
      title="Custom applications"
      hint={custom.length ? `${custom.length} allowed` : undefined}
    >
      <div className="app-stack">
        {custom.length > 0 && (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Allows</th>
                  <th scope="col">Label</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {custom.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {ALLOW_TYPE_LABEL[r.ruleType as AllowType] ?? r.ruleType}
                    </td>
                    <td style={{ overflowWrap: "anywhere" }}>
                      {ruleSummary(r)}
                    </td>
                    <td>{r.label ?? <span className="app-muted">—</span>}</td>
                    <td>
                      <div className="app-cell-actions">
                        <IconButton
                          icon={Trash2}
                          label={`Remove ${r.label ?? r.value}`}
                          disabled={deleteRule.isPending}
                          onClick={async () => {
                            const ok = await confirm({
                              title: "Remove this application?",
                              body: "It stops running on assigned endpoints at their next sync.",
                              confirmLabel: "Remove",
                              tone: "danger",
                            });
                            if (ok)
                              deleteRule.mutate({
                                policyId: policy.id,
                                ruleId: r.id,
                              });
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={submit} className="app-inset-form">
          <span className="app-subhead">Add an application</span>
          <div className="app-actions-row">
            <Button
              icon={FileSearch}
              onClick={() => fileInput.current?.click()}
            >
              Read from a program file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".exe,.com"
              className="app-vh"
              onChange={(e) => onFile(e.target.files?.[0])}
              aria-label="Program file"
            />
            <span className="app-muted">
              Reads the publisher, product, version and hash on this computer.
              The file isn't uploaded.
            </span>
          </div>
          {readError && <Alert tone="critical">{readError}</Alert>}
          {reading && (
            <Alert tone="info" title={reading.name}>
              {reading.publisher ? (
                <>
                  Signed by <b>{publisherName(reading.publisher)}</b>
                  {reading.productName ? ` · ${reading.productName}` : ""}
                  {reading.fileVersion
                    ? ` · version ${reading.fileVersion}`
                    : ""}
                  . A publisher rule keeps working after updates; choose File
                  hash to allow only this exact file.
                </>
              ) : (
                <>
                  Not signed, so it can only be allowed by its hash (this exact
                  file) or by its folder.
                </>
              )}
            </Alert>
          )}
          <FormGrid>
            <Field label="Allow by" htmlFor="allow-type">
              <select
                id="allow-type"
                className="ep-select"
                value={form.ruleType}
                onChange={(e) => {
                  const ruleType = e.target.value as AllowType;
                  const fromFile =
                    reading && ruleType === "ALLOW_HASH"
                      ? {
                          value: reading.hash,
                          fileName: reading.originalFileName ?? reading.name,
                          fileSize: reading.size,
                        }
                      : reading &&
                          ruleType === "ALLOW_PUBLISHER" &&
                          reading.publisher
                        ? {
                            value: reading.publisher,
                            productName: reading.productName ?? "",
                            fileName: "",
                            version: reading.fileVersion ?? "",
                          }
                        : { value: "" };
                  set({ ruleType, ...fromFile });
                }}
              >
                {(Object.keys(ALLOW_TYPE_LABEL) as AllowType[]).map((t) => (
                  <option key={t} value={t}>
                    {ALLOW_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>

            {form.ruleType === "ALLOW_PATH" && (
              <Field
                label="Folder or file"
                htmlFor="allow-path"
                required
                help='A folder allows everything in it, e.g. "C:\Program Files\ERP" or "\\fileserver\apps". Choose a folder only administrators can change.'
              >
                <input
                  id="allow-path"
                  className="ep-input ep-mono"
                  value={form.value}
                  onChange={(e) => set({ value: e.target.value })}
                  required
                />
              </Field>
            )}

            {form.ruleType === "ALLOW_PUBLISHER" && (
              <>
                <Field
                  label="Publisher"
                  htmlFor="allow-publisher"
                  required
                  help="The signer as Windows reads it. Read it from a program file, or type to search signers seen on your endpoints."
                >
                  <input
                    id="allow-publisher"
                    className="ep-input ep-mono"
                    list="allow-publisher-seen"
                    value={form.value}
                    onChange={(e) => {
                      set({ value: e.target.value });
                      setSignerQuery(
                        e.target.value.length >= 2 ? e.target.value : "",
                      );
                    }}
                    placeholder="O=GOOGLE LLC, L=MOUNTAIN VIEW, S=CALIFORNIA, C=US"
                    required
                  />
                  <datalist id="allow-publisher-seen">
                    {publisherOptions.map((p) => (
                      <option key={p} value={p}>
                        {publisherName(p)}
                      </option>
                    ))}
                  </datalist>
                </Field>
                <Field
                  label="Product"
                  htmlFor="allow-product"
                  help="Optional. Empty allows every product from this publisher."
                >
                  <input
                    id="allow-product"
                    className="ep-input"
                    value={form.productName ?? ""}
                    onChange={(e) => set({ productName: e.target.value })}
                  />
                </Field>
                <Field
                  label="File name"
                  htmlFor="allow-file"
                  help="Optional, e.g. chrome.exe. Empty allows every file of the product."
                >
                  <input
                    id="allow-file"
                    className="ep-input ep-mono"
                    value={form.fileName ?? ""}
                    onChange={(e) => set({ fileName: e.target.value })}
                  />
                </Field>
                <Field label="Version" htmlFor="allow-version-match">
                  <select
                    id="allow-version-match"
                    className="ep-select"
                    value={form.versionMatch ?? "ANY"}
                    onChange={(e) =>
                      set({
                        versionMatch: e.target.value as "ANY" | "MIN" | "EXACT",
                      })
                    }
                  >
                    {(
                      Object.keys(
                        VERSION_LABEL,
                      ) as (keyof typeof VERSION_LABEL)[]
                    ).map((v) => (
                      <option key={v} value={v}>
                        {VERSION_LABEL[v]}
                      </option>
                    ))}
                  </select>
                </Field>
                {form.versionMatch !== "ANY" && (
                  <Field
                    label="Version number"
                    htmlFor="allow-version"
                    required
                  >
                    <input
                      id="allow-version"
                      className="ep-input ep-mono"
                      value={form.version ?? ""}
                      onChange={(e) => set({ version: e.target.value })}
                      placeholder="131.0.6778.86"
                      required
                    />
                  </Field>
                )}
              </>
            )}

            {form.ruleType === "ALLOW_HASH" && (
              <>
                <Field
                  label="SHA-256 hash"
                  htmlFor="allow-hash"
                  required
                  help="Windows' own hash of the program. Read it from the program file."
                >
                  <input
                    id="allow-hash"
                    className="ep-input ep-mono"
                    value={form.value}
                    onChange={(e) => set({ value: e.target.value })}
                    required
                  />
                </Field>
                <Field label="File name" htmlFor="allow-hash-file">
                  <input
                    id="allow-hash-file"
                    className="ep-input ep-mono"
                    value={form.fileName ?? ""}
                    onChange={(e) => set({ fileName: e.target.value })}
                  />
                </Field>
              </>
            )}

            <Field label="Label" htmlFor="allow-label">
              <input
                id="allow-label"
                className="ep-input"
                value={form.label ?? ""}
                onChange={(e) => set({ label: e.target.value })}
                placeholder="Optional"
              />
            </Field>
          </FormGrid>
          {!!addRule.error && (
            <Alert tone="critical">{(addRule.error as Error).message}</Alert>
          )}
          <div className="app-actions-row app-end">
            <Button
              type="submit"
              variant="primary"
              disabled={addRule.isPending || !form.value.trim()}
            >
              {addRule.isPending ? "Adding…" : "Add application"}
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

export function AllowlistRulesPanel({
  policy,
}: {
  policy: AppControlPolicyDetail;
}) {
  return (
    <div className="app-stack">
      <CustomApplications policy={policy} />
      <CommonApplications policy={policy} />
    </div>
  );
}

/* ---- Settings -------------------------------------------------------------------------------- */

export function AllowlistSettingsPanel({
  policy,
}: {
  policy: AppControlPolicyDetail;
}) {
  const update = useUpdateAppControlPolicy();
  const toast = useToast();
  const [allowProgramFiles, setAllowProgramFiles] = useState(
    policy.allowProgramFiles,
  );
  const [exemptAdministrators, setExemptAdministrators] = useState(
    policy.exemptAdministrators,
  );

  function save(e: FormEvent) {
    e.preventDefault();
    update.mutate(
      { id: policy.id, allowProgramFiles, exemptAdministrators },
      { onSuccess: () => toast("Allowlist settings saved.") },
    );
  }

  return (
    <Card title="Allowlist">
      <form className="app-stack" onSubmit={save}>
        <Switch
          checked={exemptAdministrators}
          onChange={setExemptAdministrators}
          label="Administrators can run anything, including setups, when they run it as administrator"
        />
        <Switch
          checked={allowProgramFiles}
          onChange={setAllowProgramFiles}
          label="Allow every application installed in Program Files"
          title="Off: only the applications you select run, even if others are installed."
        />
        {!!update.error && (
          <Alert tone="critical">{(update.error as Error).message}</Alert>
        )}
        <div className="app-actions-row app-end">
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save allowlist settings"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
