import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import type { Tx } from "./db";
import { WorkflowError } from "./errors";
import { getObject } from "./storage";

// Company logos: validation of an uploaded image, and reading a company's current logo. The file's own bytes decide what it is; the
// browser's declared type must agree. Only PNG and JPEG are accepted (never SVG, which can carry script and which pdfkit cannot draw),
// up to 1 MB and 64 to 2,000 pixels a side. A PNG is fully decoded (every chunk's checksum and the compressed pixel data); a JPEG's
// structure is walked from start to end marker; and finally pdfkit must be able to embed it, as the PDF voucher will.

import { LOGO_MAX_BYTES, LOGO_MAX_PX, LOGO_MIN_PX } from "./logo-url";

export { LOGO_MAX_BYTES, LOGO_MAX_PX, LOGO_MIN_PX, logoUrl } from "./logo-url";
export type LogoMime = "image/png" | "image/jpeg";
export interface ValidLogo { data: Buffer; mime: LogoMime; width: number; height: number; size: number; sha256: string }
export interface CurrentLogo { id: string; company_id: string; object_key: string; mime_type: LogoMime; sha256: string; width: number; height: number; size_bytes: number; uploaded_at: Date }

const bad = (msg: string): never => { throw new WorkflowError(400, msg); };
const CORRUPT = "The file is damaged or is not a valid PNG or JPEG image.";

/** Validates an uploaded logo and returns its bytes and description. Throws a WorkflowError with a message safe to show. */
export async function validateLogo(file: { size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<ValidLogo> {
  if (!file || file.size === 0) bad("Choose a PNG or JPEG file.");
  if (file.size > LOGO_MAX_BYTES) bad("A logo can be at most 1 MB.");
  if (/svg/i.test(file.type)) bad("SVG files are not accepted. Upload a PNG or JPEG.");
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length === 0 || data.length > LOGO_MAX_BYTES) bad("A logo can be at most 1 MB.");
  const info = inspectImage(data);
  const declared = file.type === "image/jpg" || file.type === "image/pjpeg" ? "image/jpeg" : file.type;
  if (declared !== info.mime) bad(`The file's contents are ${info.mime === "image/png" ? "a PNG" : "a JPEG"} image, but it was sent as ${file.type || "an unknown type"}. Save it again as a PNG or JPEG and upload that file.`);
  await assertPdfkitCanDraw(data);
  return { data, mime: info.mime, width: info.width, height: info.height, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

/** What the bytes are: a well-formed PNG or JPEG of an accepted size, or a WorkflowError. */
export function inspectImage(data: Buffer): { mime: LogoMime; width: number; height: number } {
  const head = data.subarray(0, 512).toString("latin1").trimStart().toLowerCase();
  if (head.startsWith("<") || head.includes("<svg")) bad("SVG files are not accepted. Upload a PNG or JPEG.");
  const r = isPng(data) ? { mime: "image/png" as const, ...readPng(data) } : isJpeg(data) ? { mime: "image/jpeg" as const, ...readJpeg(data) } : bad("Only PNG or JPEG images are accepted.");
  if (r.width < LOGO_MIN_PX || r.height < LOGO_MIN_PX) bad(`The logo is ${r.width} × ${r.height} pixels; it must be at least ${LOGO_MIN_PX} pixels on each side.`);
  if (r.width > LOGO_MAX_PX || r.height > LOGO_MAX_PX) bad(`The logo is ${r.width} × ${r.height} pixels; it can be at most ${LOGO_MAX_PX} pixels on each side.`);
  return r;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (d: Buffer) => d.length >= 8 && PNG_SIG.every((b, i) => d[i] === b);
const isJpeg = (d: Buffer) => d.length >= 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff;

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/** Walks every chunk (lengths and checksums), then inflates the pixel data and checks it is exactly the size the header describes. */
function readPng(d: Buffer): { width: number; height: number } {
  let p = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0, palette = false, ended = false;
  const idat: Buffer[] = [];
  while (p < d.length) {
    if (p + 12 > d.length) bad(CORRUPT);
    const len = d.readUInt32BE(p), type = d.toString("latin1", p + 4, p + 8);
    if (len > d.length - p - 12) bad(CORRUPT);
    const body = d.subarray(p + 8, p + 8 + len);
    if (crc32(d.subarray(p + 4, p + 8 + len)) !== d.readUInt32BE(p + 8 + len)) bad(CORRUPT);
    if (p === 8 && type !== "IHDR") bad(CORRUPT);
    if (type === "IHDR") {
      if (p !== 8 || len !== 13) bad(CORRUPT);
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; color = body[9]; interlace = body[12];
      if (!PNG_DEPTHS[color]?.includes(depth) || body[10] !== 0 || body[11] !== 0 || interlace > 1) bad(CORRUPT);
      if (width < 1 || height < 1) bad(CORRUPT);
      if (width > LOGO_MAX_PX || height > LOGO_MAX_PX) bad(`The logo is ${width} × ${height} pixels; it can be at most ${LOGO_MAX_PX} pixels on each side.`);
    } else if (type === "PLTE") palette = true;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") { ended = true; p += 12 + len; break; }
    p += 12 + len;
  }
  if (!ended || idat.length === 0 || (color === 3 && !palette)) bad(CORRUPT);
  if (d.subarray(p).some((b) => b !== 0)) bad(CORRUPT);   // nothing hidden after the end of the image
  const bpp = PNG_CHANNELS[color] * depth, rowBytes = (w: number) => Math.ceil((w * bpp) / 8);
  const expected = interlace === 0 ? height * (1 + rowBytes(width))
    : ADAM7.reduce((n, [xs, ys, dx, dy]) => { const w = width > xs ? Math.ceil((width - xs) / dx) : 0, h = height > ys ? Math.ceil((height - ys) / dy) : 0; return n + (w && h ? h * (1 + rowBytes(w)) : 0); }, 0);
  let pixels: Buffer;
  try { pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 }); } catch { return bad(CORRUPT); }
  if (pixels.length !== expected) bad(CORRUPT);
  if (interlace === 0) for (let row = 0, stride = 1 + rowBytes(width); row < height; row++) if (pixels[row * stride] > 4) bad(CORRUPT);
  return { width, height };
}

/** Walks the JPEG's segments from the start marker to the end marker. Baseline, extended or progressive, 8-bit, 1, 3 or 4 components. */
function readJpeg(d: Buffer): { width: number; height: number } {
  let p = 2, width = 0, height = 0, frame = false, scan = false, ended = false;
  while (p < d.length) {
    if (d[p] !== 0xff) bad(CORRUPT);
    while (d[p] === 0xff) p++;   // fill bytes
    const m = d[p++];
    if (m === undefined) bad(CORRUPT);
    if (m === 0xd9) { ended = true; break; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;   // markers without a length
    if (m === 0xd8 || p + 2 > d.length) bad(CORRUPT);
    const len = d.readUInt16BE(p);
    if (len < 2 || p + len > d.length) bad(CORRUPT);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (![0xc0, 0xc1, 0xc2].includes(m)) bad("This kind of JPEG (lossless or arithmetic-coded) is not supported. Save it as a standard JPEG or a PNG.");
      if (frame || len < 8) bad(CORRUPT);
      const precision = d[p + 2]; height = d.readUInt16BE(p + 3); width = d.readUInt16BE(p + 5); const comps = d[p + 7];
      if (precision !== 8 || ![1, 3, 4].includes(comps) || len !== 8 + 3 * comps || width < 1 || height < 1) bad(CORRUPT);
      frame = true;
    }
    p += len;
    if (m === 0xda) {   // start of scan: skip the entropy-coded data up to the next real marker
      if (!frame) bad(CORRUPT);
      scan = true;
      while (p < d.length - 1 && !(d[p] === 0xff && d[p + 1] !== 0x00 && !(d[p + 1] >= 0xd0 && d[p + 1] <= 0xd7))) p++;
      if (p >= d.length - 1) bad(CORRUPT);
    }
  }
  if (!ended || !frame || !scan) bad(CORRUPT);
  if (d.subarray(p).some((b) => b !== 0)) bad(CORRUPT);
  return { width, height };
}

/** The PDF voucher embeds the logo with pdfkit: make sure it can. */
async function assertPdfkitCanDraw(data: Buffer) {
  try {
    await new Promise<void>((ok, fail) => {
      const doc = new PDFDocument({ size: "A6", margin: 0 });
      doc.on("data", () => {}); doc.on("end", ok); doc.on("error", fail);
      doc.image(data, 0, 0, { fit: [56, 56] }); doc.end();
    });
  } catch { bad(CORRUPT); }
}

/** A company's current logo, as this person may see it (row-level security: the companies they can already see), or null. */
export async function currentLogo(tx: Tx, companyId: string): Promise<CurrentLogo | null> {
  return (await tx.q<CurrentLogo>(
    "SELECT id, company_id, object_key, mime_type, sha256, width, height, size_bytes, uploaded_at FROM company_logos WHERE company_id = $1 AND ended_at IS NULL", [companyId]))[0] ?? null;
}

/** The current logos of the companies this person can see, by company. */
export async function currentLogos(tx: Tx): Promise<Map<string, CurrentLogo>> {
  const list = await tx.q<CurrentLogo>("SELECT id, company_id, object_key, mime_type, sha256, width, height, size_bytes, uploaded_at FROM company_logos WHERE ended_at IS NULL");
  return new Map(list.map((l) => [l.company_id, l]));
}

/** The stored logo's bytes, or null when it cannot be read (the voucher then shows the company code). */
export async function logoBytes(logo: { object_key: string } | null): Promise<Buffer | null> {
  if (!logo) return null;
  try { return await getObject(logo.object_key); } catch { return null; }
}
