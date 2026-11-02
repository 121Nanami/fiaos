// fiaOS ⇄ Apple Health (server side). The iPhone Shortcuts app posts each person's day here; no app or account needed.
// POST /api/health/ingest?token=…   {person?, date?, steps, activeKcal, exerciseMin, sleepHours, restingHR?, workouts?:[{type,minutes,kcal}]}
//      (JSON, form or query fields; numbers may be text with commas/units: "8,432", "7.5 hr", "1,250 kJ"). Person comes from the token.
// GET  /api/health/ingest?token=…   friendly page (what you see when you scan the Settings QR code) — changes nothing
// GET  /api/health/data[?person=&days=]  -> stored days (newest last) + last arrival, for the app
// GET  /api/health/setup            -> per-person ingest URLs (with token) + last arrival, for Settings (needs X-FiaOS: 1)
// POST /api/health/delete {person,date} -> removes one day here and archives its Notion rows (needs X-FiaOS: 1)
// LAN-only like /api/acct/* and /api/notion/*. Tokens live in data/health-tokens.json, days in data/health.json (90 days).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const notion = require('./notion');
const PEOPLE = ['Ada', 'Bea', 'Cam'], KEEP_DAYS = 90;
const DATA = process.env.FIAOS_DATA || path.join(__dirname, 'data'), TOK = path.join(DATA, 'health-tokens.json'), STORE = path.join(DATA, 'health.json');
const LAN = /^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/;
const ymd = d => d.toLocaleDateString('en-CA');
const stamp = () => new Date().toLocaleString('en-AU', { hour12: false });
const writeJson = (f, o) => { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1), { mode: 0o600 }); fs.renameSync(t, f) };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };

// ---- tokens: one random token per person, created once ----
function tokens() {
  const t = readJson(TOK, {}); let changed = false;
  for (const p of PEOPLE) if (!/^[0-9a-f]{32,}$/.test(t[p] || '')) { t[p] = crypto.randomBytes(16).toString('hex'); changed = true }
  if (changed) writeJson(TOK, t);
  return t;
}
const eq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b) };
const personFor = tok => { if (!tok) return null; const t = tokens(); return PEOPLE.find(p => eq(t[p], tok)) || null };

// ---- lenient number parsing (Shortcuts may send "8,432", "8 432 steps", "7.5 hr", "7h 30m", "07:30:00", ["120","300"]) ----
function num(v) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) { const n = v.map(num).filter(x => x != null); return n.length ? n.reduce((a, b) => a + b, 0) : null }
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'object') return num(v.value ?? v.Value ?? v.quantity ?? null);
  let s = String(v).trim().replace(/[\u00a0\u202f]/g, ' ');
  s = s.replace(/(\d)[ ,](?=\d{3}(\D|$))/g, '$1');        // thousands separators: 8,432 / 8 432
  s = s.replace(/^(-?\d+),(\d{1,2})(\D*)$/, '$1.$2$3');      // decimal comma: 7,5 hr
  const m = s.match(/-?\d+(\.\d+)?/); return m ? +m[0] : null;
}
// duration -> minutes. unit-less numbers use `bare` ('h' | 'min'); unit-less sleep values that are clearly minutes or seconds are detected.
function minutes(v, bare) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) { const n = v.map(x => minutes(x, bare)).filter(x => x != null); return n.length ? n.reduce((a, b) => a + b, 0) : null }
  const s = String(typeof v === 'object' ? (v.value ?? '') : v).trim().toLowerCase();
  let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/); if (m) return +m[1] * 60 + +m[2] + (+m[3] || 0) / 60; // 7:30 / 07:30:00
  const parts = [...s.replace(/(\d),(\d{3})/g, '$1$2').matchAll(/(\d+(?:[.,]\d+)?)\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)\b/g)];
  if (parts.length) return parts.reduce((a, [, n, u]) => a + (+n.replace(',', '.')) * (u[0] === 'h' ? 60 : u[0] === 's' ? 1 / 60 : 1), 0);
  const n = num(v); if (n == null) return null;
  if (bare === 'h') return n <= 24 ? n * 60 : n <= 1440 ? n : n / 60; // sleep: 7.5 = hours, 450 = minutes, 27000 = seconds
  return n > 1440 ? n / 60 : n;                                       // exercise: minutes (seconds if absurdly large)
}
const r1 = n => Math.round(n * 10) / 10;
// field aliases (case/space/underscore-insensitive)
const KEYS = { steps: ['steps', 'stepcount', 'step'], activeKcal: ['activekcal', 'activeenergy', 'activecalories', 'activeenergykcal', 'kcal', 'active'], exerciseMin: ['exercisemin', 'exerciseminutes', 'exercise', 'exercisetime'], sleepHours: ['sleephours', 'sleep', 'sleeph', 'sleepanalysis', 'sleepmin', 'sleepminutes'], restingHR: ['restinghr', 'restingheartrate', 'rhr', 'resting'], activeKJ: ['activekj', 'activeenergykj', 'kj'], workouts: ['workouts', 'workout'], person: ['person', 'name'], date: ['date', 'day'], energyUnit: ['energyunit', 'unit'] };
const norm = k => String(k).toLowerCase().replace(/[^a-z]/g, '');
function pick(o) { const by = {}; for (const [k, v] of Object.entries(o || {})) by[norm(k)] = v; const out = {}; for (const [f, al] of Object.entries(KEYS)) for (const a of al) if (by[a] !== undefined && by[a] !== '') { out[f] = by[a]; break } return out }
function parseDate(v) {
  if (v == null || v === '') return ymd(new Date());
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // en-AU dd/mm/yyyy
  const d = new Date(s.replace(/ at /i, ' ')); return isNaN(d) ? null : ymd(d);
}
function clean(b, who) {
  const f = pick(b), warn = [], out = {};
  const put = (k, v, lo, hi, label) => { if (v == null) return; if (!(v >= lo && v <= hi)) { warn.push(`${label} ${v} looks wrong, ignored`); return } out[k] = v };
  let kc = num(f.activeKcal); if (kc != null && (/kj/i.test(String(f.activeKcal)) || /kj/i.test(String(f.energyUnit || '')))) kc = kc / 4.184;
  if (kc == null && num(f.activeKJ) != null) kc = /kcal|cal\b/i.test(String(f.activeKJ)) ? num(f.activeKJ) : num(f.activeKJ) / 4.184; // Health set to kilojoules
  put('steps', num(f.steps) == null ? null : Math.round(num(f.steps)), 0, 200000, 'Steps');
  put('activeKcal', kc == null ? null : Math.round(kc), 0, 15000, 'Active energy');
  const ex = minutes(f.exerciseMin, 'min'); put('exerciseMin', ex == null ? null : Math.round(ex), 0, 1440, 'Exercise');
  const sleepKey = Object.keys(b || {}).find(k => /sleep/i.test(k)) || '', bareSleep = /^[\d.,\s]+$/.test(String(f.sleepHours ?? 'x'));
  const sl = /min/i.test(sleepKey) && bareSleep ? num(f.sleepHours) : minutes(f.sleepHours, 'h'); // "sleepMinutes": 450 is minutes
  put('sleepHours', sl == null ? null : r1(sl / 60), 0, 24, 'Sleep');
  const hr = num(f.restingHR); put('restingHR', hr == null ? null : Math.round(hr), 20, 250, 'Resting HR');
  let w = f.workouts; if (typeof w === 'string') { try { w = JSON.parse(w) } catch { w = null } } if (w && !Array.isArray(w)) w = [w];
  if (!w && (b.workoutType || b.workout_type)) w = [{ type: b.workoutType ?? b.workout_type, minutes: b.workoutMinutes ?? b.workout_minutes, kcal: b.workoutKcal ?? b.workout_kcal }]; // one flat workout
  if (Array.isArray(w)) out.workouts = w.slice(0, 20).map(x => { const o = {}; for (const [k, v] of Object.entries(x || {})) o[norm(k)] = v;
    const mins = minutes(o.minutes ?? o.mins ?? o.duration, 'min'), kcal = num(o.kcal ?? o.calories ?? o.activeenergy ?? o.energy);
    const type = String(o.type ?? o.name ?? o.activity ?? 'Workout').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Workout';
    return mins > 0 && mins <= 1440 ? { type, minutes: Math.round(mins), ...(kcal > 0 && kcal < 10000 ? { kcal: Math.round(kcal) } : {}) } : null }).filter(Boolean);
  let person = who; if (f.person && norm(f.person) !== norm(who)) warn.push(`person "${String(f.person).slice(0, 20)}" ignored — this link belongs to ${who}`);
  return { person, date: parseDate(f.date), vals: out, warn };
}

// ---- store ----
let DB = readJson(STORE, { days: {}, last: {} }); DB.days ??= {}; DB.last ??= {};
function prune() { const c = new Date(); c.setDate(c.getDate() - KEEP_DAYS); const cut = ymd(c); for (const p of Object.keys(DB.days)) for (const d of Object.keys(DB.days[p])) if (d < cut) delete DB.days[p][d] }
const save = () => { prune(); try { writeJson(STORE, DB) } catch (e) { console.log('health: could not save', e.message) } };
function series(p, days = 30) { const out = []; const c = new Date(); c.setDate(c.getDate() - days + 1); const cut = ymd(c);
  for (const [d, r] of Object.entries(DB.days[p] || {}).sort(([a], [b]) => a.localeCompare(b))) if (d >= cut) { const { nid, wnids, ...rest } = r; out.push({ date: d, ...rest }) } return out }

// Notion: one row per person/day in "Health", workouts into "Workouts" (deduped). Runs after the reply so Shortcuts never waits on Notion.
let chain = Promise.resolve();
function toNotion(p, d) {
  chain = chain.then(async () => {
    const r = DB.days[p]?.[d]; if (!r || !process.env.NOTION_TOKEN) return;
    try { const o = await notion.healthUpsert(p, d, r); r.nid = o.nid; r.wnids = [...new Set([...(r.wnids || []), ...o.workoutNids])]; r.notion = 'ok'; delete r.notionError }
    catch (e) { r.notion = 'error'; r.notionError = e.message.slice(0, 200); console.log(`${stamp()} health notion ${p} ${d} error: ${e.message}`) }
    save();
  });
  return chain;
}
function ingest(p, b) {
  const c = clean(b, p);
  if (!c.date) return { code: 400, body: { ok: false, error: 'date not understood — send YYYY-MM-DD or leave it out for today' } };
  const age = (new Date(ymd(new Date())) - new Date(c.date)) / 864e5;
  if (age < -1 || age > KEEP_DAYS) return { code: 400, body: { ok: false, error: `date ${c.date} is outside the last ${KEEP_DAYS} days` } };
  if (!Object.keys(c.vals).length) return { code: 400, body: { ok: false, error: 'no numbers found — send steps, activeKcal, exerciseMin or sleepHours', warnings: c.warn } };
  DB.days[p] ??= {}; const prev = DB.days[p][c.date] || {};
  const rec = { ...prev, ...c.vals, at: new Date().toISOString() };
  if (c.vals.workouts) { const seen = new Set(), all = [...(prev.workouts || []), ...c.vals.workouts].filter(w => { const k = w.type.toLowerCase() + '|' + w.minutes; return !seen.has(k) && seen.add(k) }); rec.workouts = all }
  DB.days[p][c.date] = rec; DB.last[p] = rec.at; save(); toNotion(p, c.date);
  const { nid, wnids, notion: _n, notionError, ...shown } = rec;
  return { code: 200, body: { ok: true, person: p, date: c.date, saved: shown, warnings: c.warn, message: `✅ Saved ${p}'s Health for ${new Date(c.date + 'T12:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}` } };
}
async function remove(p, d) {
  const r = DB.days[p]?.[d]; if (!r) return { ok: true, removed: false };
  await chain; const nids = [r.nid, ...(r.wnids || [])].filter(Boolean); let archived = 0;
  if (nids.length && process.env.NOTION_TOKEN) archived = await notion.archivePages(nids);
  delete DB.days[p][d]; const left = Object.values(DB.days[p]).map(x => x.at).filter(Boolean).sort(); DB.last[p] = left[left.length - 1] || null; save();
  return { ok: true, removed: true, archived };
}

// ---- URLs ----
function lanIp() { for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && /^192\.168\./.test(a.address)) return a.address;
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address; return 'localhost' }
const base = () => (process.env.FIAOS_PUBLIC_URL || `http://${lanIp()}:${process.env.PORT || 8080}`).replace(/\/$/, '');
const ingestUrl = p => `${base()}/api/health/ingest?token=${tokens()[p]}`;
const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (p, url) => `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>fiaOS Health · ${p}</title>
<style>body{font:17px system-ui,sans-serif;margin:0;padding:24px;background:#0b1020;color:#e8fbfa;line-height:1.45}textarea{width:100%;font:15px ui-monospace,monospace;padding:10px;border-radius:10px;border:1px solid #39c5bb66;background:#111a2e;color:#e8fbfa}button{font:inherit;padding:10px 18px;border-radius:12px;border:0;background:#39C5BB;color:#06231f;margin-top:10px}small{color:#9fb}</style></head>
<body><h2>❤️ ${p}'s fiaOS Health link</h2><p>This is ${p}'s personal address for the <b>fiaOS Health</b> shortcut. Copy it, then paste it into the <b>URL</b> of the <b>Get Contents of URL</b> action.</p>
<textarea id="u" rows="4" readonly>${escH(url)}</textarea><br><button onclick="const t=document.getElementById('u');t.select();t.setSelectionRange(0,9999);try{document.execCommand('copy');this.textContent='Copied ✓'}catch(e){this.textContent='Select and copy the text above'}">Copy link</button>
<p><small>Keep it private: anyone on your home Wi-Fi with this link could send Health numbers for ${p}. Nothing is sent by opening this page.</small></p></body></html>`;

async function handle(req, res, u, readBody) {
  const ip = req.socket.remoteAddress || '';
  const send = (code, b, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(typeof b === 'string' ? b : JSON.stringify(b)) };
  if (!LAN.test(ip)) return send(403, { error: 'local only' });
  const r = u.pathname;
  try {
    if (r === '/api/health/ingest') {
      const p = personFor(u.searchParams.get('token'));
      if (!p) { console.log(`${stamp()} health ingest ${ip} -> 401 (missing or wrong token)`); return send(401, { ok: false, error: 'missing or wrong token — copy the link again from fiaOS Settings → Apple Health' }) }
      if (req.method === 'GET') return send(200, page(p, ingestUrl(p)), 'text/html; charset=utf-8');
      if (req.method !== 'POST') return send(405, { error: 'use POST' });
      const raw = await readBody(req); if (raw.length > 200e3) return send(413, { error: 'too big' });
      let b = {}; const ct = String(req.headers['content-type'] || '');
      if (raw.trim()) { if (/json/i.test(ct) || /^\s*[{[]/.test(raw)) { try { b = JSON.parse(raw) } catch { return send(400, { ok: false, error: 'body is not valid JSON' }) } } else b = Object.fromEntries(new URLSearchParams(raw)) }
      if (Array.isArray(b)) b = Object.assign({}, ...b.filter(x => x && typeof x === 'object'));
      for (const [k, v] of u.searchParams) if (k !== 'token' && b[k] === undefined) b[k] = v;
      const out = ingest(p, b || {});
      console.log(`${stamp()} health ingest ${p} ${ip} -> ${out.code} ${out.body.date || ''} ${Object.keys(out.body.saved || {}).filter(k => k !== 'at').join(',')}${out.body.error ? ' ' + out.body.error : ''}`);
      return send(out.code, out.body);
    }
    if (r === '/api/health/data') {
      const days = Math.max(1, Math.min(KEEP_DAYS, +u.searchParams.get('days') || 30)), want = u.searchParams.get('person');
      const P = want ? PEOPLE.filter(p => p === want) : PEOPLE; if (want && !P.length) return send(400, { error: 'unknown person' });
      return send(200, { today: ymd(new Date()), people: Object.fromEntries(P.map(p => [p, { last: DB.last[p] || null, days: series(p, days) }])) });
    }
    if (req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
    if (r === '/api/health/setup') return send(200, { base: base(), people: Object.fromEntries(PEOPLE.map(p => [p, { url: ingestUrl(p), last: DB.last[p] || null }])) });
    if (r === '/api/health/delete' && req.method === 'POST') { let b = {}; try { b = JSON.parse(await readBody(req) || '{}') } catch { }
      if (!PEOPLE.includes(b.person) || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return send(400, { error: 'person and date (YYYY-MM-DD) needed' });
      return send(200, await remove(b.person, b.date)) }
    return send(404, { error: 'not found' });
  } catch (e) { console.log(`${stamp()} health ${r} error: ${e.message}`); return send(500, { error: e.message }) }
}
tokens(); // create the token file on start
module.exports = { handle, num, minutes, clean, ingest, series, tokens };
