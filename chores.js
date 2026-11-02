// fiaOS chores + to-dos (server). Local only, per person, nothing pre-filled: every item is added by hand (fiaOS, Facet's Commissions tab, or the helper).
// Chores repeat: each has an owner and a day, and the ticks clear every Monday (last week's ticks are kept for the weekly review).
// To-dos are one-offs: an owner, a title, ticked off whenever.
// GET  /api/chores                       -> {week, items:[{id,name,day,weight,person,done,next}], people:{Ada:{assigned,done,effort}}, notionUrl, lastSync, error}
// POST /api/chores/tick {id,done}
// POST /api/chores/edit {op:'add'|'update'|'remove', id?, name?, person?, day?}
// GET  /api/todos                        -> {items:[{id,name,person,done,created}], people:{Ada:{open,done}}}
// POST /api/todos/add {name,person} | /api/todos/tick {id,done} | /api/todos/remove {id}
'use strict';
const fs = require('fs'), path = require('path');
const PEOPLE = ['Ada', 'Bea', 'Cam'], DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Daily', 'Any'];
const DATA = process.env.FIAOS_DATA || path.join(__dirname, 'data'), FILE = path.join(DATA, 'chores.json');
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const ymd = d => d.toLocaleDateString('en-CA');
const monday = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x) };
const uid = () => Math.random().toString(36).slice(2, 9);
let ST = rd(FILE, {}); ST.list ??= []; ST.todos ??= []; ST.weeks ??= {};
const save = () => { const ks = Object.keys(ST.weeks).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - 26))) delete ST.weeks[k];
  try { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(ST, null, 1), { mode: 0o600 }); fs.renameSync(FILE + '.tmp', FILE) } catch (e) { console.log('chores: save', e.message) } };
const person = p => PEOPLE.find(x => x.toLowerCase() === String(p || '').trim().toLowerCase());
const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);

// new week: archive last week's ticks, clear them
function roll() { const wk = monday(); if (ST.week === wk) return wk;
  if (ST.week && ST.list.length) ST.weeks[ST.week] = { assign: Object.fromEntries(ST.list.map(c => [c.id, c.person])), done: Object.fromEntries(ST.list.map(c => [c.id, !!c.done])), names: Object.fromEntries(ST.list.map(c => [c.id, c.name])) };
  for (const c of ST.list) c.done = false; ST.week = wk; save(); return wk }
function view() { const week = roll();
  const items = ST.list.map(c => ({ id: c.id, name: c.name, day: c.day, weight: 1, person: c.person, done: !!c.done, next: '' }));
  const people = Object.fromEntries(PEOPLE.map(p => { const m = items.filter(i => i.person === p); return [p, { assigned: m.length, done: m.filter(i => i.done).length, effort: m.length }] }));
  return { week, items, people, notionUrl: null, lastSync: null, error: null } }
function todoView() { const items = ST.todos.map(t => ({ id: t.id, name: t.name, person: t.person, done: !!t.done, created: t.created }));
  const people = Object.fromEntries(PEOPLE.map(p => { const m = items.filter(i => i.person === p); return [p, { open: m.filter(i => !i.done).length, done: m.filter(i => i.done).length }] }));
  return { items, people } }
function weekSummary(week) { const cur = roll(); let W = ST.weeks[week];
  if (week === cur) W = { assign: Object.fromEntries(ST.list.map(c => [c.id, c.person])), done: Object.fromEntries(ST.list.map(c => [c.id, !!c.done])), names: Object.fromEntries(ST.list.map(c => [c.id, c.name])) };
  if (!W || !Object.keys(W.assign).length) return null;
  const people = {}; let A = 0, Dn = 0;
  for (const p of PEOPLE) { const list = Object.keys(W.assign).filter(id => W.assign[id] === p).map(id => ({ name: W.names?.[id] || id, done: !!W.done[id] })); people[p] = { assigned: list.length, done: list.filter(x => x.done).length, list }; A += list.length; Dn += people[p].done }
  return { people, total: { assigned: A, done: Dn } } }

function choreEdit(b) { roll();
  if (b.op === 'add') { const name = clean(b.name), p = person(b.person); if (!name) throw new Error('name needed'); if (!p) throw new Error('person needed (Ada, Bea or Cam)');
    ST.list.push({ id: uid(), name, person: p, day: DAYS.includes(b.day) ? b.day : 'Any', done: false }) }
  else { const c = ST.list.find(x => x.id === b.id); if (!c) throw new Error('chore not found');
    if (b.op === 'update') { if (clean(b.name)) c.name = clean(b.name); if (person(b.person)) c.person = person(b.person); if (DAYS.includes(b.day)) c.day = b.day }
    else if (b.op === 'remove') ST.list = ST.list.filter(x => x !== c);
    else throw new Error('bad op') }
  save(); return view() }
function choreTick(b) { roll(); const c = ST.list.find(x => x.id === b.id); if (!c) throw new Error('chore not found'); c.done = !!b.done; save(); return view() }

function start() {}
async function handle(req, res, u, readBody) {
  const send = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(b)) };
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  if (!/^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(req.socket.remoteAddress || '')) return send(403, { error: 'local only' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}') } catch { return {} } };
  try {
    const r = u.pathname, post = req.method === 'POST';
    if (r === '/api/chores' && !post) return send(200, view());
    if (r === '/api/chores/tick' && post) return send(200, choreTick(await J()));
    if (r === '/api/chores/edit' && post) return send(200, choreEdit(await J()));
    if (r === '/api/chores/sync' && post) return send(200, view());
    if (r === '/api/todos' && !post) return send(200, todoView());
    if (r === '/api/todos/add' && post) { const b = await J(), name = clean(b.name), p = person(b.person); if (!name) throw new Error('name needed'); if (!p) throw new Error('person needed (Ada, Bea or Cam)');
      ST.todos.push({ id: uid(), name, person: p, done: false, created: new Date().toISOString() }); save(); return send(200, todoView()) }
    if (r === '/api/todos/tick' && post) { const b = await J(), t = ST.todos.find(x => x.id === b.id); if (!t) throw new Error('to-do not found'); t.done = !!b.done; save(); return send(200, todoView()) }
    if (r === '/api/todos/remove' && post) { const b = await J(); ST.todos = ST.todos.filter(x => x.id !== b.id); save(); return send(200, todoView()) }
    return send(404, { error: 'not found' });
  } catch (e) { console.log(`chores ${u.pathname} error: ${e.message}`); return send(400, { error: e.message }) }
}
module.exports = { handle, start, view, weekSummary, monday };
