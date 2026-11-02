// Planner map + API checks (node --test). Runs planner.js on its own: no Notion, Grok or other background jobs start.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
process.env.FIAOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fiaos-planner-'));
const planner = require('../planner');
const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)) });
const srv = http.createServer((req, res) => planner.handle(req, res, new URL(req.url, 'http://x'), body));
let base;
test.before(() => new Promise(ok => srv.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${srv.address().port}`; ok() })));
test.after(() => srv.close());
const get = async u => { const r = await fetch(base + u); return { status: r.status, json: await r.json() } };
const post = async (u, b, h = { 'X-FiaOS': '1' }) => { const r = await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() } };

// every box on the paper planners (Ada/Bea/Cam FiaOS Planner.docx, identical apart from NotebookLM)
const FORM = ['targets', 'todos', 'chores', 'meals', 'recipes', 'extras', 'bills', 'expenses', 'order', 'assignments', 'exams', 'habits', 'notebooklm',
  'food', 'workouts', 'board', 'wiki', 'journal', 'prefs', 'connections', 'before'];
const ids = m => m.pages.flatMap(p => p.sections.map(s => s.id));

test('map covers every planner section, six pages, each with a home', () => {
  assert.deepEqual(planner.MAP.pages.map(p => p.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(planner.MAP).sort(), [...FORM].sort());
  for (const s of planner.MAP.pages.flatMap(p => p.sections)) assert.ok(s.fiaos || s.notion || s.fiahealth, `${s.id} has nowhere to go`);
});
test('the client has a form body for every section', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'plannerui.js'), 'utf8');
  for (const id of FORM) assert.match(ui, new RegExp(`\\n ${id}\\(`), `plannerui.js has no ${id}() section`);
});
test('per-person maps: NotebookLM only for Ada and Bea', async () => {
  for (const [p, nb] of [['Ada', 'Demo Science'], ['Bea', 'Demo Letters'], ['Cam', null]]) {
    const { status, json } = await get('/api/planner?person=' + p.toLowerCase());
    assert.equal(status, 200); assert.equal(json.person, p); assert.equal(json.map.notebook, nb);
    assert.equal(ids(json.map).includes('notebooklm'), p !== 'Cam');
    assert.match(json.links.fiaos, new RegExp(`/\\?person=${p}&tab=Planner$`));
    assert.match(json.links.fiahealth, new RegExp(`:3940/\\?user=${p}$`));
    assert.match(json.links.fiahealthCheckin, /tab=Daily%20check-in$/);
  }
  assert.equal((await get('/api/planner?person=Eve')).status, 400);
});
test('meta saves dates and known ticks only, per person, and survives a reload', async () => {
  const r = await post('/api/planner/meta', { person: 'Bea', weekOf: '2026-11-02', filledOn: 'not a date', checks: { 'nlm.drive': true, 'before.dupes': 1, 'evil.key': true } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.meta, { weekOf: '2026-11-02', filledOn: '', checks: { 'nlm.drive': true, 'before.dupes': true } });
  assert.deepEqual((await get('/api/planner?person=Ada')).json.meta, { weekOf: '', filledOn: '', checks: {} });
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.FIAOS_DATA, 'planner.json'), 'utf8'));
  assert.equal(saved.people.Bea.checks['nlm.drive'], true);
  assert.equal((fs.statSync(path.join(process.env.FIAOS_DATA, 'planner.json')).mode & 0o777), 0o600);
});
test('writes need the X-FiaOS header and a real person', async () => {
  assert.equal((await post('/api/planner/meta', { person: 'Bea', weekOf: '2026-11-02' }, {})).status, 403);
  assert.equal((await post('/api/planner/meta', { person: 'Nobody' })).status, 400);
  assert.equal((await get('/api/planner/nope')).status, 404);
});
