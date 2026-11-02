// Fia Mail + calendar. A mailbox and an ICS calendar on this machine.
// Optional IMAP fetch and SMTP send (your own server, or a hidden service). Google sign-in is not used.
// Messages and events can point at a note id or a task id. Search is registered with fiaos-core.
'use strict';
const fs = require('fs'), path = require('path'), tls = require('tls'), net = require('net');
const hub = require('./fiaos-core');
const DATA = hub.DATA, FILE = path.join(DATA, 'mail.json');
const PEOPLE = ['Ada', 'Bea', 'Cam', 'Everyone'];
const uid = () => Math.random().toString(36).slice(2, 10);
const ymd = d => new Date(d).toLocaleDateString('en-CA');
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
let DB = null;
function blank(now = new Date()) {
  const day = ymd(now);
  return {
    version: 1, example: true,
    accounts: {},
    messages: [
      { id: 'ex-mail-1', person: 'Bea', folder: 'Inbox', from: 'Demo desk <desk@example.local>', to: 'Bea', subject: 'Demo workshop — cue cards', date: new Date(now.getTime() - 36e5).toISOString(), unread: true, body: 'Example message, not a real letter.\n\nThe demo workshop starts at 9. The note is in FiaNotes.\n', example: true, noteId: 'exspeech', taskId: '' },
      { id: 'ex-mail-2', person: 'Everyone', folder: 'Inbox', from: 'House <house@example.local>', to: 'Everyone', subject: 'Bins: yellow lid this week', date: new Date(now.getTime() - 864e5).toISOString(), unread: false, body: 'Example reminder. Yellow lid Tuesday, red lid Friday. See the Bin night note.\n', example: true, noteId: 'exbin', taskId: '' }
    ],
    events: [
      { id: 'ex-ev-1', person: 'Bea', title: 'Demo workshop', start: day + 'T09:00:00', end: day + 'T12:00:00', allDay: false, loc: 'Demo hall', notes: 'Example event on today\'s local calendar.', example: true, noteId: 'exspeech', taskId: '' },
      { id: 'ex-ev-2', person: 'Everyone', title: 'Bin night', start: day, end: day, allDay: true, loc: 'Kerbside', notes: 'Example bin reminder for Demo Harbour.', example: true, noteId: 'exbin', taskId: '' }
    ]
  };
}
function load() {
  if (DB) return DB;
  try { DB = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { DB = blank(); }
  DB.messages ??= []; DB.events ??= []; DB.accounts ??= {};
  return DB;
}
function save() {
  try { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB, null, 1), { mode: 0o600 }); fs.renameSync(FILE + '.tmp', FILE); }
  catch (e) { console.log('mail: save', e.message); }
}
const personOf = p => PEOPLE.find(x => x.toLowerCase() === String(p || '').trim().toLowerCase()) || 'Bea';
function eventsFor(person) {
  const all = !person || person === 'All';
  return load().events.filter(e => all || e.person === person || e.person === 'Everyone').map(e => ({
    source: 'local', id: e.id, title: e.title, person: e.person, start: e.start, end: e.end || '', allDay: !!e.allDay, loc: e.loc || '', noteId: e.noteId || '', taskId: e.taskId || '', example: !!e.example
  })).sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
function inboxFor(person) {
  const db = load();
  const items = db.messages.filter(m => !person || person === 'All' || m.person === person || m.person === 'Everyone').map(m => ({
    id: m.id, provider: 'Fia Mail', subject: m.subject, from: m.from, to: m.to, date: m.date, unread: !!m.unread, snippet: clip(m.body, 180), person: m.person, noteId: m.noteId || '', taskId: m.taskId || '', folder: m.folder || 'Inbox', example: !!m.example
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { unread: items.filter(m => m.unread).length, items, errors: [], sources: ['This machine'] };
}
function upsertMessage(b) {
  const db = load();
  const prev = b.id ? db.messages.find(m => m.id === b.id) : null;
  const row = prev || { id: uid(), date: new Date().toISOString(), example: false, folder: 'Inbox' };
  row.person = personOf(b.person || row.person);
  row.subject = clip(b.subject ?? row.subject, 200) || '(no subject)';
  row.from = clip(b.from ?? row.from, 200) || 'Bea';
  row.to = clip(b.to ?? row.to, 200) || '';
  row.body = String(b.body ?? row.body ?? '').slice(0, 100000);
  if (b.unread != null) row.unread = !!b.unread;
  if (b.noteId != null) row.noteId = String(b.noteId || '');
  if (b.taskId != null) row.taskId = String(b.taskId || '');
  if (b.folder) row.folder = clip(b.folder, 40);
  if (!prev) db.messages.push(row);
  if (db.messages.some(m => !m.example) || db.events.some(e => !e.example)) db.example = false;
  save(); return row;
}
function addEvent(b) {
  const db = load();
  const prev = b.id ? db.events.find(e => e.id === b.id) : null;
  const row = prev || { id: uid(), example: false };
  row.person = personOf(b.person || row.person);
  row.title = clip(b.title ?? row.title, 160) || 'Event';
  row.start = String(b.start || row.start || new Date().toISOString()).slice(0, 25);
  row.end = String(b.end || row.end || '').slice(0, 25);
  row.allDay = b.allDay != null ? !!b.allDay : !!row.allDay;
  row.loc = clip(b.loc ?? row.loc, 160);
  row.notes = String(b.notes ?? row.notes ?? '').slice(0, 8000);
  if (b.noteId != null) row.noteId = String(b.noteId || '');
  if (b.taskId != null) row.taskId = String(b.taskId || '');
  if (!prev) db.events.push(row);
  db.example = false;
  save();
  return { ok: true, id: row.id, event: row };
}
function unescapeIcs(s) { return String(s || '').replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
function escapeIcs(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function parseIcs(text) {
  const src = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').replace(/\r\n/g, '\n');
  const out = [];
  for (const block of src.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const fields = {};
    for (const line of body.split('\n')) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase();
      fields[key] = line.slice(i + 1).trim();
    }
    const ds = fields.DTSTART || '';
    let start = '', allDay = false;
    if (/^\d{8}$/.test(ds)) { start = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`; allDay = true; }
    else if (/^\d{8}T\d{6}/.test(ds)) start = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}T${ds.slice(9, 11)}:${ds.slice(11, 13)}:${ds.slice(13, 15)}`;
    if (!fields.SUMMARY && !start) continue;
    out.push({ title: unescapeIcs(fields.SUMMARY || 'Event'), start, end: '', allDay, loc: unescapeIcs(fields.LOCATION || ''), notes: unescapeIcs(fields.DESCRIPTION || ''), uid: fields.UID || '' });
  }
  return out;
}
function toIcs(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FiaOS//Fia Mail//EN', 'CALSCALE:GREGORIAN'];
  for (const e of events || []) {
    const stamp = (e.start || '').replace(/[-:]/g, '').replace('T', 'T');
    lines.push('BEGIN:VEVENT', 'UID:' + (e.id || uid()) + '@fiaos.local', 'SUMMARY:' + escapeIcs(e.title));
    if (e.allDay) lines.push('DTSTART;VALUE=DATE:' + String(e.start).slice(0, 10).replace(/-/g, ''));
    else if (stamp) lines.push('DTSTART:' + stamp.slice(0, 15));
    if (e.loc) lines.push('LOCATION:' + escapeIcs(e.loc));
    if (e.notes) lines.push('DESCRIPTION:' + escapeIcs(e.notes));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
function importIcs(text, person) {
  const rows = parseIcs(text); let n = 0;
  for (const e of rows) { addEvent({ ...e, person: person || 'Everyone', example: false }); n++; }
  return { added: n };
}
function smtpData({ from, to, subject, text }) {
  const heads = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', String(text || '').replace(/^\./gm, '..')];
  return heads.join('\r\n') + '\r\n.';
}
function smtpSend(opts) {
  const { host, port = 587, user, pass, secure = false, from, to, subject, text } = opts || {};
  if (!host || !from || !to) return Promise.reject(new Error('SMTP needs host, from and to'));
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port: port || 465, servername: host }) : net.connect({ host, port: port || 587 });
    let buf = '', stage = 0; const timer = setTimeout(() => { sock.destroy(); reject(new Error('SMTP timeout')); }, 20000);
    const say = s => sock.write(s + '\r\n');
    sock.setEncoding('utf8');
    sock.on('error', e => { clearTimeout(timer); reject(e); });
    sock.on('data', d => {
      buf += d;
      if (!/\r\n$/.test(buf)) return;
      const lines = buf.trim().split(/\r\n/); buf = '';
      const last = lines[lines.length - 1] || '';
      const code = +last.slice(0, 3);
      try {
        if (stage === 0) { if (code !== 220) throw new Error(last); say('EHLO fiaos.local'); stage = 1; }
        else if (stage === 1) {
          if (code !== 250) throw new Error(last);
          if (user) { say('AUTH PLAIN ' + Buffer.from('\0' + user + '\0' + (pass || '')).toString('base64')); stage = 2; }
          else { say('MAIL FROM:<' + from.replace(/[<>]/g, '') + '>'); stage = 3; }
        } else if (stage === 2) { if (code !== 235) throw new Error(last); say('MAIL FROM:<' + from.replace(/[<>]/g, '') + '>'); stage = 3; }
        else if (stage === 3) { if (code !== 250) throw new Error(last); say('RCPT TO:<' + to.replace(/[<>]/g, '') + '>'); stage = 4; }
        else if (stage === 4) { if (code !== 250 && code !== 251) throw new Error(last); say('DATA'); stage = 5; }
        else if (stage === 5) { if (code !== 354) throw new Error(last); say(smtpData({ from, to, subject, text })); stage = 6; }
        else if (stage === 6) { if (code !== 250) throw new Error(last); say('QUIT'); clearTimeout(timer); sock.end(); resolve({ ok: true }); }
      } catch (e) { clearTimeout(timer); sock.destroy(); reject(e); }
    });
  });
}
function imapSync(account, person) {
  const { host, port = 993, user, pass, secure = true } = account || {};
  if (!host || !user) return Promise.reject(new Error('IMAP needs a host and a user'));
  return new Promise((resolve, reject) => {
    const sock = secure === false ? net.connect({ host, port }) : tls.connect({ host, port, servername: host });
    let buf = '', tag = 0, waiting = null; const timer = setTimeout(() => { sock.destroy(); reject(new Error('IMAP timeout')); }, 20000);
    const q = s => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';
    sock.setEncoding('utf8');
    sock.on('error', e => { clearTimeout(timer); reject(e); });
    sock.on('data', d => { buf += d; if (waiting) waiting(); });
    const until = re => new Promise(r => { const chk = () => { const m = buf.match(re); if (m) { waiting = null; const out = buf.slice(0, m.index + m[0].length); buf = buf.slice(m.index + m[0].length); r(out); } }; waiting = chk; chk(); });
    const cmd = async c => { const t = 'M' + (++tag); sock.write(`${t} ${c}\r\n`); const out = await until(new RegExp(`(^|\\r\\n)${t} (OK|NO|BAD)[^\\r\\n]*\\r\\n`)); if (!new RegExp(`${t} OK`).test(out)) throw new Error(out.split('\r\n').filter(Boolean).pop() || 'IMAP failed'); return out; };
    (async () => {
      await until(/^\* (OK|PREAUTH)[^\r\n]*\r\n/);
      await cmd(`LOGIN ${q(user)} ${q(pass || '')}`);
      await cmd('EXAMINE INBOX');
      const st = await cmd('STATUS INBOX (MESSAGES)');
      const total = +(st.match(/MESSAGES (\d+)/) || [0, 0])[1];
      let added = 0;
      if (total) {
        const out = await cmd(`FETCH ${Math.max(1, total - 7)}:${total} (UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])`);
        const db = load();
        for (const blk of out.split(/\r\n(?=\* \d+ FETCH)/)) {
          const uidm = blk.match(/UID (\d+)/); if (!uidm) continue;
          const id = 'imap:' + user + ':' + uidm[1];
          if (db.messages.some(m => m.id === id)) continue;
          const h = blk.replace(/\r\n[ \t]+/g, ' ');
          const g = k => ((h.match(new RegExp('^' + k + ':\\s*(.*)$', 'mi')) || [])[1] || '').trim();
          const seen = /\\Seen/.test(blk);
          db.messages.push({ id, person: personOf(person), folder: 'Inbox', from: g('From'), to: '', subject: g('Subject') || '(no subject)', date: new Date(g('Date') || Date.now()).toISOString(), unread: !seen, body: '', example: false, noteId: '', taskId: '' });
          added++;
        }
        save();
      }
      await cmd('LOGOUT').catch(() => {}); clearTimeout(timer); sock.end();
      resolve({ added, total });
    })().catch(e => { clearTimeout(timer); sock.destroy(); reject(e); });
  });
}
function saveAccount(person, kind, cfg) {
  const db = load(); const p = personOf(person);
  db.accounts[p] ??= {};
  if (kind === 'clear') { delete db.accounts[p]; save(); return { ok: true }; }
  const row = { host: clip(cfg.host, 200), port: +cfg.port || (kind === 'smtp' ? 587 : 993), user: clip(cfg.user, 200), pass: String(cfg.pass || ''), secure: cfg.secure !== false, from: clip(cfg.from, 200) };
  if (!row.host || !row.user) throw new Error('host and user needed');
  db.accounts[p][kind] = row; save();
  return { ok: true, person: p, kind, host: row.host, user: row.user };
}
function publicAccounts() {
  const out = {};
  for (const [p, a] of Object.entries(load().accounts)) out[p] = { imap: a.imap ? { host: a.imap.host, user: a.imap.user, port: a.imap.port } : null, smtp: a.smtp ? { host: a.smtp.host, user: a.smtp.user, port: a.smtp.port, from: a.smtp.from || '' } : null };
  return out;
}
function registerSearch() {
  hub.register('mail', terms => load().messages.filter(m => hub.match(terms, [m.subject, m.from, m.body, m.person].join('\n'))).slice(0, 8).map(m => ({ kind: 'mail', id: m.id, title: m.subject, snippet: clip(m.body, 120), tab: 'House', score: 3 })));
  hub.register('event', terms => load().events.filter(e => hub.match(terms, [e.title, e.loc, e.notes, e.person].join('\n'))).slice(0, 8).map(e => ({ kind: 'event', id: e.id, title: e.title, snippet: (e.start || '') + (e.loc ? ' · ' + e.loc : ''), tab: 'House', score: 3 })));
}
function start() { load(); registerSearch(); }
async function handle(req, res, u, readBody) {
  const send = (c, o, type = 'application/json') => { res.writeHead(c, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o)); };
  if (!hub.localOnly(req)) return send(403, { error: 'local only' });
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
  try {
    const r = u.pathname, post = req.method === 'POST';
    if (r === '/api/mail' && !post) return send(200, { ...inboxFor(u.searchParams.get('person') || ''), accounts: publicAccounts(), example: !!load().example });
    if (r === '/api/mail/message' && !post) { const m = load().messages.find(x => x.id === u.searchParams.get('id')); if (!m) return send(404, { error: 'not found' }); return send(200, { message: m, links: hub.linksFor('mail', m.id) }); }
    if (r === '/api/mail/message' && post) return send(200, { message: upsertMessage(await J()) });
    if (r === '/api/mail/read' && post) { const b = await J(), m = load().messages.find(x => x.id === b.id); if (!m) throw new Error('not found'); m.unread = false; save(); return send(200, { ok: true }); }
    if (r === '/api/mail/send' && post) {
      const b = await J(); const acct = load().accounts[personOf(b.person)]?.smtp;
      const draft = upsertMessage({ ...b, from: b.from || acct?.from || acct?.user || 'Bea', folder: 'Sent', unread: false });
      if (!acct) return send(200, { ok: true, sent: false, stored: true, message: draft, note: 'Saved on this machine. Add an SMTP server in Mail setup to deliver it.' });
      await smtpSend({ ...acct, from: acct.from || acct.user, to: b.to, subject: draft.subject, text: draft.body });
      return send(200, { ok: true, sent: true, message: draft });
    }
    if (r === '/api/mail/sync' && post) { const b = await J(); const acct = load().accounts[personOf(b.person)]?.imap; if (!acct) throw new Error('No IMAP server saved for that person'); return send(200, await imapSync(acct, b.person)); }
    if (r === '/api/mail/account' && post) { const b = await J(); return send(200, saveAccount(b.person, b.kind, b)); }
    if (r === '/api/mail/calendar' && !post) {
      if ((u.searchParams.get('fmt') || '') === 'ics') return send(200, toIcs(load().events), 'text/calendar');
      return send(200, { events: eventsFor(u.searchParams.get('person') || 'All') });
    }
    if (r === '/api/mail/event' && post) return send(200, addEvent(await J()));
    if (r === '/api/mail/event/remove' && post) { const b = await J(); load().events = load().events.filter(e => e.id !== b.id); save(); return send(200, { ok: true, events: eventsFor('All') }); }
    if (r === '/api/mail/ics' && post) { const b = await J(); return send(200, importIcs(b.text || '', b.person)); }
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message }); }
}
module.exports = { handle, start, eventsFor, inboxFor, addEvent, upsertMessage, parseIcs, toIcs, smtpData, importIcs, load, _blank() { DB = blank(); return DB; } };
