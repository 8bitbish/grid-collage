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

/* A baseline JPEG carrying a real EXIF DateTimeOriginal.
 *
 * test-photodates, test-place and test-events each hand-carry a copy of this,
 * which is three too many; this is the same builder, here so the fourth
 * consumer does not make it four. Those three are left alone deliberately —
 * moving them is a change to tests that currently pass, and belongs in its own
 * branch rather than riding along with a fix to the app.
 *
 * `dateText` is EXIF's own format, "YYYY:MM:DD HH:MM:SS". Pass null for a file
 * with no EXIF block at all.
 */
export function exifJpeg(dateText) {
  const b = [];
  const u8 = (...v) => b.push(...v);
  const u16 = (v) => b.push((v >> 8) & 255, v & 255);
  u16(0xffd8);

  if (dateText) {
    // TIFF: little-endian, IFD0 holding one entry (the Exif sub-IFD pointer),
    // then the sub-IFD with DateTimeOriginal as 20 bytes of ASCII.
    const tiff = [];
    const t8 = (...v) => tiff.push(...v);
    const t16 = (v) => tiff.push(v & 255, (v >> 8) & 255);
    const t32 = (v) => tiff.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
    t8(0x49, 0x49); t16(42); t32(8);
    t16(1);
    t16(0x8769); t16(4); t32(1); t32(26);
    t32(0);
    t16(1);
    t16(0x9003); t16(2); t32(20); t32(44);
    t32(0);
    const s = dateText.padEnd(19, ' ').slice(0, 19);
    for (const c of s) tiff.push(c.charCodeAt(0));
    tiff.push(0);
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    u16(0xffe1); u16(app1.length + 2); u8(...app1);
  }

  // A minimal 8x8 baseline frame. Quality is irrelevant; it only has to decode.
  const q = []; for (let i = 0; i < 64; i++) q.push(16);
  u16(0xffdb); u16(67); u8(0); u8(...q);
  u16(0xffc0); u16(11); u8(8); u16(8); u16(8); u8(1); u8(1, 0x11, 0);
  const dcBits = [0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0], dcVals = [0,1,2,3,4,5,6,7,8,9,10,11];
  u16(0xffc4); u16(2 + 1 + 16 + dcVals.length); u8(0x00); u8(...dcBits); u8(...dcVals);
  const acBits = [0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d];
  const acVals = [0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,
    0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,
    0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,
    0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,
    0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,
    0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,
    0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,
    0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,
    0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,
    0xf9,0xfa];
  u16(0xffc4); u16(2 + 1 + 16 + acVals.length); u8(0x10); u8(...acBits); u8(...acVals);
  u16(0xffda); u16(8); u8(1); u8(1, 0x00); u8(0, 63, 0);
  u8(0xfc, 0xff, 0x00);
  u16(0xffd9);
  return Buffer.from(b);
}
