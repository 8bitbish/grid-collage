/* A flat PNG of any size, built here rather than read off disk.
 *
 * Twenty-eight of the tests already do this inline — it is why most of the
 * suite needs no fixture file at all. This is the same builder, shared, for the
 * three tests that were instead reading a JPEG from
 * `/tmp/grid-collage-big-top-4x5.jpg`: a file nothing in the suite ever wrote,
 * absent from git, absent from fixtures/make.sh and absent from the README's
 * fixture table. It was an export the original author had saved by hand, and it
 * went when their container did.
 *
 * Those three only ever needed a photo tall enough to mismatch a square tile
 * badly. None of them samples its colour except to check it is not the
 * background, so a flat one does the job with nothing to obtain.
 */
import zlib from 'node:zlib';

export function png(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = r; raw[off + 2 + x * 3] = g; raw[off + 3 + x * 3] = b;
    }
  }
  const TABLE = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = (buf) => { let c = 0xffffffff; for (const byte of buf) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 4:5, which is what the filename of the lost fixture was telling us, at the
// size a phone camera would hand over rather than something token.
export const TALL = () => png(1080, 1350, [40, 120, 200]);
