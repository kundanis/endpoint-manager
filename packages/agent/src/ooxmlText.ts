import zlib from "node:zlib";

// Plain-text extraction from Office Open XML files (.docx/.xlsx/.pptx) for Data Discovery.
// These are ZIP containers of XML parts. A minimal reader over Node's own zlib is enough —
// no third-party zip dependency to add to the installer's fixed runtime-deps list (see
// scripts/package-installer.ps1). Anything unexpected (encrypted/legacy/corrupt/ZIP64)
// returns null and the file is simply skipped, never treated as an error for the scan.

export const OOXML_EXTENSIONS = [".docx", ".xlsx", ".pptx"];

// The parts that carry user-visible text: Word body/headers/footers/notes, Excel shared
// strings + sheet cells (numbers live in sheets, not sharedStrings), PowerPoint slides+notes.
const TEXT_PART_PATTERN =
  /^(word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml|ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml)$/;

// Guard against decompression bombs: a 2MB file can't legitimately expand past this.
const MAX_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readCentralDirectory(buf: Buffer): ZipEntry[] | null {
  // End-of-central-directory record: 22 bytes + up to a 64KB comment, scanned from the end.
  const minEocd = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff) return null; // ZIP64 — not produced by Office for files this small

  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) return null;
    const flags = buf.readUInt16LE(offset + 8);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    // Central-directory sizes are authoritative even when the local header defers them to
    // a data descriptor (flag bit 3), which is why entries are read from here.
    entries.push({
      name: buf.toString("utf8", offset + 46, offset + 46 + nameLength),
      method: flags & 0x1 ? -1 : buf.readUInt16LE(offset + 10), // bit 0 = encrypted → unreadable
      compressedSize: buf.readUInt32LE(offset + 20),
      uncompressedSize: buf.readUInt32LE(offset + 24),
      localHeaderOffset: buf.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buf: Buffer, entry: ZipEntry, maxOutputLength: number): Buffer | null {
  const at = entry.localHeaderOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOCAL_HEADER_SIGNATURE) return null;
  const dataStart = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength });
  return null; // encrypted or an unsupported compression method
}

// XML → text. Cell/paragraph/row/break boundaries become a newline first — not a space,
// since the card/Aadhaar patterns accept spaces inside a number, so four adjacent
// "4111" cells would otherwise read as one card number. Every other tag is dropped with
// no separator at all, because Word splits a single word or number across several <w:t> runs.
function xmlToText(xml: string): string {
  return xml
    .replace(/<\/(w:p|a:p|c|row|si|w:tr|w:tc)>|<(w:tab|w:br|a:br)\b[^>]*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

export function extractOoxmlText(file: Buffer): string | null {
  try {
    const entries = readCentralDirectory(file);
    if (!entries) return null;
    let remaining = MAX_TOTAL_UNCOMPRESSED_BYTES;
    const parts: string[] = [];
    for (const entry of entries) {
      if (!TEXT_PART_PATTERN.test(entry.name)) continue;
      if (entry.uncompressedSize > remaining) return parts.length > 0 ? parts.join(" ") : null;
      const data = readEntry(file, entry, remaining);
      if (!data) continue;
      remaining -= data.length;
      parts.push(xmlToText(data.toString("utf8")));
    }
    return parts.length > 0 ? parts.join(" ") : null;
  } catch {
    return null; // corrupt archive, inflate failure, or bomb guard tripped
  }
}
