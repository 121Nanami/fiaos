// Facet start page data: bookmarks and history for the Facet Electron browser.
// The page itself is facet.html. Tor is a local SOCKS proxy; see linux/TOR.md. No cloud.
'use strict';
const fs = require('fs'), path = require('path');
const hub = require('./fiaos-core');
const FILE = path.join(hub.DATA, 'facet.json');
const uid = () => Math.random().toString(36).slice(2, 10);
function seed() {
  return {
    bookmarks: [
      { id: 'home', title: 'fiaOS', url: 'http://127.0.0.1:8080/', group: 'House' },
      { id: 'notes', title: 'FiaNotes', url: 'http://127.0.0.1:8080/?tab=Notes', group: 'House' },
      { id: 'mail', title: 'Fia Mail', url: 'http://127.0.0.1:8080/?tab=House', group: 'House' },
      { id: 'desk', title: 'Desk panel', url: 'http://127.0.0.1:8080/desk.html', group: 'Centre' }
    ],
    history: []
  };
}
function load() { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); d.bookmarks ??= []; d.history ??= []; return d; } catch { return seed(); } }
function save(db) { try { fs.mkdirSync(hub.DATA, { recursive: true, mode: 0o700 }); const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db, null, 1), { mode: 0o600 }); fs.renameSync(t, FILE); } catch (e) { console.log('facet: save', e.message); } }
function okUrl(u) {
  const s = String(u || '').trim();
  if (/^(javascript|data|file):/i.test(s)) return '';
  if (/^https?:\/\//i.test(s) || /^http:\/\/127\.0\.0\.1/i.test(s)) return s.slice(0, 2000);
  if (/\.onion(\/|$)/i.test(s) && /^https?:\/\//i.test(s)) return s.slice(0, 2000);
  return '';
}
function addHistory(b) {
  const url = okUrl(b.url); if (!url) throw new Error('only http(s) links, including .onion');
  const db = load();
  const row = { id: uid(), url, title: String(b.title || url).slice(0, 180), at: new Date().toISOString() };
  db.history = [row, ...db.history.filter(h => h.url !== url)].slice(0, 200);
  save(db); return row;
}
function addBookmark(b) {
  const url = okUrl(b.url); if (!url) throw new Error('only http(s) links');
  const db = load();
  const row = { id: uid(), url, title: String(b.title || url).slice(0, 120), group: String(b.group || 'Saved').slice(0, 40) };
  db.bookmarks.push(row); save(db); return row;
}
async function handle(req, res, u, readBody) {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  if (!hub.localOnly(req)) return send(403, { error: 'local only' });
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
  try {
    const db = load(), r = u.pathname, post = req.method === 'POST';
    if (r === '/api/facet') return send(200, { bookmarks: db.bookmarks, history: db.history.slice(0, 40), tor: 'socks5://127.0.0.1:9050' });
    if (r === '/api/facet/history' && post) return send(200, { item: addHistory(await J()) });
    if (r === '/api/facet/bookmark' && post) return send(200, { item: addBookmark(await J()) });
    if (r === '/api/facet/bookmark/remove' && post) { const b = await J(); const d = load(); d.bookmarks = d.bookmarks.filter(x => x.id !== b.id); save(d); return send(200, { ok: true }); }
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message }); }
}
function start() {
  hub.register('bookmark', terms => load().bookmarks.filter(b => hub.match(terms, b.title + ' ' + b.url)).slice(0, 6).map(b => ({ kind: 'bookmark', id: b.id, title: b.title, snippet: b.url, tab: 'House', score: 2 })));
}
module.exports = { handle, start, okUrl, load };
