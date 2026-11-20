import { crc32, deflateSync } from "node:zlib";

// Small, genuine PNG and JPEG files built in code for the logo tests (no image library needed).

const chunk = (type: string, body: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb) >>> 0);
  return Buffer.concat([len, tb, crc]);
};

/** An RGB (or RGBA) PNG filled with one colour. */
export function makePng(width: number, height: number, { rgb = [47, 122, 51], alpha = false, interlace = 0 }: { rgb?: number[]; alpha?: boolean; interlace?: 0 | 1 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = interlace;
  const px = alpha ? [...rgb, 255] : rgb;
  const rowFor = (w: number) => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => px).flat())]);
  let raw: Buffer;
  if (!interlace) raw = Buffer.concat(Array.from({ length: height }, () => rowFor(width)));
  else {
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    raw = Buffer.concat(passes.flatMap(([xs, ys, dx, dy]) => {
      const w = width > xs ? Math.ceil((width - xs) / dx) : 0, h = height > ys ? Math.ceil((height - ys) / dy) : 0;
      return w && h ? Array.from({ length: h }, () => rowFor(w)) : [];
    }));
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A PNG whose chunk checksums are right but whose pixel data is not valid compressed data. */
export function makeBadDataPng(width: number, height: number) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", Buffer.from("not deflate data at all")), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * A baseline greyscale JPEG of a flat grey image. Its Huffman tables have one code each (DC difference 0, end of block), so every 8x8
 * block is two zero bits and the scan data is all zero bytes. `sof` changes the frame type (0xC9 = arithmetic coding, which is refused).
 */
export function makeJpeg(width: number, height: number, { sof = 0xc0, end = true }: { sof?: number; end?: boolean } = {}) {
  const seg = (marker: number, body: number[]) => Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
  const dqt = seg(0xdb, [0x00, ...Array(64).fill(1)]);
  const sof0 = seg(sof, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]);
  const counts = (n: number) => [1, ...Array(15).fill(0)].slice(0, 16).map((c, i) => (i === 0 ? n : 0));
  const dhtDc = seg(0xc4, [0x00, ...counts(1), 0x00]);
  const dhtAc = seg(0xc4, [0x10, ...counts(1), 0x00]);
  const sos = seg(0xda, [1, 1, 0x00, 0, 63, 0]);
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  const scan = Buffer.alloc(Math.ceil((blocks * 2) / 8));
  return Buffer.concat([Buffer.from([0xff, 0xd8]), dqt, sof0, dhtDc, dhtAc, sos, scan, end ? Buffer.from([0xff, 0xd9]) : Buffer.alloc(0)]);
}

/** A browser-style uploaded file. */
export const fileOf = (data: Buffer, type: string, name = "logo") => new File([new Uint8Array(data)], name, { type });

/** The width and height in a PNG's header. */
export const pngSize = (d: Buffer) => ({ width: d.readUInt32BE(16), height: d.readUInt32BE(20) });
