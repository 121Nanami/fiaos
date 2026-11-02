// Local extras: whisper.cpp transcription, a tiny Matrix panel (real homeserver if you run one, plus an offline room),
// and a status check for WireGuard. Setup lives in linux/matrix, linux/wireguard and linux/headscale.
'use strict';
const fs = require('fs'), path = require('path'), child = require('child_process');
const hub = require('./fiaos-core');
const media = require('./fiamedia');
const ROOM = path.join(hub.DATA, 'matrix-room.json');
function which(bin) { return (process.env.PATH || '').split(':').map(d => path.join(d, bin)).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || ''; }
function whisperBin() { return process.env.WHISPER_BIN || which('whisper-cli') || which('whisper-cpp'); }
function transcribe(rel) {
  const bin = whisperBin();
  const model = process.env.WHISPER_MODEL || '';
  if (!bin || !model) return { ok: false, stub: true, error: 'whisper.cpp is not set up. Install it, then set WHISPER_BIN and WHISPER_MODEL to the model file. See linux/WHISPER.md.' };
  const full = media.safeJoin(decodeURIComponent(rel));
  if (!fs.existsSync(full)) throw new Error('file not in the media library');
  const out = child.execFileSync(bin, ['-m', model, '-f', full, '-otxt', '-of', full], { timeout: 15 * 60 * 1000, encoding: 'utf8' });
  const txt = fs.existsSync(full + '.txt') ? fs.readFileSync(full + '.txt', 'utf8') : out;
  return { ok: true, text: String(txt || '').slice(0, 100000), file: rel };
}
function room() { try { const d = JSON.parse(fs.readFileSync(ROOM, 'utf8')); d.messages ??= []; return d; } catch { return { title: 'House room', messages: [{ id: 'hi', who: 'Bea', text: 'This room is on this machine until Conduit is running.', at: new Date().toISOString() }] }; } }
function saveRoom(d) { fs.mkdirSync(hub.DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(ROOM + '.tmp', JSON.stringify(d, null, 1), { mode: 0o600 }); fs.renameSync(ROOM + '.tmp', ROOM); }
function say(b) {
  const d = room();
  const row = { id: Math.random().toString(36).slice(2, 10), who: String(b.who || 'Bea').slice(0, 40), text: String(b.text || '').slice(0, 4000), at: new Date().toISOString() };
  if (!row.text.trim()) throw new Error('empty message');
  d.messages.push(row); d.messages = d.messages.slice(-200); saveRoom(d); return row;
}
function wireguard() {
  const dir = '/etc/wireguard'; let confs = [];
  try { confs = fs.readdirSync(dir).filter(n => n.endsWith('.conf')).map(n => n.replace(/\.conf$/, '')); } catch { confs = []; }
  const wg = which('wg');
  return { installed: !!wg, interfaces: confs, note: wg ? 'wg is installed. Config names only — private keys are not read.' : 'wg is not installed. See linux/wireguard/README.md and linux/headscale/README.md.' };
}
async function matrixProbe() {
  const base = (process.env.MATRIX_URL || 'http://127.0.0.1:6167').replace(/\/$/, '');
  try {
    const r = await fetch(base + '/_matrix/client/versions', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { up: false, base };
    const j = await r.json();
    return { up: true, base, versions: (j.versions || []).slice(0, 4) };
  } catch { return { up: false, base }; }
}
function handle(req, res, u, readBody) {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  if (!hub.localOnly(req)) return send(403, { error: 'local only' });
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
  return (async () => {
    try {
      const r = u.pathname;
      if (r === '/api/local') return send(200, { whisper: !!whisperBin() && !!process.env.WHISPER_MODEL, wireguard: wireguard(), matrix: await matrixProbe() });
      if (r === '/api/local/transcribe' && req.method === 'POST') return send(200, transcribe((await J()).file));
      if (r === '/api/local/room' && req.method === 'GET') return send(200, { ...room(), matrix: await matrixProbe() });
      if (r === '/api/local/room' && req.method === 'POST') return send(200, { message: say(await J()), messages: room().messages });
      if (r === '/api/local/wireguard') return send(200, wireguard());
      return send(404, { error: 'not found' });
    } catch (e) { if (!res.headersSent) send(400, { error: e.message }); }
  })();
}
function start() {
  hub.register('chat', terms => room().messages.filter(m => hub.match(terms, m.who + ' ' + m.text)).slice(-6).map(m => ({ kind: 'chat', id: m.id, title: m.who, snippet: m.text.slice(0, 140), tab: 'House', score: 1 })));
}
module.exports = { handle, start, transcribe, wireguard, room };
