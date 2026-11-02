// FiaOS studio: paint (PNG), draw (SVG), slides (HTML), and a clip list.
// Open formats only. ffmpeg is used for a trim when it is installed; otherwise the in/out points are saved.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), child = require('child_process');
const hub = require('./fiaos-core');
const FILE = path.join(hub.DATA, 'studio.json');
const uid = () => Math.random().toString(36).slice(2, 10);
const ASSET = path.join(hub.DATA, 'assets');
const ASSET_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
function load() { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); d.paint ??= []; d.draw ??= []; d.slides ??= []; d.clips ??= []; d.photos ??= []; d.layouts ??= []; d.assets ??= []; return d; } catch { return { paint: [], draw: [], slides: [], clips: [], photos: [], layouts: [], assets: [] }; } }
function save(db) { fs.mkdirSync(hub.DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1), { mode: 0o600 }); fs.renameSync(FILE + '.tmp', FILE); }
function zipStore(files) {
  // files: [{name, data:Buffer, store:bool}] — first entry should be the uncompressed mimetype for ODF
  const parts = [], cds = []; let offset = 0;
  for (const f of files) {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data));
    const data = f.store ? raw : zlib.deflateRawSync(raw);
    const nameB = Buffer.from(f.name);
    const sum = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(f.store ? 0 : 8, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(f.store ? 0 : 8, 10);
    cd.writeUInt32LE(sum, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(offset, 42);
    cds.push(Buffer.concat([cd, nameB]));
    offset += local.length + nameB.length + data.length;
  }
  const cdBuf = Buffer.concat(cds), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
function escXml(s) { return String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function odt(title, paragraphs) {
  const body = [`<text:h text:outline-level="1">${escXml(title)}</text:h>`, ...(paragraphs || []).map(p => `<text:p>${escXml(p)}</text:p>`)].join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">
<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  return zipStore([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true },
    { name: 'content.xml', data: content },
    { name: 'META-INF/manifest.xml', data: manifest }
  ]);
}
function slideHtml(deck) {
  const slides = (deck.slides || []).map((s, i) => `<section class="slide"><h1>${escXml(s.title || 'Slide ' + (i + 1))}</h1><div>${escXml(s.body || '').replace(/\n/g, '<br>')}</div>${s.notes ? `<aside class="notes">${escXml(s.notes)}</aside>` : ''}</section>`).join('');
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>${escXml(deck.title || 'Slides')}</title><style>
body{margin:0;font:22px system-ui,sans-serif;background:#111;color:#f4f1ea}section{min-height:100vh;padding:8vh 10vw;box-sizing:border-box}
h1{font-size:48px;margin:0 0 24px}aside.notes{display:none}@media print{section{page-break-after:always}aside.notes{display:block;color:#444;font-size:14px;margin-top:2em}}
</style></head><body>${slides}<p style="padding:12px;color:#888">FiaSlides · print this page to keep a copy.</p></body></html>`;
}
const BLENDS = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];
function savePaint(b) {
  const layers = (Array.isArray(b.layers) ? b.layers : []).slice(0, 8).map((l, i) => {
    const png = String(l.png || '');
    if (!/^data:image\/(png|webp)/.test(png)) throw new Error('each layer needs a PNG or WebP');
    if (png.length > 1_500_000) throw new Error('a layer is over the size limit');
    return { id: String(l.id || uid()).slice(0, 16), name: String(l.name || ('Layer ' + (i + 1))).slice(0, 40), png, opacity: Math.max(0, Math.min(1, l.opacity == null ? 1 : +l.opacity)), blend: BLENDS.includes(l.blend) ? l.blend : 'source-over', visible: l.visible !== false };
  });
  const png = String(b.png || (layers[0] && layers[0].png) || '');
  if (!layers.length && !/^data:image\/(png|webp)/.test(png)) throw new Error('PNG or WebP data needed');
  if (png && png.length > 1_800_000) throw new Error('painting is too large');
  const db = load();
  const row = { id: b.id || uid(), title: String(b.title || 'Painting').slice(0, 80), png, layers, at: new Date().toISOString() };
  const i = db.paint.findIndex(p => p.id === row.id); if (i >= 0) db.paint[i] = row; else db.paint.unshift(row);
  db.paint = db.paint.slice(0, 12); save(db); return { id: row.id, title: row.title, layers: row.layers.map(({ png: _p, ...m }) => m), at: row.at };
}
function num(n, d = 0) { const x = +n; return Number.isFinite(x) ? x : d; }
function cleanShape(s) {
  const type = ['rect', 'ellipse', 'text', 'path'].includes(s.type) ? s.type : 'rect';
  const row = { id: String(s.id || uid()).slice(0, 12), type, x: num(s.x), y: num(s.y), fill: String(s.fill || '').slice(0, 20), stroke: String(s.stroke || '').slice(0, 20) };
  if (type === 'text') { row.text = String(s.text || '').slice(0, 80); row.size = num(s.size, 28); }
  else if (type === 'path') { row.d = String(s.d || '').replace(/[^0-9MmLlHhVvCcSsQqTtAaZz., \-]/g, '').slice(0, 4000); row.width = num(s.width, 2); row.fillRule = s.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'; }
  else { row.w = num(s.w, 40); row.h = num(s.h, 40); }
  return row;
}
function shapesToSvg(shapes, w = 640, h = 360) {
  const body = (shapes || []).map(s => {
    if (s.type === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${s.fill || '#39C5BB'}"/>`;
    if (s.type === 'ellipse') return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${Math.abs(s.w) / 2}" ry="${Math.abs(s.h) / 2}" fill="${s.fill || '#E12885'}"/>`;
    if (s.type === 'text') return `<text x="${s.x}" y="${s.y}" fill="${s.fill || '#f4f1ea'}" font-size="${s.size || 28}" font-family="sans-serif">${escXml(s.text || '')}</text>`;
    if (s.type === 'path') return `<path d="${s.d}" fill="${s.fill || 'none'}" stroke="${s.stroke || '#39C5BB'}" stroke-width="${s.width || 2}" fill-rule="${s.fillRule || 'nonzero'}"/>`;
    return '';
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#141820"/>${body}</svg>`;
}
function unionRects(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { type: 'rect', x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, fill: a.fill || b.fill || '#39C5BB' };
}
function subtractRects(a, b) {
  const d = `M ${a.x} ${a.y} h ${a.w} v ${a.h} h ${-a.w} z M ${b.x} ${b.y} h ${b.w} v ${b.h} h ${-b.w} z`;
  return { type: 'path', d, fill: a.fill || '#39C5BB', fillRule: 'evenodd', stroke: 'none', width: 0 };
}
function filterPixels(rgba, kind) {
  const out = Buffer.from(rgba);
  for (let i = 0; i + 3 < out.length; i += 4) {
    if (kind === 'gray') { const y = Math.round(out[i] * 0.3 + out[i + 1] * 0.59 + out[i + 2] * 0.11); out[i] = out[i + 1] = out[i + 2] = y; }
    else if (kind === 'invert') { out[i] = 255 - out[i]; out[i + 1] = 255 - out[i + 1]; out[i + 2] = 255 - out[i + 2]; }
    else throw new Error('filter is gray or invert');
  }
  return out;
}
function saveDraw(b) {
  let svg = String(b.svg || '');
  let shapes = null;
  if (Array.isArray(b.shapes)) { shapes = b.shapes.slice(0, 200).map(cleanShape); svg = shapesToSvg(shapes, num(b.w, 640), num(b.h, 360)); }
  if (!svg.includes('<svg')) throw new Error('SVG needed');
  if (/<script/i.test(svg)) throw new Error('scripts are not kept in a drawing');
  if (svg.length > 400000) throw new Error('drawing is too large');
  const db = load();
  const row = { id: b.id || uid(), title: String(b.title || 'Drawing').slice(0, 80), svg, at: new Date().toISOString() };
  if (shapes) row.shapes = shapes;
  const i = db.draw.findIndex(p => p.id === row.id); if (i >= 0) db.draw[i] = row; else db.draw.unshift(row);
  db.draw = db.draw.slice(0, 20); save(db); return row;
}
function saveSlides(b) {
  const slides = (Array.isArray(b.slides) ? b.slides : []).slice(0, 30).map(s => ({ title: String(s.title || '').slice(0, 120), body: String(s.body || '').slice(0, 2000), notes: String(s.notes || '').slice(0, 1000) }));
  if (!slides.length) throw new Error('at least one slide');
  const db = load();
  const row = { id: b.id || uid(), title: String(b.title || 'Untitled deck').slice(0, 80), slides, at: new Date().toISOString() };
  const i = db.slides.findIndex(p => p.id === row.id); if (i >= 0) db.slides[i] = row; else db.slides.unshift(row);
  save(db); return row;
}
function saveClip(b) {
  const db = load();
  const row = { id: b.id || uid(), title: String(b.title || 'Clip').slice(0, 80), file: String(b.file || '').slice(0, 300), start: Math.max(0, +b.start || 0), end: Math.max(0, +b.end || 0), at: new Date().toISOString() };
  db.clips.unshift(row); db.clips = db.clips.slice(0, 30); save(db); return row;
}
function which(bin) { return (process.env.PATH || '').split(':').map(d => path.join(d, bin)).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || ''; }
function clipPlan(file, segments) {
  const spans = (segments && segments.length ? segments : [{ start: 0, end: 1 }]).filter(s => +s.end > +s.start);
  const ext = /\.mp4$/i.test(file) ? '.mp4' : '.webm';
  const cuts = spans.map((s, i) => ({
    file: `part${i}${ext}`,
    args: ['-y', '-ss', String(+s.start), '-to', String(+s.end), '-i', file, '-c', 'copy', `part${i}${ext}`]
  }));
  const list = cuts.map(c => `file '${c.file}'`).join('\n');
  const concat = ['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', `out${ext}`];
  return { ext, cuts, list, concat, spans };
}
function trim(b) {
  const segments = (b.segments && b.segments.length) ? b.segments : [{ start: b.start, end: b.end, label: '' }];
  const clip = saveTimeline({ ...b, segments });
  const plan = clipPlan(b.file || 'clip', segments);
  if (!plan.spans.length) return { ok: false, clip, error: 'Add a span whose end is after its start.' };
  const ffmpeg = which('ffmpeg');
  if (!ffmpeg) return { ok: false, stub: true, clip, plan: { cuts: plan.cuts.length }, error: 'ffmpeg is not installed, so the timeline is saved and the file is left whole.' };
  let media; try { media = require('./fiamedia'); } catch { return { ok: false, clip, error: 'media library missing' }; }
  const src = media.safeJoin(decodeURIComponent(b.file || ''));
  if (!fs.existsSync(src)) return { ok: false, stub: true, clip, error: 'That file is not in the media library.' };
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bea-clip-'));
  const made = [];
  try {
    plan.spans.forEach((s, i) => {
      const part = path.join(tmp, `part${i}${plan.ext}`);
      child.execFileSync(ffmpeg, ['-y', '-ss', String(s.start), '-to', String(s.end), '-i', src, '-c', 'copy', part], { timeout: 120000 });
      made.push(part);
    });
    let dest = src.replace(/(\.\w+)?$/, '') + '-edit' + plan.ext;
    if (made.length === 1) fs.copyFileSync(made[0], dest);
    else {
      fs.writeFileSync(path.join(tmp, 'list.txt'), made.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
      try { child.execFileSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-c', 'copy', dest], { timeout: 120000 }); }
      catch { dest = dest.replace(/\.\w+$/, '.webm'); child.execFileSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-c:v', 'libvpx', '-c:a', 'libvorbis', dest], { timeout: 180000 }); }
    }
    return { ok: true, clip, file: path.basename(dest), spans: plan.spans.length };
  } finally {
    for (const p of made) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
function batchPhotos() {
  const png = require('./png');
  const db = load();
  let mediaDir; try { mediaDir = require('./fiamedia').DIR; } catch { mediaDir = path.join(hub.DATA, 'media'); }
  fs.mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
  const exported = [], skipped = [];
  for (const photo of db.photos) {
    try {
      if (!photo.assetId) throw new Error('no picture');
      const { row, full } = assetPath(photo.assetId);
      if (row.mime !== 'image/png') { skipped.push({ id: photo.id, error: 'batch flatten reads PNG pictures (save or upload a PNG)' }); continue; }
      const decoded = png.decodePNG(fs.readFileSync(full));
      const flat = png.flattenPhoto(decoded.rgba, decoded.w, decoded.h, photo);
      const name = 'photo-' + photo.id + '.png';
      fs.writeFileSync(path.join(mediaDir, name), png.encodePNG(flat.rgba, flat.w, flat.h));
      exported.push({ id: photo.id, file: name, w: flat.w, h: flat.h });
    } catch (e) { skipped.push({ id: photo.id, error: e.message }); }
  }
  return { ok: true, exported, skipped };
}
function saveAsset(b) {
  const ext = ASSET_MIME[b.mime]; if (!ext) throw new Error('use png, jpeg, webp or svg');
  let buf;
  if (b.mime === 'image/svg+xml' && b.text) { if (/<script/i.test(b.text)) throw new Error('scripts are not kept'); buf = Buffer.from(String(b.text)); }
  else buf = Buffer.from(String(b.data || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.length < 8 || buf.length > 2_000_000) throw new Error('file is empty or over 2 MB');
  fs.mkdirSync(ASSET, { recursive: true, mode: 0o700 });
  const row = { id: uid(), name: String(b.name || 'asset').slice(0, 80), mime: b.mime, ext, at: new Date().toISOString() };
  fs.writeFileSync(path.join(ASSET, row.id + ext), buf, { mode: 0o600 });
  const db = load(); db.assets.unshift(row); db.assets = db.assets.slice(0, 80); save(db); return row;
}
function assetPath(id) {
  const row = load().assets.find(a => a.id === id); if (!row) throw new Error('asset not found');
  const full = path.join(ASSET, row.id + row.ext);
  if (!full.startsWith(ASSET)) throw new Error('bad path');
  return { row, full };
}
function savePhoto(b) {
  const db = load();
  const prev = b.id ? db.photos.find(p => p.id === b.id) : null;
  const crop = b.crop || {};
  const row = prev || { id: uid() };
  row.title = String(b.title || row.title || 'Photo').slice(0, 80);
  row.assetId = String(b.assetId || row.assetId || '');
  row.exposure = Math.max(-1, Math.min(1, +b.exposure || 0));
  row.contrast = Math.max(-1, Math.min(1, +b.contrast || 0));
  row.saturate = Math.max(0, Math.min(2, b.saturate == null ? (row.saturate ?? 1) : +b.saturate));
  row.crop = { x: num(crop.x), y: num(crop.y), w: Math.max(0.05, Math.min(1, num(crop.w, 1))), h: Math.max(0.05, Math.min(1, num(crop.h, 1))) };
  row.at = new Date().toISOString();
  if (!prev) db.photos.unshift(row);
  db.photos = db.photos.slice(0, 40); save(db); return row;
}
function saveLayout(b) {
  const db = load();
  const prev = b.id ? db.layouts.find(p => p.id === b.id) : null;
  const row = prev || { id: uid() };
  row.title = String(b.title || row.title || 'Poster').slice(0, 80);
  row.page = ['a4', 'poster', 'square'].includes(b.page) ? b.page : (row.page || 'a4');
  row.items = (b.items || row.items || []).slice(0, 40).map(it => ({
    id: String(it.id || uid()).slice(0, 12), type: it.type === 'image' ? 'image' : 'text',
    x: num(it.x), y: num(it.y), w: num(it.w, 40), h: num(it.h, 20),
    text: String(it.text || '').slice(0, 400), assetId: String(it.assetId || '').slice(0, 20), fill: String(it.fill || '').slice(0, 20)
  }));
  row.at = new Date().toISOString();
  if (!prev) db.layouts.unshift(row);
  save(db); return row;
}
function layoutSvg(layout) {
  const size = layout.page === 'poster' ? [720, 1080] : layout.page === 'square' ? [720, 720] : [794, 1123];
  const items = (layout.items || []).map(it => it.type === 'image'
    ? `<rect x="${it.x}%" y="${it.y}%" width="${it.w}%" height="${it.h}%" fill="${it.fill || '#39C5BB'}"/>`
    : `<text x="${it.x}%" y="${it.y}%" fill="${it.fill || '#f4f1ea'}" font-size="22" font-family="sans-serif">${escXml(it.text || '')}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size[0]} ${size[1]}" width="${size[0]}" height="${size[1]}"><rect width="100%" height="100%" fill="#141820"/>${items}</svg>`;
}
function layoutHtml(layout) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>${escXml(layout.title)}</title><style>
body{margin:0;background:#111;color:#f4f1ea} .page{width:210mm;min-height:297mm;margin:0 auto;background:#141820;position:relative}
.item{position:absolute} @media print{body{background:#fff}}
</style></head><body><div class="page">${(layout.items || []).map(it => `<div class="item" style="left:${it.x}%;top:${it.y}%;width:${it.w}%;height:${it.h}%">${escXml(it.text || '')}</div>`).join('')}</div>
<p style="text-align:center;color:#888">FiaLayout · print this page and choose Save as PDF.</p></body></html>`;
}
function saveTimeline(b) {
  const db = load();
  const segments = (b.segments || []).slice(0, 20).map(s => ({ start: Math.max(0, num(s.start)), end: Math.max(0, num(s.end)), label: String(s.label || '').slice(0, 40) })).filter(s => s.end > s.start);
  const row = { id: b.id || uid(), title: String(b.title || 'Timeline').slice(0, 80), file: String(b.file || '').slice(0, 300), segments, at: new Date().toISOString() };
  db.clips.unshift(row); db.clips = db.clips.slice(0, 30); save(db); return row;
}
function index() {
  const db = load();
  const light = p => ({ id: p.id, title: p.title, at: p.at, layers: (p.layers || []).length });
  return {
    paint: db.paint.map(light),
    draw: db.draw.map(({ svg, ...m }) => ({ ...m, bytes: (svg || '').length })),
    slides: db.slides, clips: db.clips, photos: db.photos, layouts: db.layouts.map(({ items, ...m }) => ({ ...m, items: (items || []).length })),
    assets: db.assets, ffmpeg: !!which('ffmpeg')
  };
}
async function handle(req, res, u, readBody) {
  const send = (c, o, type) => { res.writeHead(c, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(Buffer.isBuffer(o) || typeof o === 'string' ? o : JSON.stringify(o)); };
  if (!hub.localOnly(req)) return send(403, { error: 'local only' });
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
  try {
    const r = u.pathname, db = load();
    if (r === '/api/studio') return send(200, index());
    if (r === '/api/studio/paint' && req.method === 'GET') { const p = db.paint.find(x => x.id === u.searchParams.get('id')); if (!p) return send(404, { error: 'not found' }); return send(200, p); }
    if (r === '/api/studio/paint' && req.method === 'POST') return send(200, savePaint(await J()));
    if (r === '/api/studio/draw' && req.method === 'GET') { const p = db.draw.find(x => x.id === u.searchParams.get('id')); if (!p) return send(404, { error: 'not found' }); if (u.searchParams.get('fmt') === 'svg') return send(200, p.svg, 'image/svg+xml'); return send(200, p); }
    if (r === '/api/studio/draw' && req.method === 'POST') return send(200, saveDraw(await J()));
    if (r === '/api/studio/draw/boolean' && req.method === 'POST') {
      const b = await J();
      const op = b.op === 'intersect' ? 'intersect' : (b.op === 'union' ? 'union' : 'subtract');
      return send(200, booleanShapes(op, b.a, b.b));
    }
    if (r === '/api/studio/slides' && req.method === 'POST') return send(200, saveSlides(await J()));
    if (r === '/api/studio/slides/html') { const p = db.slides.find(x => x.id === u.searchParams.get('id')) || db.slides[0]; if (!p) return send(404, { error: 'not found' }); return send(200, slideHtml(p), 'text/html; charset=utf-8'); }
    if (r === '/api/studio/odt') { const bTitle = u.searchParams.get('title') || 'Note'; const body = u.searchParams.get('body') || ''; return send(200, odt(bTitle, String(body).split(/\n{2,}/)), 'application/vnd.oasis.opendocument.text'); }
    if (r === '/api/studio/clip' && req.method === 'POST') return send(200, trim(await J()));
    if (r === '/api/studio/assets' && req.method === 'GET') return send(200, { assets: db.assets });
    if (r === '/api/studio/assets' && req.method === 'POST') return send(200, saveAsset(await J()));
    if (r === '/api/studio/assets/file') { const { row, full } = assetPath(u.searchParams.get('id')); if (!fs.existsSync(full)) return send(404, { error: 'not found' }); res.writeHead(200, { 'Content-Type': row.mime, 'Cache-Control': 'no-store' }); return fs.createReadStream(full).pipe(res); }
    if (r === '/api/studio/photo' && req.method === 'POST') return send(200, savePhoto(await J()));
    if (r === '/api/studio/photo/batch' && req.method === 'POST') return send(200, batchPhotos());
    if (r === '/api/studio/layout' && req.method === 'POST') return send(200, saveLayout(await J()));
    if (r === '/api/studio/layout/svg') { const p = db.layouts.find(x => x.id === u.searchParams.get('id')) || db.layouts[0]; if (!p) return send(404, { error: 'not found' }); return send(200, layoutSvg(p), 'image/svg+xml'); }
    if (r === '/api/studio/layout/html') { const p = db.layouts.find(x => x.id === u.searchParams.get('id')) || db.layouts[0]; if (!p) return send(404, { error: 'not found' }); return send(200, layoutHtml(p), 'text/html; charset=utf-8'); }
    if (r === '/api/studio/timeline' && req.method === 'POST') return send(200, saveTimeline(await J()));
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message }); }
}
function start() {
  hub.register('studio', terms => {
    const db = load();
    const rows = [...db.draw.map(d => d.title), ...db.slides.map(s => s.title), ...db.paint.map(p => p.title), ...db.clips.map(c => c.title)];
    return rows.filter(t => hub.match(terms, t)).slice(0, 6).map(t => ({ kind: 'studio', id: t, title: t, snippet: 'Studio', tab: 'House', score: 1 }));
  });
}
function booleanShapes(op, a, b) { return require('./pathbool').booleanShapes(op, a, b); }
module.exports = { handle, start, odt, slideHtml, parseDraw: saveDraw, zipStore, shapesToSvg, unionRects, subtractRects, booleanShapes, filterPixels, layoutSvg, savePhoto, saveAsset, savePaint, saveLayout, saveTimeline, clipPlan, assetPath, batchPhotos };
