// fiaOS <-> Fia Health link (server). Fia Health is its own local app with three separate logins (Cam, Bea, Ada) and encrypted vaults.
// fiaOS only checks that it is running, can start it, and links each person to their own sign-in. It never reads health records.
// GET  /api/fiahealth/status  -> {url, running, dir, accounts:[{name,sex,registered}]}
// POST /api/fiahealth/start   -> starts Fia Health (node server.mjs) if it is not running
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const DIR = process.env.FIA_HEALTH_DIR || path.join(os.homedir(), 'bea-health');
const PORT = +process.env.FIA_HEALTH_PORT || 3940, URL_ = `http://127.0.0.1:${PORT}`;
async function users() { try { const r = await fetch(URL_ + '/api/users', { signal: AbortSignal.timeout(1500) }); return r.ok ? (await r.json()).users : null } catch { return null } }
function nodeBin() { for (const p of [path.join(os.homedir(), '.local/bin/node'), '/opt/homebrew/bin/node', '/usr/local/bin/node']) if (fs.existsSync(p)) return { cmd: p, env: {} };
  return { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } } }
async function handle(req, res, u) {
  const send = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(b)) };
  if (!/^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(req.socket.remoteAddress || '')) return send(403, { error: 'local only' });
  if (u.pathname === '/api/fiahealth/status' && req.method === 'GET') { const a = await users(); return send(200, { url: URL_, running: !!a, installed: fs.existsSync(path.join(DIR, 'server.mjs')), accounts: a || [] }) }
  if (u.pathname === '/api/fiahealth/start' && req.method === 'POST') {
    if (req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
    if (await users()) return send(200, { running: true, already: true });
    if (!fs.existsSync(path.join(DIR, 'server.mjs'))) return send(404, { error: `Fia Health not found at ${DIR}` });
    const n = nodeBin(); const c = cp.spawn(n.cmd, ['server.mjs'], { cwd: DIR, env: { ...process.env, ...n.env }, detached: true, stdio: 'ignore' }); c.unref();
    for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 400)); if (await users()) return send(200, { running: true }) }
    return send(502, { error: 'Fia Health did not start' });
  }
  return send(404, { error: 'not found' });
}
module.exports = { handle };
