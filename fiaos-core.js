// Shared local index for the FiaOS house: one search, and links between notes, mail, events, tasks, media.
// JSON under data/links.json. No network. Other modules register a search provider.
'use strict';
const fs = require('fs'), path = require('path');
const DATA = process.env.FIAOS_DATA || path.join(__dirname, 'data');
const FILE = path.join(DATA, 'links.json');
const providers = [];
const localOnly = req => /^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(req.socket.remoteAddress || '');
const uid = () => Math.random().toString(36).slice(2, 10);
function load() { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); d.links ??= []; return d; } catch { return { links: [] }; } }
function save(db) {
  try { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1), { mode: 0o600 }); fs.renameSync(FILE + '.tmp', FILE); }
  catch (e) { console.log('hub: save', e.message); }
}
function register(name, fn) { const i = providers.findIndex(p => p.name === name); const row = { name, fn }; if (i >= 0) providers[i] = row; else providers.push(row); }
function match(terms, text) { const h = String(text || '').toLowerCase(); return terms.every(t => h.includes(t)); }
function search(q) {
  const terms = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const p of providers) {
    let rows = [];
    try { rows = p.fn(terms) || []; } catch (e) { rows = [{ kind: 'error', id: p.name, title: p.name, snippet: e.message, score: 0 }]; }
    for (const r of rows) hits.push({ kind: r.kind || p.name, tab: r.tab || '', score: r.score || 1, ...r });
  }
  return hits.sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.title).localeCompare(String(b.title))).slice(0, 40);
}
function linksFor(kind, id) {
  return load().links.filter(l => (l.fromKind === kind && l.fromId === id) || (l.toKind === kind && l.toId === id));
}
function addLink(b) {
  const db = load();
  const row = { id: uid(), fromKind: String(b.fromKind || ''), fromId: String(b.fromId || ''), toKind: String(b.toKind || ''), toId: String(b.toId || ''), label: String(b.label || '').slice(0, 80), at: new Date().toISOString() };
  if (!row.fromKind || !row.fromId || !row.toKind || !row.toId) throw new Error('link needs two ends');
  const ex = db.links.find(l => l.fromKind === row.fromKind && l.fromId === row.fromId && l.toKind === row.toKind && l.toId === row.toId);
  if (ex) return ex;
  db.links.push(row); save(db); return row;
}
function unlink(id) { const db = load(); db.links = db.links.filter(l => l.id !== id); save(db); return { ok: true }; }
function systems() {
  return [
    { id: 'notes', tab: 'Notes', title: 'FiaNotes', blurb: 'Notes, documents, sheets, cards' },
    { id: 'mail', tab: 'House', title: 'Fia Mail', blurb: 'Local mailbox and calendar' },
    { id: 'media', tab: 'House', title: 'FiaMedia', blurb: 'Library, focus audio, podcasts' },
    { id: 'studio', tab: 'House', title: 'Studio', blurb: 'Paint, draw, slides, clip' },
    { id: 'desk', tab: 'House', title: 'Desk', blurb: 'Launcher, clipboard, stats' },
    { id: 'facet', tab: 'House', title: 'Facet start', blurb: 'Bookmarks and history for the Facet browser' }
  ];
}
async function handle(req, res, u, readBody) {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  if (!localOnly(req)) return send(403, { error: 'local only' });
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
  try {
    const r = u.pathname;
    if (r === '/api/hub/search') return send(200, { hits: search(u.searchParams.get('q') || '') });
    if (r === '/api/hub/systems') return send(200, { systems: systems(), providers: providers.map(p => p.name) });
    if (r === '/api/hub/links' && req.method === 'GET') return send(200, { links: linksFor(u.searchParams.get('kind') || '', u.searchParams.get('id') || '') });
    if (r === '/api/hub/links' && req.method === 'POST') return send(200, { link: addLink(await J()) });
    if (r === '/api/hub/links/remove' && req.method === 'POST') return send(200, unlink((await J()).id));
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message }); }
}
module.exports = { register, search, match, linksFor, addLink, unlink, localOnly, handle, systems, DATA };
