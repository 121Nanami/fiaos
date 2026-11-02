// FiaLauncher: a panel the Electron Centre app can embed (desk.html) plus /api/launcher/*.
// Apps, clipboard history, a tiling helper and /proc stats. Local only.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), child = require('child_process');
const hub = require('./fiaos-core');
const FILE = path.join(hub.DATA, 'launcher.json');
const uid = () => Math.random().toString(36).slice(2, 10);
function load() { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); d.clipboard ??= []; d.apps ??= []; return d; } catch { return { clipboard: [], apps: [] }; } }
function save(db) { try { fs.mkdirSync(hub.DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1), { mode: 0o600 }); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.log('launcher: save', e.message); } }
const BUILTIN = [
  { id: 'fiaos', name: 'fiaOS', exec: 'http://127.0.0.1:8080/', kind: 'page' },
  { id: 'notes', name: 'FiaNotes', exec: 'http://127.0.0.1:8080/?tab=Notes', kind: 'page' },
  { id: 'mail', name: 'Fia Mail', exec: 'http://127.0.0.1:8080/?tab=House', kind: 'page' },
  { id: 'facet', name: 'Facet start', exec: 'http://127.0.0.1:8080/facet.html', kind: 'page' },
  { id: 'desk', name: 'Desk panel', exec: 'http://127.0.0.1:8080/desk.html', kind: 'page' }
];
function desktopApps() {
  const dir = '/usr/share/applications'; const out = [];
  let names = []; try { names = fs.readdirSync(dir).filter(n => n.endsWith('.desktop')).slice(0, 40); } catch { return out; }
  for (const n of names) {
    let text = ''; try { text = fs.readFileSync(path.join(dir, n), 'utf8'); } catch { continue; }
    if (/NoDisplay=true/i.test(text)) continue;
    const name = (text.match(/^Name=(.+)$/m) || [])[1];
    const exec = (text.match(/^Exec=(.+)$/m) || [])[1];
    if (name && exec) out.push({ id: 'desk:' + n, name: name.trim(), exec: exec.replace(/%[a-zA-Z]/g, '').trim(), kind: 'desktop' });
    if (out.length >= 24) break;
  }
  return out;
}
function apps() { const db = load(); return [...BUILTIN, ...db.apps, ...desktopApps()]; }
function stats() {
  const mem = {};
  try {
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
      const m = /^(\w+):\s+(\d+)/.exec(line);
      if (m && ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'].includes(m[1])) mem[m[1]] = +m[2] * 1024;
    }
  } catch { /* not Linux */ }
  let disks = [];
  try {
    disks = fs.readFileSync('/proc/mounts', 'utf8').split('\n').filter(l => /^\/dev\//.test(l)).slice(0, 6).map(l => l.split(' ')[1]);
  } catch { disks = []; }
  return { hostname: os.hostname(), platform: os.platform(), release: os.release(), cpus: os.cpus().length, load: os.loadavg().map(n => Math.round(n * 100) / 100), uptime: Math.round(os.uptime()), mem, mounts: disks, now: new Date().toISOString() };
}
const TILES = {
  left: { sway: ['splitv'], note: 'Centre can run swaymsg or wmctrl. This preset asks the compositor to focus the left half.' },
  right: { sway: ['splith'], note: 'Right-hand split.' },
  focus: { sway: ['fullscreen', 'toggle'], note: 'Toggle fullscreen on the focused window.' }
};
function which(bin) { const dirs = (process.env.PATH || '').split(':'); return dirs.map(d => path.join(d, bin)).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || ''; }
function tile(preset) {
  const spec = TILES[preset]; if (!spec) throw new Error('preset is left, right or focus');
  const sway = which('swaymsg'), wm = which('wmctrl');
  let ran = '', error = '';
  if (sway && preset === 'focus') { try { child.execFileSync(sway, ['fullscreen', 'toggle'], { timeout: 2000 }); ran = 'swaymsg'; } catch (e) { error = e.message; } }
  else if (wm && preset === 'left') { try { child.execFileSync(wm, ['-r', ':ACTIVE:', '-e', '0,0,0,960,1000'], { timeout: 2000 }); ran = 'wmctrl'; } catch (e) { error = e.message; } }
  else if (wm && preset === 'right') { try { child.execFileSync(wm, ['-r', ':ACTIVE:', '-e', '0,960,0,960,1000'], { timeout: 2000 }); ran = 'wmctrl'; } catch (e) { error = e.message; } }
  return { ok: !error, preset, ran, sway: !!sway, wmctrl: !!wm, command: sway ? 'swaymsg ' + (spec.sway || []).join(' ') : (wm ? 'wmctrl -r :ACTIVE: -e …' : ''), note: ran ? 'Told the window manager.' : (error || spec.note + ' No swaymsg or wmctrl on this machine, so Centre should run the command itself.') };
}
function pushClip(text) {
  const t = String(text || '').slice(0, 20000); if (!t.trim()) throw new Error('empty clipboard');
  const db = load();
  if (db.clipboard[0] && db.clipboard[0].text === t) return db.clipboard[0];
  const row = { id: uid(), text: t, at: new Date().toISOString() };
  db.clipboard.unshift(row); db.clipboard = db.clipboard.slice(0, 50); save(db); return row;
}
function readLiveClip() {
  const bin = which('wl-paste') || which('xclip');
  if (!bin) return '';
  try { return child.execFileSync(bin, bin.endsWith('xclip') ? ['-selection', 'clipboard', '-o'] : ['-n'], { timeout: 1000, encoding: 'utf8' }).slice(0, 20000); }
  catch { return ''; }
}
async function handle(req, res, u, readBody) {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  if (!hub.localOnly(req)) return send(403, { error: 'local only' });
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
  try {
    const r = u.pathname, post = req.method === 'POST';
    if (r === '/api/launcher') return send(200, { apps: apps(), stats: stats(), clipboard: load().clipboard.slice(0, 20) });
    if (r === '/api/launcher/stats') return send(200, stats());
    if (r === '/api/launcher/apps' && !post) return send(200, { apps: apps() });
    if (r === '/api/launcher/apps' && post) { const b = await J(); const db = load(); if (!b.name) throw new Error('name needed'); db.apps.push({ id: uid(), name: String(b.name).slice(0, 80), exec: String(b.exec || '').slice(0, 300), kind: 'custom' }); save(db); return send(200, { apps: apps() }); }
    if (r === '/api/launcher/clipboard' && !post) { const live = u.searchParams.get('live') === '1' ? readLiveClip() : ''; if (live) try { pushClip(live); } catch { /* ignore */ } return send(200, { items: load().clipboard }); }
    if (r === '/api/launcher/clipboard' && post) return send(200, { item: pushClip((await J()).text) });
    if (r === '/api/launcher/tile' && post) return send(200, tile((await J()).preset));
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message }); }
}
function start() {
  hub.register('app', terms => apps().filter(a => hub.match(terms, a.name + ' ' + a.exec)).slice(0, 6).map(a => ({ kind: 'app', id: a.id, title: a.name, snippet: a.exec, tab: 'House', score: 1 })));
}
module.exports = { handle, start, stats, tile, apps, TILES };
