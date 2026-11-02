// fiaOS family message board (server). Short notes ("out till 6", "grab milk") shown on Stage and in the brief, each auto-expiring.
// GET  /api/notes                       -> {notes:[{id,who,text,until,untilLabel,created,src}]}  (expired ones dropped)
// POST /api/notes {id?,who,text,until?} -> add (until = "6pm", "till 6:30", "tonight", "tomorrow", "Friday", "for 2 hours", ISO, or blank:
//                                          then a "till …" inside the text is used, else 24 h). Same id twice = added once.
// POST /api/notes/delete {id}
// Also used by the Notion Inbox (notion.js): "note: out till 6" or any note Grok reads as a message for the board.
'use strict';
const fs = require('fs'), path = require('path');
const DATA = process.env.FIAOS_DATA || path.join(__dirname, 'data'), FILE = path.join(DATA, 'notes.json');
const WHO = ['Ada', 'Bea', 'Cam', 'Everyone'], MAX = 20, WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const rd = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return { notes: [] } } };
let DB = rd(); DB.notes ??= [];
const save = () => { try { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB, null, 1), { mode: 0o600 }); fs.renameSync(FILE + '.tmp', FILE) } catch (e) { console.log('notes: save', e.message) } };
const endOf = d => { const x = new Date(d); x.setHours(23, 59, 0, 0); return x };
const hm = d => d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).replace(':00', '').toLowerCase();
// "6pm" / "6:30" / "18:00" / "tonight" / "tomorrow" / "friday" / "weekend" / "for 2 hours" / "3 days" -> {until: Date, label}
function parseUntil(s, now = new Date()) {
  s = String(s || '').toLowerCase().replace(/^\s*(till|until|til|'til|by|for|back)\s+/, '').trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}t/.test(s)) { const d = new Date(s); return isNaN(d) ? null : { until: d, label: 'till ' + d.toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) } }
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes|d|day|days)\b/);
  if (m) { const n = +m[1], u = m[2][0], ms = u === 'h' ? n * 36e5 : u === 'm' ? n * 6e4 : n * 864e5; const d = new Date(now.getTime() + ms); return { until: d, label: u === 'd' ? `till ${d.toLocaleDateString('en-AU', { weekday: 'short' })}` : `till ${hm(d)}` } }
  if (/^(tonight|this evening|today|end of (the )?day)\b/.test(s)) return { until: endOf(now), label: /today|day/.test(s) ? 'today' : 'tonight' };
  if (/^(tomorrow|tmrw|tmr)\b/.test(s)) { const d = new Date(now); d.setDate(d.getDate() + 1); return { until: endOf(d), label: 'till tomorrow' } }
  if (/^(the |this )?weekend\b/.test(s)) { const d = new Date(now); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return { until: endOf(d), label: 'till the weekend’s over' } }
  const wd = WD.findIndex(w => s.startsWith(w) || s.startsWith(w.slice(0, 3) + ' ') || s === w.slice(0, 3));
  if (wd >= 0) { const d = new Date(now); d.setDate(d.getDate() + (((wd - d.getDay()) + 7) % 7)); return { until: endOf(d), label: 'till ' + d.toLocaleDateString('en-AU', { weekday: 'long' }) } }
  m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s|$)/); if (m && +m[1] <= 24) {
    let h = +m[1], mi = +(m[2] || 0); const ap = (m[3] || '').replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    const d = new Date(now); d.setHours(h, mi, 0, 0);
    if (!ap && h < 12 && d <= now) d.setHours(h + 12);   // "till 6" said at 3 pm = 6 pm
    if (d <= now) d.setDate(d.getDate() + 1);             // already past -> tomorrow
    return { until: d, label: 'till ' + hm(d) + (d.toDateString() !== now.toDateString() ? ' tomorrow' : '') } }
  return null;
}
const live = () => { const n = Date.now(), before = DB.notes.length; DB.notes = DB.notes.filter(x => !x.until || new Date(x.until).getTime() > n); if (DB.notes.length !== before) save(); return DB.notes };
function add(b) {
  const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 140); if (!text) throw new Error('note text needed');
  const who = WHO.find(w => w.toLowerCase() === String(b.who || b.person || '').trim().toLowerCase()) || 'Everyone';
  const id = /^[\w-]{4,40}$/.test(b.id || '') ? b.id : Math.random().toString(36).slice(2, 10);
  live(); const ex = DB.notes.find(x => x.id === id); if (ex) return ex;
  let u = parseUntil(b.until);
  if (!u) { const m = text.match(/\b(?:till|until|til|'til|back by|back at)\s+([^,.;!]+)/i); if (m) u = parseUntil(m[1]) }
  if (!u) { const d = new Date(Date.now() + 24 * 36e5); u = { until: d, label: 'for 24 h' } }
  const n = { id, who, text, until: u.until.toISOString(), untilLabel: u.label, created: new Date().toISOString(), src: b.src === 'notion' ? 'notion' : 'app' };
  DB.notes.push(n); DB.notes = DB.notes.slice(-MAX); save(); return n;
}
function del(id) { const before = DB.notes.length; DB.notes = DB.notes.filter(x => x.id !== id); if (DB.notes.length !== before) save(); return { ok: true } }
async function handle(req, res, u, readBody) {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)) };
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  if (!/^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(req.socket.remoteAddress || '')) return send(403, { error: 'local only' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}') } catch { return {} } };
  try {
    if (u.pathname === '/api/notes' && req.method === 'GET') return send(200, { notes: live() });
    if (u.pathname === '/api/notes' && req.method === 'POST') { const n = add(await J()); return send(200, { note: n, notes: live() }) }
    if (u.pathname === '/api/notes/delete' && req.method === 'POST') { del((await J()).id); return send(200, { notes: live() }) }
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message }) }
}
module.exports = { handle, add, del, live, parseUntil };
