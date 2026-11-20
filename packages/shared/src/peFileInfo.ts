// Reads what Windows AppLocker looks at in a program file (.exe), without running or uploading it:
// the signer (as AppLocker writes it), product name, original file name, file version, and which
// byte ranges make up its Authenticode SHA-256 hash (AppLocker's file hash). The console hashes
// those ranges in the browser; nothing about the file leaves the admin's machine except the result.
//
// Programs signed through a Windows catalog (most of Windows' own files) carry no signature inside
// the file, so their publisher reads as null here; they run under the Windows-folder allowance.

export interface PeFileInfo {
  publisher: string | null; // "O=GOOGLE LLC, L=MOUNTAIN VIEW, S=CALIFORNIA, C=US"
  productName: string | null;
  originalFileName: string | null;
  fileVersion: string | null; // "131.0.6778.86"
  hashRanges: [number, number][]; // [start, end) byte ranges, hashed in this order
}

export class NotAProgramError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function readPeFileInfo(b: Uint8Array): PeFileInfo {
  if (b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) throw new NotAProgramError("Not a Windows program (.exe) file.");
  const pe = u32(b, 0x3c);
  if (pe + 24 > b.length || u32(b, pe) !== 0x00004550) throw new NotAProgramError("Not a Windows program (.exe) file.");
  const sectionCount = u16(b, pe + 6);
  const optSize = u16(b, pe + 20);
  const opt = pe + 24;
  const magic = u16(b, opt);
  if (magic !== 0x10b && magic !== 0x20b) throw new NotAProgramError("Not a Windows program (.exe) file.");
  const checksumOff = opt + 64;
  const dirCount = u32(b, opt + (magic === 0x10b ? 92 : 108));
  const dirs = opt + (magic === 0x10b ? 96 : 112);
  const dir = (i: number) => (i < dirCount ? { rva: u32(b, dirs + 8 * i), size: u32(b, dirs + 8 * i + 4) } : { rva: 0, size: 0 });

  // Authenticode: everything except the checksum, the certificate-table directory entry and the
  // certificate table itself.
  const hashRanges: [number, number][] = [];
  const cert = dir(4);
  if (dirCount > 4) {
    const certDirOff = dirs + 8 * 4;
    const certStart = cert.rva > 0 && cert.rva <= b.length ? cert.rva : b.length;
    hashRanges.push([0, checksumOff], [checksumOff + 4, certDirOff], [certDirOff + 8, certStart]);
    const certEnd = certStart + cert.size;
    if (cert.rva > 0 && certEnd < b.length) hashRanges.push([certEnd, b.length]);
  } else {
    hashRanges.push([0, checksumOff], [checksumOff + 4, b.length]);
  }

  const sections = Array.from({ length: sectionCount }, (_, i) => {
    const s = opt + optSize + 40 * i;
    return { va: u32(b, s + 12), vsize: u32(b, s + 8), raw: u32(b, s + 20), rawSize: u32(b, s + 16) };
  });
  const rvaToOffset = (rva: number): number | null => {
    for (const s of sections) {
      if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return rva - s.va + s.raw;
    }
    return null;
  };

  let publisher: string | null = null;
  try {
    if (cert.rva > 0 && cert.size > 8 && u16(b, cert.rva + 6) === 2) publisher = signerOf(b, cert.rva + 8, cert.rva + cert.size);
  } catch {
    publisher = null;
  }

  let version: VersionInfo = { productName: null, originalFileName: null, fileVersion: null };
  try {
    const res = dir(2);
    const base = res.rva ? rvaToOffset(res.rva) : null;
    if (base !== null) version = versionInfo(b, base, rvaToOffset);
  } catch {
    // no readable version resource
  }

  return { publisher, ...version, hashRanges };
}

/* ---- DER (the signature is PKCS#7 SignedData) -------------------------------------------- */

interface Tlv {
  tag: number;
  start: number; // content
  end: number;
}

function tlv(b: Uint8Array, off: number): Tlv {
  const tag = b[off];
  let len = b[off + 1];
  let p = off + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("unsupported length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[p++];
  }
  if (p + len > b.length) throw new Error("truncated");
  return { tag, start: p, end: p + len };
}

function children(b: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let p = t.start; p < t.end; ) {
    const c = tlv(b, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

const bytesEqual = (b: Uint8Array, x: Tlv, y: Tlv) =>
  x.end - x.start === y.end - y.start && b.subarray(x.start, x.end).every((v, i) => v === b[y.start + i]);

// AppLocker's publisher: O, L, S, C from the signing certificate's subject, upper case.
const NAME_PARTS: [string, number[]][] = [
  ["O", [0x55, 0x04, 0x0a]],
  ["L", [0x55, 0x04, 0x07]],
  ["S", [0x55, 0x04, 0x08]],
  ["C", [0x55, 0x04, 0x06]],
];

function signerOf(b: Uint8Array, start: number, end: number): string | null {
  const contentInfo = tlv(b, start);
  if (contentInfo.end > end) return null;
  const [, explicit] = children(b, contentInfo);
  const signedData = tlv(b, explicit.start);
  const parts = children(b, signedData);
  const certificates = parts.find((p) => p.tag === 0xa0);
  const signerInfos = parts[parts.length - 1];
  if (!certificates || signerInfos.tag !== 0x31) return null;
  const signerInfo = children(b, signerInfos)[0];
  const issuerAndSerial = children(b, signerInfo)[1];
  if (issuerAndSerial.tag !== 0x30) return null;
  const [wantIssuer, wantSerial] = children(b, issuerAndSerial);

  for (const certTlv of children(b, certificates)) {
    if (certTlv.tag !== 0x30) continue;
    const tbs = children(b, children(b, certTlv)[0]);
    const i = tbs[0].tag === 0xa0 ? 1 : 0; // explicit version
    const serial = tbs[i];
    const issuer = tbs[i + 2];
    const subject = tbs[i + 4];
    if (!bytesEqual(b, serial, wantSerial) || !bytesEqual(b, issuer, wantIssuer)) continue;
    return appLockerName(b, subject);
  }
  return null;
}

function appLockerName(b: Uint8Array, name: Tlv): string | null {
  const values = new Map<string, string>();
  for (const rdn of children(b, name)) {
    for (const atv of children(b, rdn)) {
      const [oid, value] = children(b, atv);
      const oidBytes = b.subarray(oid.start, oid.end);
      const part = NAME_PARTS.find(([, o]) => o.length === oidBytes.length && o.every((v, k) => v === oidBytes[k]));
      if (part && !values.has(part[0])) values.set(part[0], derString(b, value));
    }
  }
  if (!values.has("O")) return null;
  return NAME_PARTS.filter(([k]) => values.has(k))
    .map(([k]) => {
      const v = values.get(k)!.trim().toUpperCase();
      return `${k}=${/[,"=]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v}`;
    })
    .join(", ");
}

function derString(b: Uint8Array, t: Tlv): string {
  const raw = b.subarray(t.start, t.end);
  if (t.tag === 0x0c) return new TextDecoder("utf-8").decode(raw);
  if (t.tag === 0x1e) {
    let s = "";
    for (let i = 0; i + 1 < raw.length; i += 2) s += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
    return s;
  }
  let s = "";
  for (const c of raw) s += String.fromCharCode(c);
  return s;
}

/* ---- Version resource ---------------------------------------------------------------------- */

interface VersionInfo {
  productName: string | null;
  originalFileName: string | null;
  fileVersion: string | null;
}

const RT_VERSION = 16;

function versionInfo(b: Uint8Array, base: number, rvaToOffset: (rva: number) => number | null): VersionInfo {
  const empty: VersionInfo = { productName: null, originalFileName: null, fileVersion: null };
  // Type -> first name -> first language -> data entry.
  const entries = (dirOff: number) => {
    const count = u16(b, dirOff + 12) + u16(b, dirOff + 14);
    return Array.from({ length: count }, (_, i) => ({ id: u32(b, dirOff + 16 + 8 * i), data: u32(b, dirOff + 20 + 8 * i) }));
  };
  const typeEntry = entries(base).find((e) => e.id === RT_VERSION);
  if (!typeEntry || !(typeEntry.data & 0x80000000)) return empty;
  const nameEntry = entries(base + (typeEntry.data & 0x7fffffff))[0];
  if (!nameEntry || !(nameEntry.data & 0x80000000)) return empty;
  const langEntry = entries(base + (nameEntry.data & 0x7fffffff))[0];
  if (!langEntry || langEntry.data & 0x80000000) return empty;
  const dataEntry = base + langEntry.data;
  const off = rvaToOffset(u32(b, dataEntry));
  if (off === null) return empty;

  const root = versionNode(b, off);
  let fileVersion: string | null = null;
  if (root.valueLength >= 52 && u32(b, root.valueOff) === 0xfeef04bd) {
    const ms = u32(b, root.valueOff + 8);
    const ls = u32(b, root.valueOff + 12);
    fileVersion = `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;
  }
  const strings = new Map<string, string>();
  for (const child of versionChildren(b, root, root.valueLength)) {
    if (child.key !== "StringFileInfo") continue;
    const table = versionChildren(b, child, child.valueLength)[0];
    if (!table) continue;
    for (const s of versionChildren(b, table, table.valueLength)) {
      if (!strings.has(s.key)) strings.set(s.key, utf16(b, s.valueOff, s.valueOff + s.valueLength * 2).trim());
    }
  }
  const pick = (k: string) => strings.get(k) || null;
  return { productName: pick("ProductName"), originalFileName: pick("OriginalFilename"), fileVersion };
}

interface VersionNode {
  off: number;
  end: number;
  key: string;
  valueOff: number;
  valueLength: number; // bytes for binary values, characters for text values
  type: number;
}

const align4 = (n: number) => (n + 3) & ~3;

function versionNode(b: Uint8Array, off: number): VersionNode {
  const length = u16(b, off);
  const valueLength = u16(b, off + 2);
  const type = u16(b, off + 4);
  let p = off + 6;
  let key = "";
  while (p + 1 < b.length && u16(b, p) !== 0) {
    key += String.fromCharCode(u16(b, p));
    p += 2;
  }
  return { off, end: off + length, key, valueOff: align4(p + 2), valueLength, type };
}

function versionChildren(b: Uint8Array, parent: VersionNode, valueLength: number): VersionNode[] {
  const valueBytes = parent.type === 1 ? valueLength * 2 : valueLength;
  const out: VersionNode[] = [];
  for (let p = align4(parent.valueOff + valueBytes); p + 6 < parent.end; ) {
    const n = versionNode(b, p);
    if (n.end <= p || n.end > parent.end) break;
    out.push(n);
    p = align4(n.end);
  }
  return out;
}

function utf16(b: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let p = start; p + 1 < end && p + 1 < b.length; p += 2) {
    const c = u16(b, p);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}
