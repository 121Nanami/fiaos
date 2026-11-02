// House: shared search, local mail/calendar, links, studio export, facet URL check, launcher stats.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fiaos-house-'));
process.env.FIAOS_DATA = tmp;
process.env.FIAOS_MEDIA = path.join(tmp, 'media');
delete process.env.NOTION_TOKEN;
delete process.env.WHISPER_BIN;
delete process.env.WHISPER_MODEL;
const hub = require('../fiaos-core');
const mail = require('../fiamail');
const studio = require('../fiastudio');
const facet = require('../facet');
const launcher = require('../fialauncher');
const local = require('../fialocal');
const integ = require('../integrations');

test('ICS import round-trips a clinic event', () => {
  const events = mail.parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc\r\nSUMMARY:Clinic\\, Friday\r\nDTSTART:20261102T090000\r\nLOCATION:Rooms\r\nDESCRIPTION:Bring cards\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Clinic, Friday');
  assert.equal(events[0].start, '2026-11-02T09:00:00');
  assert.match(mail.toIcs([{ id: 'e1', title: 'Bin night', start: '2026-11-02', allDay: true, loc: 'Kerbside', notes: 'yellow' }]), /DTSTART;VALUE=DATE:20261102/);
  assert.match(mail.smtpData({ from: 'a@b.c', to: 'd@e.f', subject: 'Hi', text: 'Line\n.dot' }), /Subject: Hi/);
  assert.match(mail.smtpData({ from: 'a@b.c', to: 'd@e.f', subject: 'Hi', text: '.dot' }), /\r\n\.\.dot/);
});
test('local calendar is what the accounts API returns', async () => {
  mail._blank();
  const cal = await integ.calendar('Bea');
  assert.equal(cal.events.some(e => e.source === 'local' && /Demo workshop/.test(e.title)), true);
  assert.equal(cal.events.some(e => e.source === 'google'), false);
  const box = await integ.mail('Bea');
  assert.ok(box.items.some(m => /cue cards/.test(m.subject) && /Demo workshop/.test(m.subject)));
  assert.equal(box.sources[0], 'This machine');
});
test('search finds a note, a message and a task link', async () => {
  mail.start();
  const notes = require('../fianotes');
  notes._blank();
  notes.start();
  const made = notes._db();
  made.notes.push({ id: 'n1', kind: 'note', title: 'Cue cards', body: 'Demo pairs for the workshop', folder: 'inbox', tags: ['speech'], person: 'Bea', cells: {} });
  hub.register('tasks', () => [{ kind: 'task', id: 't1', title: 'Pack cue cards', snippet: 'Bea · Fri', tab: 'Habits & Chores', score: 2 }]);
  const hits = hub.search('cue cards');
  assert.ok(hits.some(h => h.kind === 'note' || h.kind === 'doc' || h.title === 'Cue cards'));
  assert.ok(hits.some(h => h.kind === 'mail'));
  assert.ok(hits.some(h => h.kind === 'task'));
  const link = hub.addLink({ fromKind: 'mail', fromId: 'ex-mail-1', toKind: 'note', toId: 'n1', label: 'cue cards' });
  assert.equal(hub.linksFor('note', 'n1')[0].id, link.id);
});
test('facet refuses script links and studio writes an ODT', () => {
  assert.equal(facet.okUrl('javascript:alert(1)'), '');
  assert.equal(facet.okUrl('data:text/html,hi'), '');
  assert.match(facet.okUrl('http://127.0.0.1:8080/?tab=Notes'), /Notes/);
  const buf = studio.odt('Clinic', ['Bring the cards.', 'Home by six.']);
  assert.equal(buf.slice(0, 2).toString(), 'PK');
  assert.match(buf.toString('binary'), /application\/vnd.oasis.opendocument.text/);
  const xml = require('../fianotes').unzip(buf)['content.xml'].toString();
  assert.match(xml, /Bring the cards/);
  const html = studio.slideHtml({ title: 'Deck', slides: [{ title: 'One', body: 'Hello', notes: 'pause' }] });
  assert.match(html, /<h1>One<\/h1>/);
  assert.doesNotMatch(html, /<script>/);
});
test('launcher stats and a missing whisper stay local', () => {
  const s = launcher.stats();
  assert.equal(typeof s.hostname, 'string');
  assert.ok(Array.isArray(s.load) && s.load.length === 3);
  const tile = launcher.tile('focus');
  assert.equal(tile.preset, 'focus');
  assert.equal(typeof tile.note, 'string');
  const tr = local.transcribe;
  assert.equal(typeof tr, 'function');
  assert.equal(local.wireguard().installed, local.wireguard().installed);
});

const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/hub/')) return hub.handle(req, res, u, body);
  if (u.pathname.startsWith('/api/mail')) return mail.handle(req, res, u, body);
  if (u.pathname.startsWith('/api/facet')) return facet.handle(req, res, u, body);
  if (u.pathname.startsWith('/api/studio')) return studio.handle(req, res, u, body);
  if (u.pathname.startsWith('/api/local')) return local.handle(req, res, u, body);
  res.writeHead(404); res.end();
});
let base;
test.before(async () => { await new Promise(ok => srv.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${srv.address().port}`; ok(); })); });
test.after(() => srv.close());
const post = async (u, b, h = { 'X-FiaOS': '1' }) => { const r = await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b || {}) }); return { status: r.status, json: await r.json() }; };
const get = async u => { const r = await fetch(base + u); const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch {} return { status: r.status, json, buf, type: r.headers.get('content-type') || '' }; };

test('HTTP: event, link, slides, odt, facet, transcribe stub', async () => {
  const ev = await post('/api/mail/event', { person: 'Cam', title: 'Race notes', start: '2026-11-08T14:00:00', noteId: 'n1' });
  assert.equal(ev.status, 200);
  const cal = await get('/api/mail/calendar?fmt=ics');
  assert.match(cal.type, /calendar/);
  assert.match(cal.buf.toString(), /Race notes/);
  const link = await post('/api/hub/links', { fromKind: 'event', fromId: ev.json.id, toKind: 'note', toId: 'n1' });
  assert.equal(link.status, 200);
  const back = await get('/api/hub/links?kind=note&id=n1');
  assert.ok(back.json.links.length >= 1);
  const deck = await post('/api/studio/slides', { title: 'Placement', slides: [{ title: 'Cue cards', body: 'sip / ship', notes: 'slow' }] });
  assert.equal(deck.status, 200);
  const page = await get('/api/studio/slides/html?id=' + deck.json.id);
  assert.match(page.buf.toString(), /Cue cards/);
  const bad = await post('/api/facet/bookmark', { title: 'nope', url: 'javascript:alert(1)' });
  assert.equal(bad.status, 400);
  const okb = await post('/api/facet/bookmark', { title: 'Notes', url: 'http://127.0.0.1:8080/?tab=Notes' });
  assert.equal(okb.status, 200);
  const draw = await post('/api/studio/draw', { title: 'Mark', svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' });
  assert.equal(draw.status, 200);
  const script = await post('/api/studio/draw', { title: 'Bad', svg: '<svg><script>alert(1)</script></svg>' });
  assert.equal(script.status, 400);
  const whisper = await post('/api/local/transcribe', { file: 'missing.wav' });
  assert.equal(whisper.json.stub, true);
  const denied = await post('/api/mail/event', { title: 'x' }, {});
  assert.equal(denied.status, 403);
});
