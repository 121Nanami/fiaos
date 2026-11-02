// Tiny PNG codec for 8-bit RGB and RGBA. Open format, inflate via Node's zlib. Used to flatten photos on the server.
'use strict';
const zlib = require('zlib');
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type), body = Buffer.concat([t, data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba).copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
function decodePNG(buf) {
  if (buf[0] !== 137 || buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a png');
  let w = 0, h = 0, depth = 0, color = 0, idat = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8); const data = buf.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; if (depth !== 8 || (color !== 2 && color !== 6)) throw new Error('only 8-bit rgb or rgba png'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const bpp = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]; const row = Buffer.from(raw.slice(p, p + stride)); p += stride;
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0, up = prev[i], ul = i >= bpp ? prev[i - bpp] : 0, x = row[i];
      if (filter === 0) cur[i] = x;
      else if (filter === 1) cur[i] = (x + left) & 255;
      else if (filter === 2) cur[i] = (x + up) & 255;
      else if (filter === 3) cur[i] = (x + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) cur[i] = (x + paeth(left, up, ul)) & 255;
      else throw new Error('bad png filter');
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp, d = (y * w + x) * 4;
      if (bpp === 4) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3]; }
      else { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = 255; }
    }
    prev = cur;
  }
  return { rgba: out, w, h };
}
function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function flattenPhoto(rgba, w, h, photo) {
  const crop = photo.crop || { x: 0, y: 0, w: 1, h: 1 };
  const exposure = +photo.exposure || 0, contrast = +photo.contrast || 0, saturate = photo.saturate == null ? 1 : +photo.saturate;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(crop.x * w)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(crop.y * h)));
  const cw = Math.max(1, Math.min(w - x0, Math.floor((crop.w || 1) * w)));
  const ch = Math.max(1, Math.min(h - y0, Math.floor((crop.h || 1) * h)));
  const out = Buffer.alloc(cw * ch * 4);
  const e = Math.pow(2, exposure), c = 1 + contrast;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const si = ((y0 + y) * w + (x0 + x)) * 4, di = (y * cw + x) * 4;
    let r = rgba[si] * e, g = rgba[si + 1] * e, b = rgba[si + 2] * e;
    r = (r - 128) * c + 128; g = (g - 128) * c + 128; b = (b - 128) * c + 128;
    const yy = r * 0.3 + g * 0.59 + b * 0.11;
    out[di] = clamp(yy + (r - yy) * saturate);
    out[di + 1] = clamp(yy + (g - yy) * saturate);
    out[di + 2] = clamp(yy + (b - yy) * saturate);
    out[di + 3] = rgba[si + 3];
  }
  return { rgba: out, w: cw, h: ch };
}
module.exports = { encodePNG, decodePNG, flattenPhoto };
