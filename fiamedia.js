// FiaMedia: a library of files on disk, a player, and a yt-dlp wrapper when that binary exists.
// Focus noise and binaural tones are generated in the browser (fiahubui.js). Podcasts come from podcasts.js.
'use strict';
const fs = require('fs'), path = require('path'), child = require('child_process');
const hub = require('./fiaos-core');
const DIR = process.env.FIAOS_MEDIA || path.join(hub.DATA, 'media');
const KINDS = { audio: ['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.opus'], video: ['.webm', '.mp4', '.ogv', '.mkv'], image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] };
const MIME = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.ogv': 'video/ogg', '.mkv': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
function kindOf(ext) { return Object.entries(KINDS).find(([, xs]) => xs.includes(ext))?.[0] || ''; }
function safeJoin(rel) {
  const clean = path.normalize(String(rel || '')).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.resolve(DIR, clean);
  if (full !== DIR && !full.startsWith(DIR + path.sep)) throw new Error('bad path');
  return full;
}
function list() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const out = [];
  const walk = (dir, prefix) => {
    let names = []; try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith('.')) continue;
      const full = path.join(dir, n), rel = prefix ? prefix + '/' + n : n;
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (prefix.split('/').length < 3) walk(full, rel); continue; }
      const ext = path.extname(n).toLowerCase(), kind = kindOf(ext);
      if (!kind) continue;
      out.push({ id: encodeURIComponent(rel), name: n, rel, kind, bytes: st.size, ext, mtime: st.mtime.toISOString() });
    }
  };
  walk(DIR, '');
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}
function which(bin) { return (process.env.PATH || '').split(':').map(d => path.join(d, bin)).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || ''; }
function download(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('an http(s) link is needed');
  const bin = process.env.YT_DLP || which('yt-dlp') || which('yt-dlp.bin');
  if (!bin) return { ok: false, stub: true, error: 'yt-dlp is not installed. Put the binary on PATH or set YT_DLP. Nothing was downloaded.' };
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const before = new Set(list().map(f => f.rel));
  child.execFileSync(bin, ['--no-playlist', '--restrict-filenames', '-o', path.join(DIR, '%(title).80s.%(ext)s'), String(url)], { timeout: 120000, cwd: DIR });
  const added = list().filter(f => !before.has(f.rel));
  return { ok: true, added };
}
async function podcasts(person) {
  try { const d = await require('./podcasts').get(person || 'Bea'); return { person: d.person, show: d.show, episodes: (d.episodes || []).slice(0, 12) }; }
  catch (e) { return { episodes: [], error: e.message }; }
}
function handle(req, res, u, readBody) {
  const send = (c, o, type) => { res.writeHead(c, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o)); };
  if (!hub.localOnly(req)) return send(403, { error: 'local only' });
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
  return (async () => {
    try {
      const r = u.pathname;
      if (r === '/api/media') return send(200, { dir: DIR, files: list(), ytdlp: !!(process.env.YT_DLP || which('yt-dlp')) });
      if (r === '/api/media/file') {
        const rel = decodeURIComponent(u.searchParams.get('id') || '');
        const full = safeJoin(rel);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return send(404, { error: 'not found' });
        const ext = path.extname(full).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        return fs.createReadStream(full).pipe(res);
      }
      if (r === '/api/media/download' && req.method === 'POST') return send(200, download((await J()).url));
      if (r === '/api/media/podcasts') return send(200, await podcasts(u.searchParams.get('person') || 'Bea'));
      return send(404, { error: 'not found' });
    } catch (e) { if (!res.headersSent) send(400, { error: e.message }); }
  })();
}
function start() {
  try { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
  hub.register('media', terms => list().filter(f => hub.match(terms, f.name)).slice(0, 8).map(f => ({ kind: 'media', id: f.id, title: f.name, snippet: f.kind + ' · ' + f.rel, tab: 'House', score: 2 })));
}
module.exports = { handle, start, list, safeJoin, DIR };
