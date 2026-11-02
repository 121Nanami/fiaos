// fiaOS planner (server). The paper planners (Ada, Bea, Cam FiaOS Planner.docx) map 1:1 onto this: every section says where its
// answers live — a fiaOS tab, a Notion database, or Fia Health (private health app on :3940). The Planner tab in the app is built from MAP.
// Only the planner's own bits are stored here (week beginning, filled-in date, ready/checklist ticks); every real entry goes into the
// system that owns it (app state, chores.js, notes.js, Notion), so nothing is entered twice.
// GET  /api/planner/map              -> {pages:[{n,title,sections:[{id,title,fields,fiaos,notion,fiahealth,only?,note}]}]}
// GET  /api/planner?person=Bea       -> {person, meta:{weekOf,filledOn,checks}, links:{fiaos,fiahealth,fiahealthCheckin}, map}
// POST /api/planner/meta {person, weekOf?, filledOn?, checks?:{key:bool}}
'use strict';
const fs = require('fs'), path = require('path');
const PEOPLE = ['Ada', 'Bea', 'Cam'];
const DATA = process.env.FIAOS_DATA || path.join(__dirname, 'data'), FILE = path.join(DATA, 'planner.json');
const FH = `http://127.0.0.1:${+process.env.FIA_HEALTH_PORT || 3940}`;
const NOTEBOOK = { Ada: 'Demo Science', Bea: 'Demo Letters' }; // NotebookLM panels exist for Ada and Bea only
const CHECKS = ['nlm.drive', 'nlm.sources', 'nlm.refresh', 'conn.google', 'conn.microsoft', 'conn.imap', 'conn.calendar', 'conn.notion', 'conn.health', 'conn.helper',
  'before.person', 'before.checked', 'before.shared', 'before.dupes'];

const S = (id, title, fields, fiaos, extra = {}) => ({ id, title, fields, fiaos, ...extra });
const MAP = { pages: [
  { n: 1, title: 'Targets, to-dos and chores', sections: [
    S('targets', 'My targets', ['Goal', 'Daily kcal', 'Protein g', 'Carbs g', 'Fat g', 'Weekly budget AUD'], 'Planner', { also: 'Settings → Targets', notion: 'People & Targets', fiahealth: 'Your data (step goal)' }),
    S('todos', 'One-off to-dos', ['Task', 'Done'], 'Habits & Chores', { notion: null, note: 'Saved on the fiaOS server; Facet shows them too.' }),
    S('chores', 'Repeating chores', ['Chore', 'Day', 'Owner', 'Done'], 'Habits & Chores', { note: 'Ticks clear every Monday.' })] },
  { n: 2, title: 'Meals and recipes', sections: [
    S('meals', 'Meal plan (breakfast, lunch, dinner × Mon–Sun)', ['Day', 'Breakfast', 'Lunch', 'Dinner'], 'Meals & Diet', { notion: 'Meal Plan' }),
    S('recipes', 'Recipe to add', ['Recipe name', 'kcal per portion', 'Protein g', 'Carbs g', 'Fat g', 'Product and pack size', 'Fraction of pack', 'Price per pack AUD', 'Tags or notes'], 'Planner', { notion: 'Recipes', note: 'Pack fractions build the Woolworths quantities.' })] },
  { n: 3, title: 'Shopping and money', sections: [
    S('extras', 'Extra shopping and product prices', ['Extra item or product', 'Quantity in packs', 'Pack price AUD', 'Bought'], 'Woolworths', { notion: 'Shopping Extras', note: 'Charged to the person who adds it.' }),
    S('bills', 'Bills and rent (shared, enter once)', ['Bill', 'Total AUD', 'Frequency', 'Due date'], 'Money', { notion: 'Bills', shared: true }),
    S('expenses', 'Expenses', ['Date', 'Description', 'Category', 'Amount AUD'], 'Money', { notion: 'Expenses' }),
    S('order', 'Woolworths order', ['Order date', 'Actual checkout total AUD'], 'Woolworths', { shared: true, note: 'Grocery shares go to Expenses automatically; do not enter them again.' })] },
  { n: 4, title: 'Study and habits', sections: [
    S('assignments', 'Assignments', ['Assignment', 'Course', 'Due date', 'Done %'], 'Study', { notion: 'Uni' }),
    S('exams', 'Exams', ['Subject or exam', 'Date', 'Owner'], 'Study', { notion: 'Uni', note: 'Study blocks are generated from exam dates.' }),
    S('habits', 'Habits to track (M–S)', ['Habit', 'M', 'T', 'W', 'T', 'F', 'S', 'S'], 'Habits & Chores', { notion: 'Habits' }),
    S('notebooklm', 'NotebookLM', ['Notebook name', 'Notebook link', 'Drive permission granted', 'Sources added', 'Source refresh checked'], 'Study', { only: ['Ada', 'Bea'] })] },
  { n: 5, title: 'Daily logs and household notes', sections: [
    S('food', 'Food actually eaten', ['Date', 'Food and portion', 'kcal', 'P g', 'C g', 'F g'], 'Meals & Diet', { notion: 'Food Log' }),
    S('workouts', 'Workouts completed', ['Date', 'Workout', 'Minutes', 'Intensity'], 'Workouts', { notion: 'Workouts', fiahealth: 'Daily check-in (steps)' }),
    S('board', 'Family message board', ['From', 'Until or expiry', 'Message'], 'Stage', { note: '140 characters; no expiry = 24 hours.' }),
    S('wiki', 'Household wiki additions', ['Title', 'Category', 'Details'], null, { notion: 'Household Wiki', note: 'Read-only in fiaOS; add pages in Notion.' }),
    S('journal', 'Personal journal reflection and mood', ['Date', 'Reflection', 'Mood'], null, { fiahealth: 'Daily check-in (mood, notes)', note: 'Private: goes in your own encrypted Fia Health vault. The morning-brief journal in Notion is written by fiaOS itself.' })] },
  { n: 6, title: 'Settings and connections', sections: [
    S('prefs', 'Shared preferences (enter once)', ['Weather town', 'People sharing bills', 'Home profile', 'Helper persona', 'Display', 'Auto quality', 'Night mode', 'Grok model', 'Bin collection day', 'Recycling date', 'Green-waste date', 'Show email cards', "Show everyone's calendar"], 'Planner', { also: 'Settings', shared: true }),
    S('connections', 'My connections', ['Google', 'Microsoft', 'Other email', 'Calendar', 'Notion', 'Apple Health', 'Helper'], 'Settings', { note: 'Passwords, keys and private links go in Settings, never on paper.' }),
    S('before', 'Before entering', ['Correct person', 'Dates and amounts checked', 'Shared items entered once', 'Existing imports checked for duplicates'], 'Planner')] }] };

const rd = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} } };
let DB = rd(); DB.people ??= {};
const save = () => { try { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB, null, 1), { mode: 0o600 }); fs.renameSync(FILE + '.tmp', FILE) } catch (e) { console.log('planner: save', e.message) } };
const person = p => PEOPLE.find(x => x.toLowerCase() === String(p || '').trim().toLowerCase());
const ymd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';
const meta = p => { const m = DB.people[p] || {}; return { weekOf: m.weekOf || '', filledOn: m.filledOn || '', checks: { ...(m.checks || {}) } } };
const mapFor = p => ({ pages: MAP.pages.map(pg => ({ ...pg, sections: pg.sections.filter(s => !s.only || s.only.includes(p)) })), notebook: NOTEBOOK[p] || null });
function links(p, host) { const base = `http://${host || '127.0.0.1:' + (process.env.PORT || 8080)}`;
  return { fiaos: `${base}/?person=${p}&tab=Planner`, fiahealth: `${FH}/?user=${p}`, fiahealthCheckin: `${FH}/?user=${p}&tab=${encodeURIComponent('Daily check-in')}` } }
function setMeta(b) { const p = person(b.person); if (!p) throw new Error('person needed (Ada, Bea or Cam)');
  const m = DB.people[p] ??= {};
  if ('weekOf' in b) m.weekOf = ymd(b.weekOf);
  if ('filledOn' in b) m.filledOn = ymd(b.filledOn);
  if (b.checks && typeof b.checks === 'object') { m.checks ??= {}; for (const [k, v] of Object.entries(b.checks)) if (CHECKS.includes(k)) m.checks[k] = !!v }
  m.updated = new Date().toISOString(); save(); return meta(p) }

async function handle(req, res, u, readBody) {
  const send = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(b)) };
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  if (!/^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(req.socket.remoteAddress || '')) return send(403, { error: 'local only' });
  try {
    if (u.pathname === '/api/planner/map' && req.method === 'GET') return send(200, MAP);
    if (u.pathname === '/api/planner' && req.method === 'GET') { const p = person(u.searchParams.get('person')); if (!p) return send(400, { error: 'person needed (Ada, Bea or Cam)' });
      return send(200, { person: p, meta: meta(p), links: links(p, req.headers.host), map: mapFor(p) }) }
    if (u.pathname === '/api/planner/meta' && req.method === 'POST') { let b = {}; try { b = JSON.parse(await readBody(req) || '{}') } catch { }
      return send(200, { person: person(b.person), meta: setMeta(b) }) }
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message }) }
}
module.exports = { handle, MAP, CHECKS, mapFor, setMeta, meta, links };
