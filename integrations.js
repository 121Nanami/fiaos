// fiaOS account integrations (server-side only; tokens never leave this process / data dir).
// Google Calendar + Gmail: OAuth "Desktop app" loopback flow with PKCE, done on the fiaOS device itself
//   (Google's TV/limited-input device flow only allows openid/email/profile/drive.file/drive.appdata/youtube, so NOT calendar or gmail).
// Microsoft (Outlook.com / Hotmail / school Microsoft 365): device-code flow + Microsoft Graph (Mail.Read, Calendars.Read).
// Generic IMAP: app password, implicit TLS (993). (Outlook.com/M365 no longer accept IMAP passwords; use Microsoft instead.)
// NotebookLM: (a) official NotebookLM Enterprise API (Google Cloud, Preview v1alpha) or (b) opt-in unofficial notebooklm-py CLI on your own account.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), tls = require('tls'), net = require('net'), { spawn } = require('child_process');
const env = process.env, MOCK = env.FIAOS_MOCK === '1', PEOPLE = ['Ada', 'Bea', 'Cam'];
const DATA = env.FIAOS_DATA || path.join(__dirname, 'data');
const STORE = path.join(DATA, 'accounts.json');
const cfg = () => ({
  gid: env.GOOGLE_CLIENT_ID || '', gsec: env.GOOGLE_CLIENT_SECRET || '',
  msid: env.MS_CLIENT_ID || '', mstenant: env.MS_TENANT || 'common',
  nlmProject: env.NOTEBOOKLM_PROJECT_NUMBER || '', nlmLoc: env.NOTEBOOKLM_LOCATION || 'global', nlmEp: env.NOTEBOOKLM_ENDPOINT_LOCATION || 'global',
  nlmCli: env.NOTEBOOKLM_CLI || '/opt/fiaos/nlm-venv/bin/notebooklm', nlmHome: env.NOTEBOOKLM_HOME || path.join(DATA, 'notebooklm'),
  tz: env.FIAOS_TZ || 'UTC', port: +env.PORT || 8080,
});
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
let store = {}; try { store = JSON.parse(fs.readFileSync(STORE, 'utf8')) } catch { store = {} }
const save = () => { const t = STORE + '.tmp'; fs.writeFileSync(t, JSON.stringify(store, null, 1), { mode: 0o600 }); fs.renameSync(t, STORE) };
const acct = p => (store[p] ??= {});
const form = o => new URLSearchParams(o).toString();
async function jfetch(url, opt = {}) { const r = await fetch(url, opt); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = { raw: t } } if (!r.ok) { const e = new Error(j.error_description || j.error?.message || j.error || ('HTTP ' + r.status)); e.status = r.status; e.body = j; throw e } return j }
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------- Google (loopback + PKCE) ----------
const GSCOPES = { calendar: 'https://www.googleapis.com/auth/calendar.readonly', calendarWrite: 'https://www.googleapis.com/auth/calendar.events', gmail: 'https://www.googleapis.com/auth/gmail.readonly', notebooklm: 'https://www.googleapis.com/auth/cloud-platform', drive: 'https://www.googleapis.com/auth/drive.file' }; // drive.file = only files fiaOS itself creates (NotebookLM source docs)
const PENDING_G = path.join(DATA, 'oauth-pending.json'); // survives a server restart mid sign-in (15-min expiry, 0600)
let pendingG = {}; try { pendingG = JSON.parse(fs.readFileSync(PENDING_G, 'utf8')) } catch { pendingG = {} }
const savePendingG = () => { try { for (const [k, v] of Object.entries(pendingG)) if (Date.now() - v.ts > 15 * 60e3) delete pendingG[k]; const t = PENDING_G + '.tmp'; fs.writeFileSync(t, JSON.stringify(pendingG), { mode: 0o600 }); fs.renameSync(t, PENDING_G) } catch (e) { console.log('oauth: could not save pending state', e.message) } };
const olog = m => console.log(`${new Date().toLocaleString('en-AU', { hour12: false })} google-oauth ${m}`);
function googleStart(person, wants) {
  const c = cfg(); if (!c.gid && !MOCK) throw new Error('GOOGLE_CLIENT_ID not configured (see ACCOUNTS-SETUP.md)');
  const state = b64url(crypto.randomBytes(18)), verifier = b64url(crypto.randomBytes(32));
  const scopes = ['openid', 'email', ...wants.filter(w => GSCOPES[w]).map(w => GSCOPES[w])];
  pendingG[state] = { person, verifier, scopes, ts: Date.now() }; savePendingG(); olog(`start ${person}: ${wants.filter(w => GSCOPES[w]).join(', ')}`);
  const redirect = `http://127.0.0.1:${c.port}/oauth/google/callback`;
  if (MOCK) return { authUrl: `/oauth/google/callback?state=${state}&code=MOCKCODE` };
  return { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?' + form({ client_id: c.gid, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' }) };
}
async function googleCallback(q) {
  const p = pendingG[q.get('state')]; delete pendingG[q.get('state')]; savePendingG();
  if (!p || Date.now() - p.ts > 15 * 60e3) throw new Error('Login expired or unknown; start again from Settings > Accounts');
  if (q.get('error')) { const e = new Error(q.get('error') === 'access_denied' ? 'Access was not granted (Cancel was tapped, or a Google Workspace admin setting blocked it).' : 'Google said: ' + q.get('error')); e.person = p.person; throw e }
  const c = cfg(); let tok;
  if (MOCK) tok = { access_token: 'mock', refresh_token: 'mock', expires_in: 3600, scope: p.scopes.join(' '), id_token: 'x.' + b64url(Buffer.from(JSON.stringify({ email: p.person.toLowerCase() + '@gmail.example' }))) + '.x' };
  else tok = await jfetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ code: q.get('code'), client_id: c.gid, client_secret: c.gsec, redirect_uri: `http://127.0.0.1:${c.port}/oauth/google/callback`, grant_type: 'authorization_code', code_verifier: p.verifier }) });
  let email = ''; try { email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64').toString()).email } catch { }
  olog(`connected ${p.person}: scopes granted = ${String(tok.scope || '').split(' ').map(x => Object.keys(GSCOPES).find(k => GSCOPES[k] === x) || x.replace(/^https:\/\/www\.googleapis\.com\/auth\//, '')).join(', ')}`);
  const a = acct(p.person); a.google = { refresh_token: tok.refresh_token || a.google?.refresh_token, access_token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000, scope: tok.scope, email, at: new Date().toISOString() }; save(); delete gCache[p.person];
  return { person: p.person, email };
}
async function gToken(person) {
  const g = acct(person).google; if (!g) throw new Error('Google not connected');
  if (MOCK || g.exp > Date.now()) return g.access_token;
  const c = cfg(); const t = await jfetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: c.gid, client_secret: c.gsec, refresh_token: g.refresh_token, grant_type: 'refresh_token' }) });
  g.access_token = t.access_token; g.exp = Date.now() + (t.expires_in - 60) * 1000; save(); return g.access_token;
}
const gHas = (p, s) => (acct(p).google?.scope || '').split(' ').includes(GSCOPES[s]);
const gget = async (p, url) => jfetch(url, { headers: { Authorization: 'Bearer ' + await gToken(p) } });

// ---------- shared household calendar + per-person tags ----------
// One Google (Workspace) calendar connected under SHARED's account; people without their own Google connection read it too.
// Tag rule per event: title "[Name] ..." prefix > "#name" in description > event colour (colorId) > SHARED (default owner).
// "[All]" / "#all" = shown to everyone.
const SHARED = (() => { const v = String(env.FIAOS_SHARED_GOOGLE || 'Ada').trim(); return PEOPLE.find(p => p.toLowerCase() === v.toLowerCase()) || 'Ada' })();
const SHARED_CAL = env.FIAOS_SHARED_CALENDAR || ''; // optional calendar ID (e.g. ...@group.calendar.google.com); default: all selected calendars, writes go to primary
const TAG_COLORS = (() => { // FIAOS_TAG_COLORS="Bea=3,Cam=7"  (Google colorId 1-11; 3 = Grape, 7 = Peacock)
  const m = { Bea: '3', Cam: '7' };
  if (env.FIAOS_TAG_COLORS) { for (const k of Object.keys(m)) delete m[k]; for (const kv of env.FIAOS_TAG_COLORS.split(',')) { const [n, c] = kv.split('=').map(x => x.trim()); const p = PEOPLE.find(x => x.toLowerCase() === (n || '').toLowerCase()); if (p && /^\d{1,2}$/.test(c || '')) m[p] = c } }
  return m;
})();
const TAGNAMES = [...PEOPLE, 'All'];
const tagName = s => TAGNAMES.find(n => n.toLowerCase() === String(s).toLowerCase());
function tagEvent(e) { // -> { person: 'Ada'|'Bea'|'Cam'|'All', title (prefix stripped), by: 'title'|'description'|'colour'|'default' }
  let title = e.summary || '(no title)';
  const m = title.match(/^\s*\[\s*(ada|bea|cam|all)\s*\]\s*/i);
  if (m) return { person: tagName(m[1]), title: title.slice(m[0].length) || '(no title)', by: 'title' };
  const d = String(e.description || '').match(/(?:^|[^\w&])#(ada|bea|cam|all)\b/i);
  if (d) return { person: tagName(d[1]), title, by: 'description' };
  const c = Object.keys(TAG_COLORS).find(p => p !== SHARED && TAG_COLORS[p] === String(e.colorId || ''));
  if (c) return { person: c, title, by: 'colour' };
  return { person: SHARED, title, by: 'default' };
}
// Which Google account serves `person` for scope s: their own connection, else the shared one.
function gSource(person, s) {
  if (person !== 'All' && gHas(person, s)) return { acct: person, shared: person === SHARED };
  if (gHas(SHARED, s)) return { acct: SHARED, shared: true };
  return null;
}
const gCache = {}; // short cache so Ada/Bea/Cam views don't each re-download the same shared calendar
async function googleEvents(who) {
  const hit = gCache[who]; if (hit && Date.now() - hit.t < 60e3) return hit.items;
  let items = [];
  if (MOCK) items = [
    { id: 'g1', summary: 'BIOL1010 Final Exam', start: { date: days(9).slice(0, 10) }, _cal: 'Mock' },
    { id: 'g2', summary: 'Dentist', start: { dateTime: days(2) }, _cal: 'Mock' },
    { id: 'g3', summary: '[Bea] Netball training', start: { dateTime: days(1) }, _cal: 'Mock' },
    { id: 'g4', summary: 'Guitar lesson', colorId: '7', start: { dateTime: days(3) }, _cal: 'Mock' },
    { id: 'g5', summary: 'Uni study group', colorId: '3', start: { dateTime: days(4) }, _cal: 'Mock' },
    { id: 'g6', summary: 'Family dinner at Nan\'s', description: 'bring dessert #all', start: { dateTime: days(5) }, _cal: 'Mock' },
    { id: 'g7', summary: '[cam] Car service', start: { date: days(6).slice(0, 10) }, _cal: 'Mock' },
    { id: 'g8', summary: 'Haircut', description: 'for #Bea', start: { dateTime: days(7) }, _cal: 'Mock' },
  ];
  else {
    const cals = SHARED_CAL && who === SHARED ? [{ id: SHARED_CAL, summary: 'Shared' }]
      : ((await gget(who, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=20')).items || []).filter(x => x.selected !== false).slice(0, 8);
    for (const cal of cals) {
      const ev = await gget(who, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?` + form({ timeMin: days(-1), timeMax: days(60), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' }));
      for (const e of ev.items || []) if (e.status !== 'cancelled') items.push({ ...e, _cal: cal.summary });
    }
  }
  gCache[who] = { t: Date.now(), items }; return items;
}

// ---------- Microsoft (device code) ----------
const MSCOPE = 'offline_access openid email User.Read Mail.Read Calendars.Read';
const pendingM = {};
async function msStart(person) {
  const c = cfg(); if (!c.msid && !MOCK) throw new Error('MS_CLIENT_ID not configured (see ACCOUNTS-SETUP.md)');
  const d = MOCK ? { user_code: 'MOCK-1234', verification_uri: 'https://microsoft.com/devicelogin', interval: 1, expires_in: 900, device_code: 'mock' }
    : await jfetch(`https://login.microsoftonline.com/${c.mstenant}/oauth2/v2.0/devicecode`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: c.msid, scope: MSCOPE }) });
  const st = pendingM[person] = { user_code: d.user_code, verification_uri: d.verification_uri, status: 'waiting', expires: Date.now() + d.expires_in * 1000 };
  (async () => {
    let iv = (d.interval || 5) * 1000;
    while (Date.now() < st.expires && st.status === 'waiting') {
      await new Promise(r => setTimeout(r, MOCK ? 1500 : iv));
      try {
        const t = MOCK ? { access_token: 'mock', refresh_token: 'mock', expires_in: 3600, scope: MSCOPE }
          : await jfetch(`https://login.microsoftonline.com/${c.mstenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: c.msid, device_code: d.device_code }) });
        const me = MOCK ? { mail: person.toLowerCase() + '@student.uni.example' } : await jfetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: 'Bearer ' + t.access_token } });
        acct(person).microsoft = { refresh_token: t.refresh_token, access_token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000, scope: t.scope, email: me.mail || me.userPrincipalName, at: new Date().toISOString() }; save();
        st.status = 'connected'; st.email = me.mail || me.userPrincipalName;
      } catch (e) {
        const code = e.body?.error;
        if (code === 'authorization_pending') continue;
        if (code === 'slow_down') { iv += 5000; continue }
        st.status = 'error'; st.error = e.message;
        if (/AADSTS65001|AADSTS90094|admin|consent/i.test(e.message)) st.hint = 'Your organisation (uni) requires an administrator to approve fiaOS. Ask IT to grant consent for this app, or use the ICS calendar link / IMAP instead (if the uni allows it).';
      }
    }
    if (st.status === 'waiting') st.status = 'expired';
  })();
  return { user_code: st.user_code, verification_uri: st.verification_uri, expires_in: d.expires_in };
}
async function msToken(person) {
  const m = acct(person).microsoft; if (!m) throw new Error('Microsoft not connected');
  if (MOCK || m.exp > Date.now()) return m.access_token;
  const c = cfg(); const t = await jfetch(`https://login.microsoftonline.com/${c.mstenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', client_id: c.msid, refresh_token: m.refresh_token, scope: MSCOPE }) });
  m.access_token = t.access_token; if (t.refresh_token) m.refresh_token = t.refresh_token; m.exp = Date.now() + (t.expires_in - 60) * 1000; save(); return m.access_token;
}
const msget = async (p, url, extra = {}) => jfetch('https://graph.microsoft.com/v1.0' + url, { headers: { Authorization: 'Bearer ' + await msToken(p), ...extra } });

// ---------- IMAP (minimal read-only client) ----------
function decodeWords(s) {
  return (s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    try { const buf = /b/i.test(enc) ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'binary'); return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : 'latin1').decode(buf) } catch { return txt }
  }).replace(/\?=\s+=\?/g, '');
}
function imapFetch({ host, port = 993, user, pass, secure = true, n = 8 }) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '', tag = 0, waiting = null; const timer = setTimeout(() => { sock.destroy(); reject(new Error('IMAP timeout')) }, 20000);
    const q = s => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';
    sock.setEncoding('utf8');
    sock.on('data', d => { buf += d; if (waiting) waiting() });
    sock.on('error', e => { clearTimeout(timer); reject(e) });
    const until = re => new Promise(r => { const chk = () => { const m = buf.match(re); if (m) { waiting = null; const out = buf.slice(0, m.index + m[0].length); buf = buf.slice(m.index + m[0].length); r(out) } }; waiting = chk; chk() });
    const cmd = async c => { const t = 'F' + (++tag); sock.write(`${t} ${c}\r\n`); const out = await until(new RegExp(`(^|\\r\\n)${t} (OK|NO|BAD)[^\\r\\n]*\\r\\n`)); if (!new RegExp(`${t} OK`).test(out)) throw new Error('IMAP: ' + (out.split('\r\n').filter(Boolean).pop() || 'failed')); return out };
    (async () => {
      await until(/^\* (OK|PREAUTH)[^\r\n]*\r\n/);
      await cmd(`LOGIN ${q(user)} ${q(pass)}`);
      const st = await cmd('STATUS INBOX (MESSAGES UNSEEN)');
      const total = +(st.match(/MESSAGES (\d+)/) || [0, 0])[1], unread = +(st.match(/UNSEEN (\d+)/) || [0, 0])[1];
      const items = [];
      if (total) {
        await cmd('EXAMINE INBOX');
        const out = await cmd(`FETCH ${Math.max(1, total - n + 1)}:${total} (FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])`);
        for (const blk of out.split(/\r\n(?=\* \d+ FETCH)/)) {
          const m = blk.match(/^\*? ?(\d+) FETCH \(FLAGS \(([^)]*)\)/m) || blk.match(/\* (\d+) FETCH \(FLAGS \(([^)]*)\)/); if (!m) continue;
          const h = blk.replace(/\r\n[ \t]+/g, ' '), g = k => decodeWords(((h.match(new RegExp(`^${k}:\\s*(.*)$`, 'mi')) || [])[1] || '').trim());
          items.push({ id: 'imap:' + m[1], subject: g('Subject'), from: g('From'), date: new Date(g('Date')).toISOString?.() || '', unread: !/\\Seen/.test(m[2]), snippet: '' });
        }
      }
      await cmd('LOGOUT').catch(() => { }); clearTimeout(timer); sock.end();
      resolve({ unread, items: items.reverse() });
    })().catch(e => { clearTimeout(timer); sock.destroy(); reject(e) });
  });
}

// ---------- detection (bills / receipts / due dates) ----------
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function findDate(t, ref = new Date()) {
  let m = t.match(/(?<![\d$.,])(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?(?![\d.])/), d;
  if (m && (+m[1] > 31 || +m[2] > 12 || !+m[1] || !+m[2])) m = null;
  if (m) d = new Date(m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : ref.getFullYear(), +m[2] - 1, +m[1]);
  else if ((m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i))) d = new Date(m[3] ? +m[3] : ref.getFullYear(), MON[m[2].toLowerCase()], +m[1]);
  else if ((m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i))) d = new Date(m[3] ? +m[3] : ref.getFullYear(), MON[m[1].toLowerCase()], +m[2]);
  if (!d || isNaN(d)) return null;
  if (!m[3] && d < new Date(ref.getTime() - 60 * 864e5)) d.setFullYear(d.getFullYear() + 1);
  return d.toLocaleDateString('en-CA');
}
function classify(it) {
  const t = `${it.subject} ${it.snippet || ''}`, amt = t.match(/(?:\$|AUD\s?)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/i);
  let kind = null;
  if (/\b(receipt|order confirm|your order|tax invoice|payment received|thanks for your (order|purchase))\b/i.test(t)) kind = 'receipt';
  else if (/\b(bill|invoice|amount due|payment due|statement|overdue|direct debit)\b/i.test(t)) kind = 'bill';
  else if (/\b(due|deadline|submission|submit|assignment|assessment|quiz|exam|mid-?sem|final)\b/i.test(t)) kind = /\b(exam|mid-?sem|final|quiz)\b/i.test(t) ? 'exam' : 'due';
  return kind ? { kind, amount: amt ? +amt[1].replace(/,/g, '') : null, date: findDate(t) } : null;
}

// ---------- data fetchers ----------
const days = n => new Date(Date.now() + n * 864e5).toISOString();
// person: 'Ada' | 'Bea' | 'Cam' -> that person's events + [All]/#all events; 'All' (or everyone=true) -> every tagged event.
async function calendar(person, { everyone = false } = {}) {
  // Mail and the calendar live on this machine (fiamail.js). Google and Microsoft calendars are not read.
  const out = [], errors = [], all = person === 'All' || everyone;
  try { for (const e of require('./fiamail').eventsFor(all ? 'All' : person)) out.push(e); }
  catch (e) { errors.push('Local calendar: ' + e.message); }
  out.sort((x, y) => String(x.start).localeCompare(String(y.start)));
  return { events: out, errors, person, everyone: all, shared: { owner: 'local', viaShared: false, local: true } };
}
async function msCalendar(person, out, errors, label) {
  const a = acct(person);
  if (a.microsoft) try {
    if (MOCK) out.push({ source: 'microsoft', id: 'm1', title: 'PSYC1020 Tutorial', start: days(1), allDay: false }, { source: 'microsoft', id: 'm2', title: 'CHEM1100 Assignment 2 due', start: days(5).slice(0, 10), allDay: true });
    else {
      const r = await msget(person, '/me/calendarView?' + form({ startDateTime: days(-1), endDateTime: days(60), $top: '100', $select: 'id,subject,start,end,isAllDay,location', $orderby: 'start/dateTime' }), { Prefer: `outlook.timezone="${cfg().tz}"` });
      for (const e of r.value || []) out.push({ source: 'microsoft', id: e.id, title: e.subject || '(no title)', person, start: e.isAllDay ? e.start.dateTime.slice(0, 10) : e.start.dateTime, allDay: e.isAllDay, loc: e.location?.displayName || '' });
    }
  } catch (e) { errors.push((label ? person + ' ' : '') + 'Microsoft: ' + e.message) }
}
// Builds the Google event body; on the shared calendar, non-owners get a "[Name] " prefix + their tag colour.
function blockEvent(person, src, { title, start, end }) {
  let summary = String(title || 'Study block').trim(); const ev = { description: 'Added by fiaOS' };
  if (src.shared && person !== SHARED) {
    if (!new RegExp('^\\s*\\[\\s*' + person + '\\s*\\]', 'i').test(summary)) summary = `[${person}] ` + summary.replace(/^\s*\[\s*(ada|bea|cam|all)\s*\]\s*/i, '');
    if (TAG_COLORS[person]) ev.colorId = TAG_COLORS[person];
  }
  return { summary, ...ev, start: { dateTime: start, timeZone: cfg().tz }, end: { dateTime: end, timeZone: cfg().tz } };
}
async function addStudyBlock(person, b) {
  if (!PEOPLE.includes(person)) throw new Error('unknown person');
  return require('./fiamail').addEvent({ person, title: b.title || 'Study block', start: b.start, end: b.end, allDay: false, notes: 'Added from fiaOS', loc: '' });
}
async function mail(person) {
  // The inbox is the local mailbox. A saved IMAP server is pulled into it with /api/mail/sync. Gmail is not called.
  let res;
  try { res = require('./fiamail').inboxFor(person); }
  catch (e) { res = { unread: 0, items: [], errors: [e.message], sources: [] }; }
  res.items.forEach(i => { i.detect = classify(i); });
  return res;
}

// ---------- AusPost / StarTrack packages (from Gmail, read-only) ----------
// Searches the connected Gmail (gmail.readonly) for shipping emails from the last 30 days, extracts tracking numbers,
// dedupes by tracking number keeping the latest status. Cached 15 min for the whole household (one shared mailbox).
const PKG_TTL = 15 * 60e3; let pkgCache = null, pkgBusy = null;
const PKG_Q = 'newer_than:30d (from:auspost.com.au OR from:startrack.com.au OR "auspost.com.au/mypost/track" OR "startrack.com.au/track" OR "Australia Post" OR StarTrack OR auspost)';
const TRACK_URL = n => `https://auspost.com.au/mypost/track/details/${encodeURIComponent(n)}`;
const b64dec = s => { try { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') } catch { return '' } };
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const htmlText = h => String(h).replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi, ' $1 ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) => ENT[e.toLowerCase()] ?? (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m)).replace(/[ \t\u00a0]+/g, ' ');
function msgText(payload) { // text/plain preferred, html as fallback (links kept from href)
  const plain = [], html = [];
  (function walk(p) { if (!p) return; const mt = (p.mimeType || '').toLowerCase(); if (p.body?.data) { if (mt === 'text/plain') plain.push(b64dec(p.body.data)); else if (mt === 'text/html') html.push(b64dec(p.body.data)) } (p.parts || []).forEach(walk) })(payload);
  return { plain: plain.join('\n'), html: html.map(htmlText).join('\n'), rawHtml: html.join('\n') };
}
// AusPost/StarTrack link forms: /mypost/track/details/X, /mypost/track/#/details/X, /track/details/X, ?id=X / ?trackingId=X
const LINK_RE = /(?:auspost\.com\.au\/(?:mypost\/)?track(?:ing)?\/?(?:#\/)?(?:details\/|search\?(?:[^"'\s<>]*&)?(?:id|trackingid|q)=|\?(?:[^"'\s<>]*&)?(?:id|trackingid|trackIds)=)|startrack\.com\.au\/(?:track\/details\/|track-trace\/?\?(?:[^"'\s<>]*&)?id=))([A-Za-z0-9]{8,30})/gi;
const NUM_RE = /(?:tracking|consignment|article|parcel)\s*(?:number|no\.?|id|#|code)?\s*(?:is|:|-)?\s*#?\s*([A-Z0-9]{10,30})\b/gi;
const looksTrack = s => /\d/.test(s) && /^[A-Z0-9]{10,30}$/i.test(s) && !/^\d{1,9}$/.test(s) && (s.match(/\d/g) || []).length >= 6;
const STATUS = [ // most specific first; checked on subject, then body
  ['awaiting collection', /awaiting collection|ready (?:for|to) (?:collect|collection|pick ?up)|ready to be collected|available for collection|waiting (?:for you )?at (?:your|the) (?:parcel locker|post office|collection point)|collect (?:it|your parcel) from/i],
  ['out for delivery', /out for delivery|on board for delivery|with (?:our|the|your) driver|on (?:the|its) truck/i],
  ['arriving today', /arriving today|coming today|(?:delivery|arrive|arrives|arriving|deliver(?:ed)?) (?:is )?(?:expected )?today|today'?s deliver/i],
  ['delivered', /(?:has been|was|been|got|is) delivered|^\s*delivered\b|\bdelivered[:!.]|\bparcel delivered|\bdelivery (?:complete|successful)|we delivered|successfully delivered/i],
  ['in transit', /on (?:its|it's|the) way|in transit|has (?:been )?shipped|has been dispatched|dispatched|shipped|tracking (?:number|details)/i],
];
const statusOf = (subject, body) => { for (const src of [subject, String(body).slice(0, 4000)]) for (const [k, re] of STATUS) if (re.test(src)) return k; return '' };
const nameOf = from => { const m = String(from).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); const name = (m ? m[1] : '').trim(), addr = (m ? m[2] : from).trim().toLowerCase(); return { name: name || addr.split('@')[1] || addr, addr } };
function parsePackageMsg(d) { // Gmail API message (format=full) -> [{ tracking, carrier, retailer, subject, date, status }]
  const h = k => (d.payload?.headers || []).find(x => x.name.toLowerCase() === k)?.value || '';
  const subject = h('subject'), from = nameOf(h('from')), date = new Date(+d.internalDate || Date.parse(h('date')) || Date.now()).toISOString();
  const { plain, html, rawHtml } = msgText(d.payload); const text = (plain || html) ? [plain, html].join('\n') : (d.snippet || ''); // snippets are truncated, so only a fallback
  const isAP = /auspost\.com\.au|startrack\.com\.au/.test(from.addr), all = subject + '\n' + text + '\n' + rawHtml;
  const mentions = isAP || /auspost\.com\.au|australia post|startrack/i.test(all);
  if (!mentions) return [];
  const nums = new Map();
  for (const m of all.matchAll(LINK_RE)) if (looksTrack(m[1])) nums.set(m[1].toUpperCase(), /startrack/i.test(m[0]) ? 'StarTrack' : 'AusPost');
  if (!nums.size) for (const m of (subject + '\n' + text).matchAll(NUM_RE)) if (looksTrack(m[1])) nums.set(m[1].toUpperCase(), /startrack/i.test(all) && !/auspost|australia post/i.test(all) ? 'StarTrack' : 'AusPost');
  if (!nums.size) return [];
  let retailer = from.name;
  if (isAP) { const r = (subject + '\n' + text.slice(0, 1500)).match(/\b(?:from|sent by|order from|parcel from|delivery from)\s+([A-Z][\w&'’.\- ]{1,30}?)(?=\s+(?:is|has|was|will|are|on|to)\b|[,.!:\n]|$)/); retailer = r ? r[1].trim() : /startrack/.test(from.addr) ? 'StarTrack' : 'Australia Post' }
  retailer = retailer.replace(/\s+(?:team|orders?|shipping|notifications?|support|no-?reply)$/i, '').slice(0, 40);
  const status = statusOf(subject, text);
  return [...nums].map(([tracking, carrier]) => ({ tracking, carrier, retailer, subject: subject.slice(0, 140), date, status, msgId: d.id }));
}
const STATUS_RANK = { 'delivered': 5, 'awaiting collection': 4, 'out for delivery': 3, 'arriving today': 3, 'in transit': 1, '': 0 };
function mergePackages(found) { // dedupe by tracking number: latest message with a status wins; first-seen subject/retailer kept if later is generic
  const by = new Map();
  for (const f of found.sort((a, b) => a.date.localeCompare(b.date))) {
    const p = by.get(f.tracking) || { tracking: f.tracking, carrier: f.carrier, retailer: f.retailer, subject: f.subject, firstSeen: f.date, status: 'in transit', statusDate: f.date, lastSeen: f.date, emails: 0, url: TRACK_URL(f.tracking) };
    p.emails++; p.lastSeen = f.date;
    if (f.status) { p.status = f.status; p.statusDate = f.date; p.subject = f.subject }
    if (!/australia post|startrack/i.test(f.retailer) || /australia post|startrack/i.test(p.retailer)) p.retailer = /australia post|startrack/i.test(f.retailer) && !/australia post|startrack/i.test(p.retailer) ? p.retailer : f.retailer;
    if (f.carrier === 'StarTrack') p.carrier = 'StarTrack';
    by.set(f.tracking, p);
  }
  return [...by.values()].sort((a, b) => (a.status === 'delivered') - (b.status === 'delivered') || b.lastSeen.localeCompare(a.lastSeen));
}
const MOCK_MAIL = () => { // realistic Gmail API shapes for FIAOS_MOCK=1 / tests
  const enc = s => b64url(Buffer.from(s)), msg = (id, from, subject, ago, body, mime = 'text/plain') => ({ id, internalDate: String(Date.now() - ago * 36e5), snippet: body.replace(/<[^>]+>/g, ' ').slice(0, 120), payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }], parts: [{ mimeType: mime, body: { data: enc(body) } }] } });
  return [
    msg('m1', 'Australia Post <noreply@notifications.auspost.com.au>', 'Your parcel from Kmart is on its way', 50, 'Hi, your parcel from Kmart is on its way. Track it: https://auspost.com.au/mypost/track/details/33LPK501234501000930307'),
    msg('m2', 'Australia Post <noreply@notifications.auspost.com.au>', 'Your parcel is out for delivery', 2, 'Good news! Your parcel from Kmart is out for delivery today. https://auspost.com.au/mypost/track/#/details/33LPK501234501000930307'),
    msg('m3', 'JB Hi-Fi <orders@jbhifi.com.au>', 'Your JB Hi-Fi order has shipped', 30, '<p>Great news, your order has been dispatched with Australia Post.</p><p><a href="https://auspost.com.au/mypost/track/details/QZX8812345678AU">Track your parcel</a></p>', 'text/html'),
    msg('m4', 'StarTrack <no-reply@startrack.com.au>', 'Delivered: your StarTrack consignment', 20, 'Your consignment from IKEA has been delivered. Consignment number: ZTA1234567890123'),
    msg('m5', 'Australia Post <noreply@notifications.auspost.com.au>', 'Ready to collect from your Parcel Locker', 5, 'Your parcel from Amazon AU is ready to collect. Tracking number: 7XG0012345601'),
    msg('m6', 'Australia Post <noreply@notifications.auspost.com.au>', 'Your parcel has been delivered', 24 * 6, 'Your parcel from Etsy has been delivered. https://auspost.com.au/mypost/track/details/ABC1234567890'),
    msg('m7', 'Bunnings <news@bunnings.com.au>', 'This weekend only: 20% off', 3, 'Order number 123456789. Unsubscribe.'),
  ];
};
async function packages() {
  if (pkgCache && Date.now() - pkgCache.t < PKG_TTL) return { ...pkgCache.data, cached: true };
  if (pkgBusy) return pkgBusy;
  pkgBusy = (async () => {
    const accts = PEOPLE.filter(p => acct(p).google && gHas(p, 'gmail'));
    const res = { packages: [], errors: [], sources: accts, scanned: 0, checkedAt: new Date().toISOString(), ttlMin: 15 };
    if (!accts.length) { res.errors.push(Object.values(store).some(a => a.google) ? 'Google is connected without Gmail read access (gmail.readonly). Reconnect Google with "Gmail (read)" ticked in Settings → Accounts.' : 'No Gmail connected (Settings → Accounts).'); return res }
    const found = [], seen = new Set();
    for (const p of accts) try {
      let msgs;
      if (MOCK) msgs = MOCK_MAIL();
      else {
        const l = await gget(p, 'https://gmail.googleapis.com/gmail/v1/users/me/messages?' + form({ q: PKG_Q, maxResults: '40', includeSpamTrash: 'false' }));
        msgs = []; const ids = (l.messages || []).map(m => m.id).filter(id => !seen.has(id));
        for (let i = 0; i < ids.length; i += 5) msgs.push(...await Promise.all(ids.slice(i, i + 5).map(id => gget(p, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`).catch(e => { res.errors.push('Gmail message: ' + e.message); return null }))));
      }
      for (const d of msgs) { if (!d || seen.has(d.id)) continue; seen.add(d.id); res.scanned++; try { found.push(...parsePackageMsg(d)) } catch { } }
    } catch (e) { res.errors.push(`Gmail (${p}): ` + (e.status === 403 ? 'access denied — the Google connection may lack gmail.readonly; reconnect with "Gmail (read)" ticked.' : e.message)) }
    res.packages = mergePackages(found).map(({ msgId, ...x }) => x);
    return res;
  })();
  try { const data = await pkgBusy; if (!data.errors.length || data.packages.length) pkgCache = { t: Date.now(), data }; return data } finally { pkgBusy = null }
}

// ---------- NotebookLM ----------
function nlmMode(person) {
  const c = cfg();
  if (c.nlmProject && gHas(person, 'notebooklm')) return 'enterprise';
  if (MOCK || (fs.existsSync(c.nlmCli) && fs.existsSync(path.join(c.nlmHome, 'profiles', person.toLowerCase(), 'storage_state.json')))) return 'community';
  return null;
}
function runCli(person, args, input) {
  const c = cfg();
  return new Promise((resolve, reject) => {
    const p = spawn(c.nlmCli, ['-p', person.toLowerCase(), ...args], { env: { ...env, NOTEBOOKLM_HOME: c.nlmHome }, timeout: 180000 });
    let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d);
    p.on('error', reject); p.on('close', code => { if (code) return reject(new Error((e || o).trim().split('\n').pop() || 'notebooklm exited ' + code)); try { resolve(JSON.parse(o)) } catch { resolve({ raw: o }) } });
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}
const pickId = j => j.id || j.notebook_id || j.notebook?.id || j.notebookId || (j.raw || '').match(/[0-9a-f]{8}-[0-9a-f-]{27,}/)?.[0];
async function nlmList(person) {
  const mode = nlmMode(person), c = cfg();
  if (!mode) return { mode: null, notebooks: [] };
  if (MOCK) return { mode, notebooks: [{ id: 'mock-nb', title: 'BIOL1010 study', url: 'https://notebooklm.google.com/notebook/mock-nb' }] };
  if (mode === 'enterprise') {
    const r = await gget(person, `https://${c.nlmEp}-discoveryengine.googleapis.com/v1alpha/projects/${c.nlmProject}/locations/${c.nlmLoc}/notebooks:listRecentlyViewed`);
    return { mode, notebooks: (r.notebooks || []).map(n => ({ id: n.notebookId, title: n.title, url: `https://notebooklm.cloud.google.com/${c.nlmLoc}/notebook/${n.notebookId}?project=${c.nlmProject}` })) };
  }
  const j = await runCli(person, ['list', '--json']);
  const arr = Array.isArray(j) ? j : (j.notebooks || []);
  return { mode, notebooks: arr.map(n => ({ id: n.id, title: n.title, url: `https://notebooklm.google.com/notebook/${n.id}` })) };
}
async function nlmCreate(person, { title, text }) {
  const mode = nlmMode(person), c = cfg();
  if (!mode) throw new Error('NotebookLM not connected for ' + person);
  if (MOCK) return { mode, id: 'mock-' + Date.now(), url: 'https://notebooklm.google.com/notebook/mock', sources: 1 };
  if (mode === 'enterprise') {
    const tok = await gToken(person), base = `https://${c.nlmEp}-discoveryengine.googleapis.com/v1alpha/projects/${c.nlmProject}/locations/${c.nlmLoc}/notebooks`;
    const nb = await jfetch(base, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    await jfetch(`${base}/${nb.notebookId}/sources:batchCreate`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ userContents: [{ textContent: { sourceName: title + ' – fiaOS study pack', content: text } }] }) });
    return { mode, id: nb.notebookId, url: `https://notebooklm.cloud.google.com/${c.nlmLoc}/notebook/${nb.notebookId}?project=${c.nlmProject}`, sources: 1 };
  }
  const nb = await runCli(person, ['create', title, '--json']); const id = pickId(nb);
  if (!id) throw new Error('Could not read the new notebook id from notebooklm-py');
  await runCli(person, ['source', 'add', '-', '--type', 'text', '--title', title + ' – fiaOS study pack', '-n', id, '--json'], text);
  return { mode, id, url: `https://notebooklm.google.com/notebook/${id}`, sources: 1 };
}

// ---------- status + HTTP routing ----------
function status() {
  const c = cfg(), out = { configured: { google: !!c.gid || MOCK, microsoft: !!c.msid || MOCK, notebooklmEnterprise: !!c.nlmProject, notebooklmCli: MOCK || fs.existsSync(c.nlmCli) }, mock: MOCK, people: {}, shared: { owner: 'local', calendar: true, calendarWrite: true, colors: TAG_COLORS, local: true } };
  for (const p of PEOPLE) {
    const a = acct(p), g = a.google, m = a.microsoft;
    out.people[p] = {
      google: g ? { email: g.email, calendar: gHas(p, 'calendar'), calendarWrite: gHas(p, 'calendarWrite'), gmail: gHas(p, 'gmail'), notebooklm: gHas(p, 'notebooklm'), drive: gHas(p, 'drive'), at: g.at } : null,
      microsoft: m ? { email: m.email, at: m.at } : null, microsoftPending: pendingM[p] && pendingM[p].status !== 'connected' ? { ...pendingM[p] } : null,
      imap: a.imap ? { host: a.imap.host, user: a.imap.user, label: a.imap.label } : null, notebooklm: nlmMode(p),
      calendarVia: gSource(p, 'calendar')?.acct || null, // whose Google connection this person's calendar reads use
    };
  }
  return out;
}
const hesc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// result page after Google: one postMessage to the fiaOS tab that opened it (no polling needed), no reloads, no auto-redirects
const html = (t, b, ok = true) => `<!doctype html><meta name=viewport content="width=device-width"><title>fiaOS · ${hesc(t)}</title><body style="font:20px system-ui;background:#060912;color:#e8fbfa;display:grid;place-items:center;height:90vh;text-align:center"><div><h1 style="color:${ok ? '#39C5BB' : '#ff7ab8'}">${hesc(t)}</h1><p>${b}</p><p><button style="font:20px system-ui;padding:12px 24px;border-radius:24px" onclick="window.close()">Close</button> <a style="color:#86CECB" href="http://localhost:${cfg().port}/">Back to fiaOS</a></p></div><script>try{window.opener&&window.opener.postMessage('fiaos:google-${ok ? 'connected' : 'failed'}','*')}catch(e){}</script>`;
// GET /oauth/google/start?person=Ada[&add=drive]  -> 302 to Google with the person's current Google access + the added scope(s).
// Only on the Mac itself (loopback): Google returns to http://127.0.0.1:<port>/oauth/google/callback, which an iPad can't reach.
function googleStartPage(u, ip) {
  const person = u.searchParams.get('person');
  if (!PEOPLE.includes(person)) return { code: 400, body: html('Unknown person', 'Use ?person=Ada, Bea or Cam.', false) };
  if (!/^(::1|127\.|::ffff:127\.)/.test(ip)) return { code: 403, body: html('Do this on the Mac', `Google sends you back to the Mac itself (127.0.0.1), so this sign-in only works there. On the Mac, open <b>http://localhost:${cfg().port}</b> → Settings → 📓 NotebookLM.`, false) };
  const add = String(u.searchParams.get('add') || '').split(',').map(x => x.trim()).filter(k => GSCOPES[k]);
  const have = ['calendar', 'calendarWrite', 'gmail', 'notebooklm', 'drive'].filter(k => gHas(person, k));
  const wants = [...new Set(['calendar', ...have, ...add])];
  return { code: 302, location: googleStart(person, wants).authUrl };
}
async function handle(req, res, u, _send, readBody) {
  // same-origin only: no CORS header, and POSTs must carry X-FiaOS (forces a preflight that other origins fail)
  const send = (res, code, b, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(typeof b === 'string' ? b : JSON.stringify(b)) };
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(res, 403, { error: 'missing X-FiaOS header' });
  const ip = req.socket.remoteAddress || ''; if (!/^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(ip)) return send(res, 403, { error: 'local only' });
  const P = () => { const p = u.searchParams.get('person'); if (!PEOPLE.includes(p)) throw new Error('unknown person'); return p };
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}') } catch { return {} } };
  try {
    const r = u.pathname;
    if (r === '/oauth/google/start' && req.method === 'GET') { const x = googleStartPage(u, ip); if (x.location) { res.writeHead(302, { Location: x.location, 'Cache-Control': 'no-store' }); return res.end() } return send(res, x.code, x.body, 'text/html') }
    if (r === '/oauth/google/callback') {
      try { const x = await googleCallback(u.searchParams); const g = acct(x.person).google; return send(res, 200, html('Connected ✓', `${hesc(x.person)}'s Google account (${hesc(x.email)}) is connected to fiaOS${gHas(x.person, 'drive') ? ', including Google Drive for NotebookLM' : ''}. You can close this tab.`), 'text/html') }
      catch (e) { olog('callback error: ' + e.message); return send(res, 400, html('Google sign-in didn\'t finish', `${hesc(e.message)}<br><br><a style="color:#86CECB" href="/oauth/google/start?person=${encodeURIComponent(e.person || 'Ada')}&add=drive">Try again</a>`, false), 'text/html') }
    }
    if (r === '/api/acct/status') return send(res, 200, status());
    if (r === '/api/acct/google/start' && req.method === 'POST') { const b = await J(); const scopes = b.scopes || ['calendar']; if (scopes.every(s => ['calendar', 'gmail', 'calendarWrite'].includes(s))) return send(res, 400, { error: 'Mail and the calendar stay on this machine. Open House → Mail.' }); if (!PEOPLE.includes(b.person)) throw new Error('unknown person'); return send(res, 200, googleStart(b.person, scopes)) }
    if (r === '/api/acct/ms/start' && req.method === 'POST') { const b = await J(); if (!PEOPLE.includes(b.person)) throw new Error('unknown person'); return send(res, 200, await msStart(b.person)) }
    if (r === '/api/acct/imap' && req.method === 'POST') {
      const b = await J(); if (!PEOPLE.includes(b.person)) throw new Error('unknown person');
      const conf = { host: String(b.host || '').trim(), port: +b.port || 993, user: String(b.user || ''), pass: String(b.pass || ''), secure: b.secure !== false, label: b.label || 'Email' };
      if (/outlook|office365|hotmail|live\.com/i.test(conf.host)) throw new Error('Outlook.com / Microsoft 365 no longer accept IMAP passwords (Basic auth was removed). Use "Connect Microsoft" instead.');
      const test = MOCK ? { unread: 0 } : await imapFetch({ ...conf, n: 1 }); acct(b.person).imap = conf; save(); return send(res, 200, { ok: true, unread: test.unread })
    }
    if (r === '/api/acct/disconnect' && req.method === 'POST') { const b = await J(); if (acct(b.person)[b.provider]) { delete acct(b.person)[b.provider]; save() } if (b.provider === 'microsoft') delete pendingM[b.person]; delete gCache[b.person]; return send(res, 200, { ok: true }) }
    if (r === '/api/acct/calendar') { const p = u.searchParams.get('person'); if (p !== 'All' && !PEOPLE.includes(p)) throw new Error('unknown person'); return send(res, 200, await calendar(p, { everyone: /^(1|true|yes)$/i.test(u.searchParams.get('all') || '') })) }
    if (r === '/api/acct/calendar/block' && req.method === 'POST') { const b = await J(); return send(res, 200, await addStudyBlock(b.person, b)) }
    if (r === '/api/acct/mail') return send(res, 200, await mail(P()));
    if (r === '/api/acct/packages') return send(res, 200, await packages());
    if (r === '/api/acct/notebooklm') return send(res, 200, await nlmList(P()));
    if (r === '/api/acct/notebooklm/create' && req.method === 'POST') { const b = await J(); return send(res, 200, await nlmCreate(b.person, b)) }
    return send(res, 404, { error: 'not found' });
  } catch (e) { return send(res, 400, { error: e.message }) }
}
module.exports = { gToken, gHas, jfetch, PEOPLE, handle, packages, parsePackageMsg, mergePackages, MOCK_MAIL, calendar, mail, addStudyBlock, tagEvent, blockEvent, SHARED, TAG_COLORS, classify, findDate, imapFetch, decodeWords, status, _store: () => store };
