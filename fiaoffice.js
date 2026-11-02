// FiaDocs, FiaSheets and FiaSlides. Open formats only (Markdown, HTML, ODT, ODS, CSV).
// Stored in data/office.json. Print-to-PDF is the formatted page. No proprietary formats.
'use strict';
const fs = require('fs'), path = require('path');
const hub = require('./fiaos-core');
const notes = require('./fianotes');
const studio = require('./fiastudio');
const FILE = path.join(hub.DATA, 'office.json');
const uid = () => Math.random().toString(36).slice(2, 10);
const clip = (s, n) => String(s ?? '').slice(0, n);
function blank() { return { docs: [], books: [], decks: [] }; }
function load() { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); d.docs ??= []; d.books ??= []; d.decks ??= []; return d; } catch { return blank(); } }
let DB = null;
function db() { if (!DB) DB = load(); return DB; }
function save() { fs.mkdirSync(hub.DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db(), null, 1), { mode: 0o600 }); fs.renameSync(FILE + '.tmp', FILE); }
const TEMPLATES = {
  blank: () => [{ id: uid(), type: 'h1', text: 'Untitled' }, { id: uid(), type: 'p', text: '' }],
  letter: () => [{ id: uid(), type: 'h1', text: 'Letter' }, { id: uid(), type: 'p', text: 'Dear …' }, { id: uid(), type: 'p', text: '' }, { id: uid(), type: 'p', text: 'Yours,' }],
  meeting: () => [{ id: uid(), type: 'h1', text: 'Meeting' }, { id: uid(), type: 'ul', items: ['Who was there', 'What we decided', 'Who does what'] }],
  clinic: () => [{ id: uid(), type: 'h1', text: 'Clinic note' }, { id: uid(), type: 'p', text: 'Person:' }, { id: uid(), type: 'ul', items: ['What we practised', 'What to try at home'] }]
};
function cleanBlocks(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 80).map(b => {
    const type = ['h1', 'h2', 'p', 'ul', 'ol', 'table', 'image'].includes(b.type) ? b.type : 'p';
    const row = { id: String(b.id || uid()).slice(0, 20), type };
    if (type === 'ul' || type === 'ol') row.items = (b.items || []).slice(0, 40).map(x => clip(x, 500));
    else if (type === 'table') row.rows = (b.rows || []).slice(0, 20).map(r => (r || []).slice(0, 8).map(c => clip(c, 200)));
    else if (type === 'image') { row.assetId = clip(b.assetId, 40); row.alt = clip(b.alt, 120); }
    else row.text = clip(b.text, 8000);
    return row;
  });
}
function saveDoc(b) {
  const d = db();
  const prev = b.id ? d.docs.find(x => x.id === b.id) : null;
  const row = prev || { id: uid(), created: new Date().toISOString(), comments: [], changes: [] };
  if (!prev && b.template && TEMPLATES[b.template]) row.blocks = TEMPLATES[b.template]();
  row.title = clip(b.title ?? row.title, 140) || 'Untitled document';
  if (b.blocks) row.blocks = cleanBlocks(b.blocks);
  row.blocks ??= TEMPLATES.blank();
  row.updated = new Date().toISOString();
  if (b.noteId != null) row.noteId = clip(b.noteId, 40);
  if (!prev) d.docs.unshift(row);
  d.docs = d.docs.slice(0, 40);
  save(); return row;
}
function comment(b) {
  const doc = db().docs.find(x => x.id === b.id); if (!doc) throw new Error('document not found');
  doc.comments ??= [];
  const row = { id: uid(), blockId: clip(b.blockId, 20), text: clip(b.text, 500), by: clip(b.by || 'Bea', 40), at: new Date().toISOString() };
  if (!row.text) throw new Error('comment text needed');
  doc.comments.push(row); save(); return row;
}
function suggest(b) {
  const doc = db().docs.find(x => x.id === b.id); if (!doc) throw new Error('document not found');
  const block = (doc.blocks || []).find(x => x.id === b.blockId); if (!block || block.text == null) throw new Error('that block has no text to revise');
  doc.changes ??= [];
  const row = { id: uid(), blockId: block.id, before: block.text, after: clip(b.after, 8000), by: clip(b.by || 'Bea', 40), at: new Date().toISOString(), status: 'open' };
  doc.changes.push(row); save(); return row;
}
function resolveChange(b) {
  const doc = db().docs.find(x => x.id === b.id); if (!doc) throw new Error('document not found');
  const ch = (doc.changes || []).find(x => x.id === b.changeId); if (!ch) throw new Error('change not found');
  if (b.status === 'accepted') { const block = doc.blocks.find(x => x.id === ch.blockId); if (block) block.text = ch.after; ch.status = 'accepted'; }
  else { ch.status = 'rejected'; }
  save(); return doc;
}
function docToMd(doc) {
  return (doc.blocks || []).map(b => {
    if (b.type === 'h1') return '# ' + (b.text || '');
    if (b.type === 'h2') return '## ' + (b.text || '');
    if (b.type === 'ul') return (b.items || []).map(i => '- ' + i).join('\n');
    if (b.type === 'ol') return (b.items || []).map((i, n) => (n + 1) + '. ' + i).join('\n');
    if (b.type === 'table') return (b.rows || []).map(r => '| ' + r.join(' | ') + ' |').join('\n');
    if (b.type === 'image') return '![' + (b.alt || 'image') + '](asset:' + (b.assetId || '') + ')';
    return b.text || '';
  }).filter(Boolean).join('\n\n') + '\n';
}
function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function odtFromDoc(doc) {
  const files = [];
  const manifest = ['<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>', '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'];
  let body = `<text:h text:outline-level="1">${esc(doc.title)}</text:h>`;
  let n = 0;
  for (const b of doc.blocks || []) {
    if (b.type === 'h2') body += `<text:h text:outline-level="2">${esc(b.text)}</text:h>`;
    else if (b.type === 'ul' || b.type === 'ol') body += (b.items || []).map(i => `<text:p>${b.type === 'ul' ? '• ' : ''}${esc(i)}</text:p>`).join('');
    else if (b.type === 'table') body += (b.rows || []).map(r => `<text:p>${esc(r.join(' · '))}</text:p>`).join('');
    else if (b.type === 'image' && b.assetId) {
      try {
        const { row, full } = studio.assetPath(b.assetId);
        const buf = fs.readFileSync(full);
        n++;
        const name = `Pictures/img${n}${row.ext}`;
        files.push({ name, data: buf });
        manifest.push(`<manifest:file-entry manifest:full-path="${name}" manifest:media-type="${esc(row.mime)}"/>`);
        body += `<text:p><draw:frame draw:name="img${n}" svg:width="8cm" svg:height="6cm"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`;
      } catch { body += `<text:p>${esc(b.alt || 'Picture missing')}</text:p>`; }
    } else body += `<text:p>${esc(b.text || '')}</text:p>`;
  }
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.3">
<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const man = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">${manifest.join('')}</manifest:manifest>`;
  return studio.zipStore([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true }, { name: 'content.xml', data: content }, { name: 'META-INF/manifest.xml', data: man }, ...files]);
}
function docToHtml(doc, opts = {}) {
  const body = (doc.blocks || []).map(b => {
    if (b.type === 'h1') return '<h1>' + esc(b.text) + '</h1>';
    if (b.type === 'h2') return '<h2>' + esc(b.text) + '</h2>';
    if (b.type === 'ul') return '<ul>' + (b.items || []).map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
    if (b.type === 'ol') return '<ol>' + (b.items || []).map(i => '<li>' + esc(i) + '</li>').join('') + '</ol>';
    if (b.type === 'table') return '<table>' + (b.rows || []).map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</table>';
    if (b.type === 'image') {
      if (!b.assetId) return '<p><em>' + esc(b.alt || 'Image') + '</em></p>';
      return '<p><img alt="' + esc(b.alt || '') + '" src="/api/studio/assets/file?id=' + encodeURIComponent(b.assetId) + '" style="max-width:100%"></p>';
    }
    return '<p>' + esc(b.text).replace(/\n/g, '<br>') + '</p>';
  }).join('');
  const notes = (doc.comments || []).map(c => '<li>' + esc(c.by) + ': ' + esc(c.text) + '</li>').join('');
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
body{font:16px system-ui,sans-serif;max-width:740px;margin:32px auto;color:#14202b;line-height:1.5}table{border-collapse:collapse}td{border:1px solid #ccc;padding:6px}
@media print{body{margin:12px}}
</style></head><body><h1>${esc(doc.title)}</h1>${body}${notes && opts.comments ? '<h2>Comments</h2><ul>' + notes + '</ul>' : ''}<p style="color:#666">FiaDocs · print this page and choose Save as PDF.</p></body></html>`;
}
function saveBook(b) {
  const d = db();
  const prev = b.id ? d.books.find(x => x.id === b.id) : null;
  const row = prev || { id: uid(), created: new Date().toISOString(), sheets: [{ name: 'Sheet1', cells: {} }] };
  row.title = clip(b.title ?? row.title, 140) || 'Untitled book';
  if (Array.isArray(b.sheets) && b.sheets.length) {
    row.sheets = b.sheets.slice(0, 12).map((s, i) => ({
      name: clip(s.name, 31) || ('Sheet' + (i + 1)),
      cells: cleanCells(s.cells)
    }));
  }
  row.updated = new Date().toISOString();
  if (!prev) d.books.unshift(row);
  save(); return bookView(row);
}
function cleanCells(obj) {
  const cells = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const ref = String(k).toUpperCase();
    if (!/^[A-Z]{1,3}[1-9][0-9]{0,3}$/.test(ref)) continue;
    const s = String(v ?? '').slice(0, 500);
    if (s) cells[ref] = s;
    if (Object.keys(cells).length > 2000) break;
  }
  return cells;
}
function bookView(book) {
  const sheets = (book.sheets || []).map(s => ({ name: s.name, cells: s.cells, values: notes.evalSheet(s.cells) }));
  return { ...book, sheets };
}
function sheetCsv(sheet) {
  const values = notes.evalSheet(sheet.cells || {});
  let maxC = 1, maxR = 1;
  for (const ref of Object.keys(sheet.cells || {})) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) continue;
    let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    maxC = Math.max(maxC, c); maxR = Math.max(maxR, +m[2]);
  }
  const rows = [];
  for (let r = 1; r <= maxR; r++) {
    const row = [];
    for (let c = 1; c <= maxC; c++) {
      let name = ''; let n = c;
      while (n > 0) { const m = (n - 1) % 26; name = String.fromCharCode(65 + m) + name; n = Math.floor((n - 1) / 26); }
      const v = values[name + r];
      const raw = (sheet.cells || {})[name + r] || '';
      const show = raw.startsWith('=') ? (v && !v.error ? v.value : raw) : raw;
      const s = String(show ?? '');
      row.push(/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    }
    rows.push(row.join(','));
  }
  return rows.join('\n') + '\n';
}
function ods(book) {
  const tables = (book.sheets || []).map(s => {
    const values = notes.evalSheet(s.cells || {});
    let maxC = 1, maxR = 1;
    for (const ref of Object.keys(s.cells || {})) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) continue;
      let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
      maxC = Math.max(maxC, c); maxR = Math.max(maxR, +m[2]);
    }
    let rows = '';
    for (let r = 1; r <= maxR; r++) {
      let cells = '';
      for (let c = 1; c <= maxC; c++) {
        let name = ''; let n = c;
        while (n > 0) { const m = (n - 1) % 26; name = String.fromCharCode(65 + m) + name; n = Math.floor((n - 1) / 26); }
        const v = values[name + r];
        const text = v && !v.error && v.value != null ? String(v.value) : '';
        const num = v && v.type === 'num';
        cells += num ? `<table:table-cell office:value-type="float" office:value="${text}"><text:p>${esc(text)}</text:p></table:table-cell>` : `<table:table-cell office:value-type="string"><text:p>${esc(text)}</text:p></table:table-cell>`;
      }
      rows += '<table:table-row>' + cells + '</table:table-row>';
    }
    return `<table:table table:name="${esc(s.name)}">${rows}</table:table>`;
  }).join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">
<office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  return studio.zipStore([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.spreadsheet', store: true },
    { name: 'content.xml', data: content },
    { name: 'META-INF/manifest.xml', data: manifest }
  ]);
}
const THEMES = {
  ink: { bg: '#141820', fg: '#f4f1ea', accent: '#39C5BB' },
  paper: { bg: '#f7f3ea', fg: '#1c2430', accent: '#0b6e75' },
  clinic: { bg: '#10241f', fg: '#e7f6f2', accent: '#8fd0c6' }
};
function saveDeck(b) {
  const d = db();
  const prev = b.id ? d.decks.find(x => x.id === b.id) : null;
  const row = prev || { id: uid(), created: new Date().toISOString() };
  row.title = clip(b.title ?? row.title, 140) || 'Untitled deck';
  row.theme = THEMES[b.theme] ? b.theme : (row.theme || 'ink');
  row.transition = ['none', 'fade', 'rise', 'wipe', 'zoom', 'flip'].includes(b.transition) ? b.transition : (row.transition || 'fade');
  row.seconds = Math.max(1, Math.min(30, +b.seconds || row.seconds || 4));
  if (Array.isArray(b.slides)) {
    row.slides = b.slides.slice(0, 40).map(s => ({
      layout: ['title', 'body', 'split'].includes(s.layout) ? s.layout : 'body',
      title: clip(s.title, 160), body: clip(s.body, 2000), notes: clip(s.notes, 1000), aside: clip(s.aside, 800)
    }));
  }
  row.slides ??= [{ layout: 'title', title: row.title, body: '', notes: '' }];
  row.updated = new Date().toISOString();
  if (!prev) d.decks.unshift(row);
  save(); return row;
}
function deckHtml(deck, present, play) {
  const theme = THEMES[deck.theme] || THEMES.ink;
  const name = ['fade', 'rise', 'wipe', 'zoom', 'flip'].includes(deck.transition) ? deck.transition : 'none';
  const anim = name === 'none' ? 'none' : name + ' .45s ease';
  const slides = (deck.slides || []).map((s, i) => {
    const next = deck.slides[i + 1];
    const main = s.layout === 'split'
      ? `<div class="split"><div><h1>${esc(s.title)}</h1><p>${esc(s.body).replace(/\n/g, '<br>')}</p></div><div><p>${esc(s.aside || '')}</p></div></div>`
      : `<h1>${esc(s.title || 'Slide')}</h1>${s.layout === 'title' ? '' : `<p>${esc(s.body).replace(/\n/g, '<br>')}</p>`}`;
    const notes = present ? `<aside class="notes"><b>Notes</b><p>${esc(s.notes || '—')}</p>${next ? '<b>Next</b><p>' + esc(next.title || '') + '</p>' : ''}</aside>` : (s.notes ? `<aside class="notes printonly">${esc(s.notes)}</aside>` : '');
    return `<section class="slide">${main}${notes}</section>`;
  }).join('');
  const seconds = Math.max(1, Math.min(30, +deck.seconds || 4));
  const script = play ? `<script>const slides=[...document.querySelectorAll('.slide')];let i=0;function show(n){slides.forEach((s,j)=>s.classList.toggle('on',j===n))}show(0);setInterval(()=>{i=(i+1)%slides.length;show(i)},${seconds * 1000});document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){i=(i+1)%slides.length;show(i)}if(e.key==='ArrowLeft'){i=(i+slides.length-1)%slides.length;show(i)}});</script>` : '';
  return `<!doctype html><html lang="en-AU" data-theme="${esc(deck.theme)}"><head><meta charset="utf-8"><title>${esc(deck.title)}</title><style>
body{margin:0;background:${theme.bg};color:${theme.fg};font:22px system-ui,sans-serif}
.slide{min-height:100vh;padding:10vh 8vw;box-sizing:border-box;animation:${anim}}
${play ? '.slide{display:none}.slide.on{display:block}' : ''}
h1{font-size:52px;margin:0 0 18px;color:${theme.accent}} .split{display:grid;grid-template-columns:1.2fr .8fr;gap:32px}
.notes{display:${present ? 'block' : 'none'};margin-top:28px;font-size:16px;opacity:.85}
.printonly{display:none}
@keyframes fade{from{opacity:0}} @keyframes rise{from{opacity:0;transform:translateY(16px)}}
@keyframes wipe{from{clip-path:inset(0 100% 0 0)}} @keyframes zoom{from{opacity:0;transform:scale(.92)}}
@keyframes flip{from{opacity:0;transform:rotateY(70deg)}}
@media print{.slide{display:block!important;page-break-after:always;animation:none} .printonly{display:block;color:#333;font-size:14px}}
</style></head><body>${slides}<p style="padding:12px;opacity:.5">FiaSlides · ${esc(name)} · ${play ? 'playing every ' + seconds + 's · ' : ''}print to save as PDF.</p>${script}</body></html>`;
}
function index() {
  const d = db();
  return {
    docs: d.docs.map(({ blocks, comments, changes, ...m }) => ({ ...m, blocks: (blocks || []).length, comments: (comments || []).length, openChanges: (changes || []).filter(c => c.status === 'open').length })),
    books: d.books.map(b => ({ id: b.id, title: b.title, sheets: (b.sheets || []).map(s => s.name), updated: b.updated })),
    decks: d.decks.map(s => ({ id: s.id, title: s.title, theme: s.theme, slides: (s.slides || []).length, updated: s.updated })),
    templates: Object.keys(TEMPLATES), themes: Object.keys(THEMES)
  };
}
function asMail(b) {
  const doc = db().docs.find(x => x.id === b.id);
  const deck = db().decks.find(x => x.id === b.id);
  const book = db().books.find(x => x.id === b.id);
  const item = doc || deck || book;
  if (!item) throw new Error('not found');
  const text = doc ? docToMd(doc) : deck ? (deck.slides || []).map(s => (s.title || '') + '\n' + (s.body || '')).join('\n\n') : (book.sheets || []).map(s => s.name).join(', ');
  const mail = require('./fiamail');
  const message = mail.upsertMessage({ person: b.person || 'Bea', folder: 'Drafts', from: 'Bea', to: b.to || '', subject: item.title, body: text, unread: false, noteId: b.noteId || '' });
  let event = null, note = null;
  if (b.event) event = mail.addEvent({ person: b.person || 'Bea', title: item.title, start: new Date().toLocaleDateString('en-CA') + 'T09:00:00', notes: text.slice(0, 500) });
  if (b.note) note = require('./fianotes').upsertNote({ kind: 'doc', title: item.title, body: text, folder: 'inbox', tags: ['office'], person: b.person || 'Bea' });
  return { ok: true, message, event, note };
}
function handle(req, res, u, readBody) {
  const send = (c, o, type) => { res.writeHead(c, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(Buffer.isBuffer(o) || typeof o === 'string' ? o : JSON.stringify(o)); };
  if (!hub.localOnly(req)) return send(403, { error: 'local only' });
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
  return (async () => {
    try {
      const r = u.pathname, d = db();
      if (r === '/api/office') return send(200, index());
      if (r === '/api/office/doc' && req.method === 'GET') { const x = d.docs.find(i => i.id === u.searchParams.get('id')); if (!x) return send(404, { error: 'not found' }); return send(200, x); }
      if (r === '/api/office/doc' && req.method === 'POST') return send(200, saveDoc(await J()));
      if (r === '/api/office/doc/comment' && req.method === 'POST') return send(200, comment(await J()));
      if (r === '/api/office/doc/suggest' && req.method === 'POST') return send(200, suggest(await J()));
      if (r === '/api/office/doc/resolve' && req.method === 'POST') return send(200, resolveChange(await J()));
      if (r === '/api/office/doc/export') {
        const x = d.docs.find(i => i.id === u.searchParams.get('id')); if (!x) return send(404, { error: 'not found' });
        const fmt = u.searchParams.get('fmt') || 'md';
        if (fmt === 'html') return send(200, docToHtml(x, { comments: true }), 'text/html; charset=utf-8');
        if (fmt === 'odt') return send(200, odtFromDoc(x), 'application/vnd.oasis.opendocument.text');
        return send(200, docToMd(x), 'text/markdown; charset=utf-8');
      }
      if (r === '/api/office/book' && req.method === 'GET') { const x = d.books.find(i => i.id === u.searchParams.get('id')); if (!x) return send(404, { error: 'not found' }); return send(200, bookView(x)); }
      if (r === '/api/office/book' && req.method === 'POST') return send(200, saveBook(await J()));
      if (r === '/api/office/book/sort' && req.method === 'POST') {
        const b = await J(); const book = d.books.find(i => i.id === b.id); if (!book) throw new Error('book not found');
        const sheet = book.sheets[b.sheet || 0]; if (!sheet) throw new Error('sheet not found');
        sheet.cells = notes.sortRange(sheet.cells, b.from || 'A1', b.to || 'A1', +b.col || 0, b.dir === 'desc' ? 'desc' : 'asc');
        save(); return send(200, bookView(book));
      }
      if (r === '/api/office/book/chart') {
        const book = d.books.find(i => i.id === u.searchParams.get('id')); if (!book) return send(404, { error: 'not found' });
        const sheet = book.sheets[+u.searchParams.get('sheet') || 0];
        return send(200, notes.chartFrom(sheet.cells, u.searchParams.get('from') || 'A1', u.searchParams.get('to') || 'B4', u.searchParams.get('kind') || 'bar'), 'image/svg+xml');
      }
      if (r === '/api/office/book/export') {
        const book = d.books.find(i => i.id === u.searchParams.get('id')); if (!book) return send(404, { error: 'not found' });
        if ((u.searchParams.get('fmt') || '') === 'ods') return send(200, ods(book), 'application/vnd.oasis.opendocument.spreadsheet');
        const sheet = book.sheets[+u.searchParams.get('sheet') || 0];
        return send(200, sheetCsv(sheet), 'text/csv; charset=utf-8');
      }
      if (r === '/api/office/deck' && req.method === 'GET') { const x = d.decks.find(i => i.id === u.searchParams.get('id')); if (!x) return send(404, { error: 'not found' }); return send(200, x); }
      if (r === '/api/office/deck' && req.method === 'POST') return send(200, saveDeck(await J()));
      if (r === '/api/office/deck/html') {
        const x = d.decks.find(i => i.id === u.searchParams.get('id')); if (!x) return send(404, { error: 'not found' });
        return send(200, deckHtml(x, u.searchParams.get('view') === 'present', u.searchParams.get('play') === '1'), 'text/html; charset=utf-8');
      }
      if (r === '/api/office/mail' && req.method === 'POST') return send(200, asMail(await J()));
      return send(404, { error: 'not found' });
    } catch (e) { if (!res.headersSent) send(400, { error: e.message || 'error' }); }
  })();
}
function start() {
  db();
  hub.register('office', terms => {
    const d = db();
    const rows = [
      ...d.docs.map(x => ({ kind: 'doc', id: x.id, title: x.title, snippet: 'FiaDocs' })),
      ...d.books.map(x => ({ kind: 'book', id: x.id, title: x.title, snippet: 'FiaSheets' })),
      ...d.decks.map(x => ({ kind: 'deck', id: x.id, title: x.title, snippet: 'FiaSlides' }))
    ];
    return rows.filter(x => hub.match(terms, x.title)).slice(0, 8).map(x => ({ ...x, tab: 'Studio', score: 3 }));
  });
}
module.exports = { handle, start, TEMPLATES, docToMd, docToHtml, odtFromDoc, THEMES, deckHtml, saveDoc, saveBook, saveDeck, suggest, resolveChange, _db: db, _blank() { DB = blank(); return DB; } };
