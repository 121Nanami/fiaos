// fiaOS weekly review (server). A Sunday-evening look back at the week for Ada, Bea, Cam and the household, plus the week ahead.
// Sources (only real records, never invented): Notion databases the app syncs (Expenses, Bills, Workouts, Food Log, Meal Plan, Uni),
// Apple Health (data/health.json), the chore rotation (chores.js), calendars (integrations.js), bins, F1 (Cam) and podcasts (Bea).
// Anything missing is said to be missing. Optional: one short friendly paragraph from Grok, written only from the computed facts.
// GET  /api/weekly            -> {weeks:[{week,end,final,generatedAt}], latest, preview?}   (index)
// GET  /api/weekly?week=YYYY-MM-DD -> one review (week = its Monday)
// POST /api/weekly/run {week?, preview?}  -> generate now (preview = this week so far, app only, never written to Notion)
// POST /api/weekly/prefs {bins}           -> the app's bin-day settings (so the "week ahead" bins match Settings)
// Auto: every 15 min checks; Sunday from 6 pm the week is finalised and saved to Notion "Weekly Reviews" (one row per person + Household).
// If the Mac was off on Sunday, the last completed week is finalised on the next check. LAN-only; POSTs need X-FiaOS: 1.
'use strict';
const fs = require('fs'), path = require('path');
const notion = require('./notion'), health = require('./health');
const PEOPLE = ['Ada', 'Bea', 'Cam'], NO_UNI = ['Cam'], DATA = process.env.FIAOS_DATA || path.join(__dirname, 'data');
const FILE = path.join(DATA, 'weekly-reviews.json'), KEEP = 52;
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const wr = (f, o) => { try { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1), { mode: 0o600 }); fs.renameSync(f + '.tmp', f) } catch (e) { console.log('weekly: save', e.message) } };
const stamp = () => new Date().toLocaleString('en-AU', { hour12: false });
const ymd = d => d.toLocaleDateString('en-CA');
const addD = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return ymd(d) };
const monday = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x) };
const fmt = s => new Date(s + 'T12:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const money = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
const r1 = n => Math.round(n * 10) / 10;
let DB = rd(FILE, { weeks: {}, prefs: {} }); DB.weeks ??= {}; DB.prefs ??= {};
const save = () => { const ks = Object.keys(DB.weeks).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - KEEP))) delete DB.weeks[k]; wr(FILE, DB) };
let askGrok = null, PORT = 8090, busy = null, preview = null;

// ---- bins (same rule as brief.js: weekly general, recycling every 14 days from an anchor) ----
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dnum = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5 };
const fortnight = (a, s) => !!a && /^\d{4}-\d{2}-\d{2}$/.test(a) && ((((Math.round(dnum(s) - dnum(a))) % 14) + 14) % 14 === 0);
function binsBetween(from, to) {
  const B = { day: 'Monday', recycleAnchor: '2026-10-26', greenAnchor: '', ...(DB.prefs.bins || {}) }, out = [];
  for (let s = from; s <= to; s = addD(s, 1)) { if (WD[new Date(s + 'T12:00').getDay()] !== B.day) continue; const L = ['general']; if (fortnight(B.recycleAnchor, s)) L.push('recycling'); if (fortnight(B.greenAnchor, s)) L.push('green waste'); out.push({ date: s, bins: L }) }
  return out;
}
// ---- helpers ----
const within = (d, a, b) => d && d >= a && d <= b;
async function self(p) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return r.ok ? await r.json() : null } catch { return null } }
async function calendarAhead(p, from, to) {
  try { const integ = require('./integrations'), a = integ.status().people?.[p] || {};
    if (!(a.google?.calendar || a.microsoft || a.calendarVia)) return { events: [], note: 'no calendar connected' };
    const j = await integ.calendar(p);
    const ev = (j.events || []).filter(e => within(String(e.start).slice(0, 10), from, to) && (e.allDay || new Date(e.start) >= Date.now() - 36e5)).map(e => ({ date: String(e.start).slice(0, 10), time: e.allDay ? '' : new Date(e.start).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }), title: e.title }));
    return { events: ev.slice(0, 12), note: (j.errors || []).length && !ev.length ? 'calendar couldn\'t be read' : '' };
  } catch (e) { return { events: [], note: /not connected|no token|connect/i.test(e.message) ? 'no calendar connected' : 'calendar couldn\'t be read' } }
}

// ---- build one week ----
async function build(week, { final }) {
  const end = addD(week, 6), now = new Date(), aheadFrom = final && addD(end, 1) > ymd(now) ? addD(end, 1) : ymd(now), aheadTo = addD(aheadFrom, 6); // a late (catch-up) review looks ahead from today
  const missing = new Set();
  let N = null; try { N = await notion.pull() } catch (e) { missing.add('Notion (' + e.message + ')') }
  let CH = null; try { CH = require('./chores').weekSummary(week) } catch { CH = null }
  const f1 = await self('/api/f1');
  let pod = null; try { pod = await require('./podcasts').get('Bea') } catch { pod = null }
  const people = {};
  for (const p of PEOPLE) {
    const R = { person: p };
    // spending
    if (N) { const ex = N.expenses.filter(e => e.person === p && within(e.date, week, end)), byCat = {};
      ex.forEach(e => byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + (+e.amount || 0));
      const tgt = N.people.find(x => x.name === p);
      R.spend = { total: ex.reduce((a, e) => a + (+e.amount || 0), 0), n: ex.length, byCat, budget: tgt?.budget ?? null, top: ex.sort((a, b) => b.amount - a.amount).slice(0, 3).map(e => ({ desc: e.desc, amount: +e.amount, date: e.date })) } }
    // workouts
    if (N) { const w = N.workouts.filter(x => x.person === p && within(x.date, week, end)); R.workouts = { n: w.length, mins: w.reduce((a, x) => a + (+x.mins || 0), 0), types: [...new Set(w.map(x => x.type))].slice(0, 5) } }
    // health
    const H = health.series(p, 21).filter(d => within(d.date, week, end));
    if (H.length) { const av = k => { const v = H.map(d => d[k]).filter(x => x != null && x !== ''); return v.length ? v.reduce((a, b) => a + +b, 0) / v.length : null };
      R.health = { days: H.length, avgSleep: av('sleepHours') != null ? r1(av('sleepHours')) : null, avgSteps: av('steps') != null ? Math.round(av('steps')) : null, totalSteps: H.reduce((a, d) => a + (+d.steps || 0), 0), exerciseMin: H.reduce((a, d) => a + (+d.exerciseMin || 0), 0) } }
    // study
    if (N && !NO_UNI.includes(p)) { const u = N.uni.filter(x => x.person === p);
      R.study = { finished: u.filter(x => x.type !== 'Exam' && x.pct >= 100 && within(x.due, addD(week, -14), end)).map(x => x.title).slice(0, 6),
        dueThisWeek: u.filter(x => x.type !== 'Exam' && within(x.due, week, end)).map(x => ({ title: x.title, pct: x.pct, due: x.due })).slice(0, 6),
        exams: u.filter(x => x.type === 'Exam' && within(x.due, week, end)).map(x => ({ title: x.title, date: x.due })) } }
    // meals
    if (N) { const fl = N.food.filter(x => x.person === p && within(x.date, week, end)), days = new Set(fl.map(x => x.date));
      const kc = [...days].map(d => fl.filter(x => x.date === d).reduce((a, x) => a + (+x.kcal || 0), 0));
      R.meals = { planned: N.meals.filter(m => m.person === p && m.recipe).length, logged: fl.length, loggedDays: days.size, avgKcal: kc.length ? Math.round(kc.reduce((a, b) => a + b, 0) / kc.length) : null } }
    // chores
    if (CH) R.chores = CH.people[p] || { assigned: 0, done: 0, list: [] };
    // ahead
    const cal = await calendarAhead(p, aheadFrom, aheadTo);
    R.ahead = { from: aheadFrom, to: aheadTo, events: cal.events, calNote: cal.note,
      deadlines: N && !NO_UNI.includes(p) ? N.uni.filter(x => x.person === p && within(x.due, aheadFrom, aheadTo) && (x.type === 'Exam' || x.pct < 100)).map(x => ({ title: x.title, date: x.due, exam: x.type === 'Exam' })) : null };
    if (p === 'Cam') R.ahead.f1 = f1 ? (f1.races || []).flatMap(r => (r.sessions || []).filter(s => s.utc && within(new Date(s.utc).toLocaleDateString('en-CA', { timeZone: 'UTC' }), aheadFrom, aheadTo)).map(s => ({ race: r.name, name: s.name, label: s.label }))) : null;
    if (p === 'Bea') { R.ahead.podcasts = pod ? (pod.episodes || []).filter(e => within(new Date(e.released).toLocaleDateString('en-CA', { timeZone: 'UTC' }), week, end)).map(e => ({ title: e.title, show: e.show, listen: e.listen, date: e.dateLabel })) : null }
    people[p] = R;
  }
  const hh = { person: 'Household' };
  if (N) { hh.billsDue = N.bills.filter(b => within(b.due, week, end)).map(b => ({ name: b.name, amount: b.amount, due: b.due, each: b.amount / 3 }));
    hh.billsAhead = N.bills.filter(b => within(b.due, aheadFrom, aheadTo)).map(b => ({ name: b.name, amount: b.amount, due: b.due, each: b.amount / 3 }));
    hh.spend = { total: PEOPLE.reduce((a, p) => a + (people[p].spend?.total || 0), 0), n: PEOPLE.reduce((a, p) => a + (people[p].spend?.n || 0), 0) };
    hh.workouts = { n: PEOPLE.reduce((a, p) => a + (people[p].workouts?.n || 0), 0), mins: PEOPLE.reduce((a, p) => a + (people[p].workouts?.mins || 0), 0) } }
  if (CH) hh.chores = { assigned: CH.total.assigned, done: CH.total.done, byPerson: Object.fromEntries(PEOPLE.map(p => [p, CH.people[p] ? `${CH.people[p].done}/${CH.people[p].assigned}` : '—'])) };
  hh.bins = binsBetween(aheadFrom, aheadTo);
  hh.ahead = { from: aheadFrom, to: aheadTo };
  const out = { week, end, final: !!final, generatedAt: new Date().toISOString(), sources: { notion: !!N, health: PEOPLE.some(p => people[p].health), chores: !!CH, f1: !!f1, podcasts: !!pod }, missing: [...missing], people, household: hh };
  for (const p of [...PEOPLE, 'Household']) { const R = p === 'Household' ? hh : people[p]; R.lines = lines(R, out); }
  if (askGrok) for (const p of [...PEOPLE, 'Household']) { const R = p === 'Household' ? hh : people[p];
    try { R.summary = await friendly(p, R.lines, out) } catch (e) { R.summary = null; R.summaryError = e.message.slice(0, 120) } }
  return out;
}
// plain-language facts (shared by the app, Notion and Grok). Missing data is named as missing.
function lines(R, W) {
  const L = [], none = (what, why) => L.push({ k: what, t: why, missing: true });
  const p = R.person;
  if (p === 'Household') {
    if (R.spend) L.push({ k: 'Spending', t: R.spend.n ? `${money(R.spend.total)} across ${R.spend.n} expense${R.spend.n > 1 ? 's' : ''} logged by everyone` : 'No expenses were logged this week' }); else none('Spending', 'Expenses unavailable (Notion not reachable)');
    if (R.billsDue) L.push({ k: 'Bills', t: R.billsDue.length ? R.billsDue.map(b => `${b.name} ${money(b.amount)} (${money(b.each)} each, ${fmt(b.due)})`).join(' · ') : 'No bills were due this week' });
    if (R.workouts) L.push({ k: 'Workouts', t: R.workouts.n ? `${R.workouts.n} workout${R.workouts.n > 1 ? 's' : ''}, ${R.workouts.mins} min in total` : 'No workouts were logged' });
    if (R.chores) L.push({ k: 'Chores', t: R.chores.assigned ? `${R.chores.done} of ${R.chores.assigned} rotation chores ticked off (Ada ${R.chores.byPerson.Ada} · Bea ${R.chores.byPerson.Bea} · Cam ${R.chores.byPerson.Cam})` : 'No chores were on the rotation' }); else none('Chores', 'No chore rotation was running that week');
    L.push({ k: 'Bins', t: R.bins.length ? R.bins.map(b => `${fmt(b.date)}: ${b.bins.join(' + ')}`).join(' · ') : 'No bin day in the next 7 days', ahead: true });
    if (R.billsAhead) L.push({ k: 'Bills ahead', t: R.billsAhead.length ? R.billsAhead.map(b => `${b.name} ${money(b.amount)} due ${fmt(b.due)}`).join(' · ') : 'No bills due in the next 7 days', ahead: true });
    return L;
  }
  if (R.spend) L.push({ k: 'Spending', t: R.spend.n ? `${money(R.spend.total)} over ${R.spend.n} expense${R.spend.n > 1 ? 's' : ''}${R.spend.budget ? ` (weekly budget ${money(R.spend.budget)})` : ''}: ${Object.entries(R.spend.byCat).map(([c, v]) => `${c} ${money(v)}`).join(', ')}` : 'No expenses were logged' }); else none('Spending', 'Expenses unavailable (Notion not reachable)');
  if (R.workouts) L.push({ k: 'Workouts', t: R.workouts.n ? `${R.workouts.n} workout${R.workouts.n > 1 ? 's' : ''}, ${R.workouts.mins} min (${R.workouts.types.join(', ')})` : 'No workouts were logged' }); else none('Workouts', 'Workouts unavailable (Notion not reachable)');
  if (R.health) L.push({ k: 'Sleep & steps', t: `${R.health.avgSleep != null ? `${R.health.avgSleep} h sleep on average` : 'no sleep data'} · ${R.health.avgSteps != null ? `${R.health.avgSteps.toLocaleString('en-AU')} steps a day on average` : 'no step data'} (Apple Health, ${R.health.days} of 7 days)` });
  else none('Sleep & steps', 'No Apple Health data arrived this week');
  if (R.study) { const s = R.study, bits = [];
    if (s.finished.length) bits.push(`finished ${s.finished.join(', ')}`);
    if (s.dueThisWeek.length) bits.push(`due: ${s.dueThisWeek.map(x => `${x.title} (${x.pct}%)`).join(', ')}`);
    if (s.exams.length) bits.push(`exams: ${s.exams.map(x => x.title).join(', ')}`);
    L.push({ k: 'Study', t: bits.length ? bits.join(' · ') : 'No uni work was recorded this week' }) } else if (!NO_UNI.includes(p)) none('Study', 'Uni items unavailable (Notion not reachable)');
  if (R.meals) L.push({ k: 'Meals', t: R.meals.logged ? `${R.meals.logged} food log entr${R.meals.logged > 1 ? 'ies' : 'y'} on ${R.meals.loggedDays} day${R.meals.loggedDays > 1 ? 's' : ''}${R.meals.avgKcal ? `, about ${R.meals.avgKcal} kcal on logged days` : ''}` : 'No food was logged' + (R.meals.planned ? ` (${R.meals.planned} meal-plan slots are set)` : '') }); else none('Meals', 'Food log unavailable (Notion not reachable)');
  if (R.chores) L.push({ k: 'Chores', t: R.chores.assigned ? `${R.chores.done} of ${R.chores.assigned} done: ${R.chores.list.map(c => `${c.name}${c.done ? ' ✓' : ''}`).join(', ')}` : 'No rotation chores this week' });
  const A = R.ahead;
  L.push({ k: 'Calendar', t: A.events.length ? A.events.map(e => `${fmt(e.date)}${e.time ? ' ' + e.time : ''} ${e.title}`).join(' · ') : A.calNote ? `Nothing to show (${A.calNote})` : 'Nothing on the calendar', ahead: true, missing: !A.events.length && !!A.calNote });
  if (A.deadlines) L.push({ k: 'Deadlines', t: A.deadlines.length ? A.deadlines.map(d => `${d.exam ? '🎓 ' : ''}${d.title} ${fmt(d.date)}`).join(' · ') : 'No uni deadlines in the next 7 days', ahead: true });
  if (p === 'Cam') L.push({ k: 'F1', t: A.f1 == null ? 'F1 schedule unavailable' : A.f1.length ? `${A.f1[0].race}: ${A.f1.map(s => `${s.name} ${s.label}`).join(' · ')}` : 'No F1 sessions in the next 7 days', ahead: true, missing: A.f1 == null });
  if (p === 'Bea') L.push({ k: 'MrBallen', t: A.podcasts == null ? 'Podcast feed unavailable' : A.podcasts.length ? `${A.podcasts.length} new episode${A.podcasts.length > 1 ? 's' : ''} this week: ${A.podcasts.map(e => e.title).join(', ')}` : 'No new episodes this week', missing: A.podcasts == null });
  return L;
}
async function friendly(p, L, W) {
  const facts = L.map(x => `${x.ahead ? '[week ahead] ' : ''}${x.k}: ${x.t}`).join('\n');
  const sys = `You write the short friendly note at the top of a household weekly review (en-AU, warm, calm, at most one emoji, max 3 sentences, about 50 words). Lead with what actually happened or is coming up; if most things weren't recorded, say so once in a short clause instead of listing each one. Week ${fmt(W.week)}–${fmt(W.end)}. Use ONLY the facts given. Never invent numbers, events or activities. If something wasn't recorded, you may gently say it wasn't recorded, but don't nag. Address ${p === 'Household' ? 'the household (Ada, Bea and Cam)' : p} directly. Reply ONLY with JSON {"paragraph":"..."}.`;
  const t = await askGrok([{ role: 'system', content: sys }, { role: 'user', content: facts.slice(0, 3500) }]);
  const j = JSON.parse(String(t).replace(/^\s*```(?:json)?|```\s*$/g, ''));
  return String(j.paragraph || '').replace(/\s+/g, ' ').trim().slice(0, 700) || null;
}
// ---- Notion: "Weekly Reviews" (one row per person + Household per week) ----
async function toNotion(W) {
  const s = await notion.ensure({ create: true }), db = s.ids.reviews; if (!db) throw new Error('Weekly Reviews database missing');
  const T = x => ({ rich_text: [{ type: 'text', text: { content: String(x).slice(0, 1900) } }] }), out = {};
  for (const p of [...PEOPLE, 'Household']) {
    const R = p === 'Household' ? W.household : W.people[p];
    const props = { Name: { title: [{ type: 'text', text: { content: `${p} · week of ${fmt(W.week)}` } }] }, Week: { date: { start: W.week, end: W.end } }, Person: { select: { name: p } },
      Spent: { number: R.spend ? Math.round(R.spend.total * 100) / 100 : null }, Workouts: { number: R.workouts ? R.workouts.n : null },
      'Avg sleep h': { number: R.health?.avgSleep ?? null }, 'Avg steps': { number: R.health?.avgSteps ?? null },
      'Chores done': T(R.chores ? `${R.chores.done}/${R.chores.assigned}` : '—'), Summary: T(R.summary || R.lines.filter(x => !x.ahead).map(x => `${x.k}: ${x.t}`).join(' · ')) };
    const ex = (await notion.nf(`/databases/${db}/query`, 'POST', { page_size: 5, filter: { and: [{ property: 'Week', date: { equals: W.week } }, { property: 'Person', select: { equals: p } }] } })).results.filter(x => !x.archived)[0];
    const blk = (type, text) => ({ object: 'block', type, [type]: { rich_text: [{ type: 'text', text: { content: String(text).slice(0, 1900) } }] } });
    const children = [...(R.summary ? [blk('callout', R.summary)] : []), blk('heading_3', 'The week'), ...R.lines.filter(x => !x.ahead).map(x => blk('bulleted_list_item', `${x.k}: ${x.t}`)),
      blk('heading_3', `Week ahead (${fmt(R.ahead?.from || W.household.ahead.from)} – ${fmt(R.ahead?.to || W.household.ahead.to)})`), ...R.lines.filter(x => x.ahead).map(x => blk('bulleted_list_item', `${x.k}: ${x.t}`)),
      blk('paragraph', 'Written by fiaOS from what was recorded in fiaOS, Notion and Apple Health. Things that weren\'t recorded are listed as missing.')];
    children.forEach(c => { if (c.type === 'callout') c.callout.icon = { type: 'emoji', emoji: '🗓️' } });
    if (ex) { // re-run of a saved week: refresh the row and replace the text it wrote before (blocks inside its own page only)
      await notion.nf(`/pages/${ex.id}`, 'PATCH', { properties: props });
      for (const b of await notion.children(ex.id)) try { await notion.nf(`/blocks/${b.id}`, 'DELETE') } catch { }
      await notion.nf(`/blocks/${ex.id}/children`, 'PATCH', { children }); out[p] = ex.url; continue }
    const pg = await notion.nf('/pages', 'POST', { parent: { database_id: db }, icon: { type: 'emoji', emoji: p === 'Cam' ? '🏎️' : p === 'Bea' ? '👻' : p === 'Ada' ? '🎵' : '🏠' }, properties: props, children });
    out[p] = pg.url;
  }
  return { urls: out, db: s.urls?.reviews || ('https://www.notion.so/' + db.replace(/-/g, '')) };
}
// ---- run ----
async function run({ week, preview: pv = false, force = false } = {}) {
  if (busy) return busy;
  busy = (async () => {
    const wk = week || (pv ? monday() : null); if (!wk) throw new Error('week needed');
    if (pv) { preview = await build(wk, { final: false }); console.log(`${stamp()} weekly preview ${wk} built`); return preview }
    if (DB.weeks[wk]?.final && !force) return DB.weeks[wk];
    const W = await build(wk, { final: true });
    if (process.env.NOTION_TOKEN) try { W.notion = await toNotion(W) } catch (e) { W.notionError = e.message.slice(0, 200); console.log(`${stamp()} weekly notion error: ${e.message}`) }
    DB.weeks[wk] = W; save(); console.log(`${stamp()} weekly review ${wk} saved${W.notion ? ' + Notion' : ''}`); return W;
  })();
  try { return await busy } finally { busy = null }
}
function due() { // which week (if any) should be finalised now
  const now = new Date(), thisMon = monday(now), lastMon = addD(thisMon, -7);
  if (now.getDay() === 0 && now.getHours() >= 18 && !DB.weeks[thisMon]?.final) return thisMon;
  if (!DB.weeks[lastMon]?.final) return lastMon;
  return null;
}
async function tick() { const w = due(); if (!w) return; try { await run({ week: w }) } catch (e) { console.log(`${stamp()} weekly error: ${e.message}`) } }
function start(o = {}) { askGrok = o.grok || null; PORT = o.port || PORT; setTimeout(tick, 60e3).unref?.(); setInterval(tick, 15 * 60e3).unref?.() }
function index() { return Object.values(DB.weeks).sort((a, b) => b.week.localeCompare(a.week)).map(w => ({ week: w.week, end: w.end, final: w.final, generatedAt: w.generatedAt, notion: w.notion?.urls || null })) }
async function handle(req, res, u, readBody) {
  const send = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(b)) };
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  if (!/^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(req.socket.remoteAddress || '')) return send(403, { error: 'local only' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}') } catch { return {} } };
  try {
    if (u.pathname === '/api/weekly' && req.method === 'GET') { const w = u.searchParams.get('week');
      if (w) { if (w === 'preview') return send(200, preview || { none: true }); return DB.weeks[w] ? send(200, DB.weeks[w]) : send(404, { error: 'no review for that week' }) }
      const idx = index(); return send(200, { weeks: idx, latest: idx[0] ? DB.weeks[idx[0].week] : null, preview: preview ? { week: preview.week, generatedAt: preview.generatedAt } : null, db: rd(path.join(DATA, 'notion.json'), {}).urls?.reviews || null, grok: !!askGrok }) }
    if (u.pathname === '/api/weekly/run' && req.method === 'POST') { const b = await J(); if (b.week && !/^\d{4}-\d{2}-\d{2}$/.test(b.week)) return send(400, { error: 'bad week' });
      const w = b.week ? monday(new Date(b.week + 'T12:00')) : undefined; return send(200, await run({ week: w, preview: !!b.preview || !w, force: !!b.force })) }
    if (u.pathname === '/api/weekly/prefs' && req.method === 'POST') { const b = await J(), B = b.bins || {};
      if (WD.includes(B.day)) { DB.prefs.bins = { day: B.day, recycleAnchor: /^\d{4}-\d{2}-\d{2}$/.test(B.recycleAnchor) ? B.recycleAnchor : '', greenAnchor: /^\d{4}-\d{2}-\d{2}$/.test(B.greenAnchor) ? B.greenAnchor : '' }; save() }
      return send(200, { ok: true }) }
    return send(404, { error: 'not found' });
  } catch (e) { console.log(`${stamp()} weekly ${u.pathname} error: ${e.message}`); return send(500, { error: e.message }) }
}
module.exports = { handle, start, run, build, index, monday, _db: () => DB };
