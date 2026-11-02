// fiaOS → NotebookLM, through Google Drive (server side). NotebookLM (consumer / Workspace) has no public API, but it
// can use Google Docs as sources and re-sync them. So fiaOS keeps a few Google Docs per student up to date in Drive:
//   fiaOS NotebookLM/
//     Demo Science (Ada)/      Study plan & deadlines · Notes from Notion · Flashcard & quiz log (only when there is data)
//     Demo Letters (Bea)/   same
// Docs are created once and then updated IN PLACE (same file id), so a NotebookLM source stays linked; in NotebookLM,
// open the source and tap "Click to sync with Google Drive" to pull the newest version.
// Google scope: drive.file only (fiaOS can see/edit only the files it created). The Drive account is the person's own
// Google connection if it has Drive access, else the shared household account (Ada's).
// GET  /api/nlm/status          -> per person: account, folder + doc links, last sync, errors, whether Drive access exists
// POST /api/nlm/sync  {person?} -> sync now (both students if no person)          (X-FiaOS: 1)
// POST /api/nlm/local {people:{Ada:{assignments,exams}}} -> the app's own uni items (incl. ones not in Notion yet)
// Runs by itself every 6 hours (checked every 10 min), and once soon after Drive access first appears.
// Same LAN-only rule as /api/acct/*. Nothing here deletes anything in Drive or Notion.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const integ = require('./integrations'), notion = require('./notion');
const DATA = process.env.FIAOS_DATA || path.join(__dirname, 'data'), STORE = path.join(DATA, 'notebooklm.json');
const TZ = 'UTC', EVERY = 6 * 36e5, LAN = /^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/;
const PROJECT = String(process.env.GOOGLE_CLIENT_ID || '').split('-')[0];
// who has a notebook (Cam doesn't do uni). `study` = page titles under the person's Notion home that hold study notes.
const BOOKS = {
  Ada: { notebook: 'Demo Science', folder: 'Demo Science (Ada)', lms: 'Canvas', study: [/(^|·\s*)Med\b/i, /(^|·\s*)Notebooks\b/i] },
  Bea: { notebook: 'Demo Letters', folder: 'Demo Letters (Bea)', lms: 'Blackboard', study: [/Demo Seminar/i] },
};
const ROOT = 'fiaOS NotebookLM', SKIP_PAGE = /journal|diary|vault|brain dump|secret|finance|coin|password/i;
const DOCS = { plan: 'Study plan & deadlines', notes: 'Notes from Notion', cards: 'Flashcard & quiz log' };

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
let st = readJson(STORE, {}); st.people ??= {}; st.local ??= {};
const save = () => { try { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); const t = STORE + '.tmp'; fs.writeFileSync(t, JSON.stringify(st, null, 1), { mode: 0o600 }); fs.renameSync(t, STORE) } catch (e) { console.log('nlm: save', e.message) } };
const log = m => console.log(`${new Date().toLocaleString('en-AU', { hour12: false, timeZone: TZ })} notebooklm ${m}`);
const P = p => (st.people[p] ??= { docs: {}, pages: {} });
const when = d => d ? new Date(d).toLocaleString('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const ymd = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const daysTo = s => Math.round((Date.parse(s + 'T00:00:00+00:00') - Date.parse(ymd() + 'T00:00:00+00:00')) / 864e5);
const fmtD = s => s ? new Date(s + 'T12:00:00+00:00').toLocaleDateString('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'no date';
const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------- Google Drive ----------
function account(person) { // whose Google connection writes this person's docs
  if (integ.gHas(person, 'drive')) return person;
  if (integ.gHas(integ.SHARED, 'drive')) return integ.SHARED;
  return null;
}
const emailOf = who => integ._store()[who]?.google?.email || '';
async function gd(who, url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + await integ.gToken(who), ...(opt.headers || {}) } });
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = { raw: t } }
  if (!r.ok) {
    const reason = j.error?.details?.find?.(d => d.reason)?.reason || j.error?.errors?.[0]?.reason || '';
    let msg = j.error?.message || ('HTTP ' + r.status);
    if (reason === 'SERVICE_DISABLED' || /has not been used in project|is disabled/i.test(msg)) msg = `The Google Drive API is switched off for the fiaOS Google Cloud project. Turn it on: https://console.cloud.google.com/apis/library/drive.googleapis.com${PROJECT ? '?project=' + PROJECT : ''} then tap Sync now.`;
    else if (reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' || r.status === 401) msg = 'fiaOS has no Google Drive access yet. Settings → 📓 NotebookLM → "Give fiaOS Drive access" (on the Mac).';
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return j;
}
const GB = process.env.FIAOS_GOOGLE_BASE || 'https://www.googleapis.com'; // override only for offline tests
const DRIVE = GB + '/drive/v3/files', UP = GB + '/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder', GDOC = 'application/vnd.google-apps.document';
async function alive(who, id) { if (!id) return false; try { const f = await gd(who, `${DRIVE}/${id}?fields=id,trashed`); return !f.trashed } catch (e) { if (e.status === 404) return false; throw e } }
async function folder(who, name, parent, known) {
  if (await alive(who, known)) return known;
  const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER}' and trashed = false` + (parent ? ` and '${parent}' in parents` : '');
  const found = (await gd(who, `${DRIVE}?` + new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' }))).files?.[0]; // drive.file: only folders fiaOS made
  if (found) return found.id;
  return (await gd(who, `${DRIVE}?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) })).id;
}
async function createDoc(who, name, parent, html) {
  const b = 'fiaos' + crypto.randomBytes(8).toString('hex');
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: GDOC, parents: [parent], description: 'Kept up to date by fiaOS for NotebookLM. Edits here are overwritten at the next sync.' })}\r\n--${b}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${b}--`;
  return gd(who, `${UP}?uploadType=multipart&fields=id,webViewLink,modifiedTime`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
}
const updateDoc = (who, id, html) => gd(who, `${UP}/${id}?uploadType=media&fields=id,webViewLink,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'text/html; charset=UTF-8' }, body: html });

// ---------- Notion → HTML ----------
const rt = a => (a || []).map(x => { let s = h(x.plain_text); const an = x.annotations || {};
  if (an.code) s = `<code>${s}</code>`; if (an.bold) s = `<b>${s}</b>`; if (an.italic) s = `<i>${s}</i>`; if (an.strikethrough) s = `<s>${s}</s>`;
  if (x.href) s = `<a href="${h(x.href)}">${s}</a>`; return s }).join('');
const plain = a => (a || []).map(x => x.plain_text).join('');
function propText(p) {
  if (!p) return ''; const v = p[p.type];
  switch (p.type) {
    case 'title': case 'rich_text': return plain(v);
    case 'number': return v ?? '';
    case 'select': case 'status': return v?.name || '';
    case 'multi_select': return (v || []).map(x => x.name).join(', ');
    case 'date': return v ? v.start.slice(0, 10) + (v.end ? ' → ' + v.end.slice(0, 10) : '') : '';
    case 'checkbox': return v ? '✓' : '';
    case 'url': case 'email': case 'phone_number': return v || '';
    case 'formula': return v ? String(v[v.type] ?? '') : '';
    case 'rollup': return v?.type === 'number' ? (v.number ?? '') : v?.type === 'array' ? v.array.length + ' items' : '';
    case 'relation': return (v || []).length ? (v.length + ' linked') : '';
    case 'people': return (v || []).map(x => x.name || '').join(', ');
    default: return '';
  }
}
const isHeader = async b => { // the themed page header (image column + title) carries no study content
  if (b.type !== 'column_list') return false;
  for (const col of await notion.children(b.id)) for (const c of await notion.children(col.id)) if (c.type === 'image') return true;
  return false;
};
const NOISE = /How to use this page|Miku Workspace|Open in Vivaldi|Open fiaOS|^\s*FiaOS (Ada|Bea|Cam)\b|MIKU OS ·|初音ミク/i; // theme decoration and page navigation, not study content
async function dbTable(id, title, budget, rowsOut) {
  let rows = [];
  try { rows = (await notion.queryAll(id)).filter(r => !r.archived) } catch (e) { return `<p><i>(${h(title)}: could not read: ${h(e.message)})</i></p>` }
  rowsOut?.push({ db: title, rows });
  if (!rows.length) return `<p><i>${h(title)}: nothing here yet.</i></p>`;
  const names = Object.keys(rows[0].properties).sort((a, b) => (rows[0].properties[b].type === 'title') - (rows[0].properties[a].type === 'title'));
  const used = names.filter(n => rows.some(r => String(propText(r.properties[n])).trim()));
  let out = used.length ? `<table border="1" cellpadding="4"><tr>${used.map(n => `<th>${h(n)}</th>`).join('')}</tr>` : '';
  if (used.length) for (const r of rows.slice(0, 300)) out += `<tr>${used.map(n => `<td>${h(propText(r.properties[n]))}</td>`).join('')}</tr>`;
  if (used.length) out += '</table>';
  for (const r of rows.slice(0, 60)) { // row pages can hold lecture notes etc.
    if (budget.n <= 0) break;
    const kids = await notion.children(r.id).catch(() => []); budget.n--;
    if (kids.length) { const t = plain(Object.values(r.properties).find(p => p.type === 'title')?.title) || 'Untitled'; out += `<h4>${h(title)} · ${h(t)}</h4>` + await blocksHtml(kids, 3, budget, rowsOut) }
  }
  return out;
}
async function blocksHtml(blocks, depth, budget, rowsOut) {
  let out = '', list = null;
  const close = () => { if (list) { out += `</${list}>`; list = null } };
  for (const b of blocks) {
    const t = b.type, v = b[t] || {};
    const li = t === 'bulleted_list_item' ? 'ul' : t === 'numbered_list_item' ? 'ol' : null;
    if (li !== list) { close(); if (li) { out += `<${li}>`; list = li } }
    const kids = async () => b.has_children && depth < 6 && budget.n-- > 0 ? blocksHtml(await notion.children(b.id).catch(() => []), depth + 1, budget, rowsOut) : '';
    if (t === 'paragraph') { const x = rt(v.rich_text); if (x.trim() && !NOISE.test(plain(v.rich_text))) out += `<p>${x}</p>`; out += await kids() }
    else if (/^heading_[123]$/.test(t)) { const n = Math.min(6, +t.slice(-1) + 1); out += `<h${n}>${rt(v.rich_text)}</h${n}>` + await kids() }
    else if (li) out += `<li>${rt(v.rich_text)}${await kids()}</li>`;
    else if (t === 'to_do') out += `<p>${v.checked ? '☑' : '☐'} ${rt(v.rich_text)}</p>` + await kids();
    else if (t === 'toggle') out += `<p><b>${rt(v.rich_text)}</b></p>` + await kids();
    else if (t === 'quote') out += `<blockquote>${rt(v.rich_text)}</blockquote>` + await kids();
    else if (t === 'callout') { if (NOISE.test(plain(v.rich_text))) continue; out += `<p>${v.icon?.emoji || '💡'} ${rt(v.rich_text)}</p>` + await kids() }
    else if (t === 'code') out += `<pre>${h(plain(v.rich_text))}</pre>`;
    else if (t === 'equation') out += `<p>${h(v.expression)}</p>`;
    else if (t === 'bookmark' || t === 'embed' || t === 'link_preview') { if (v.url) out += `<p><a href="${h(v.url)}">${h(plain(v.caption) || v.url)}</a></p>` }
    else if (t === 'table') { const rows = await notion.children(b.id).catch(() => []); out += `<table border="1" cellpadding="4">${rows.map(r => `<tr>${(r.table_row?.cells || []).map(c => `<td>${rt(c)}</td>`).join('')}</tr>`).join('')}</table>` }
    else if (t === 'column_list') { if (depth <= 2 && await isHeader(b)) continue; out += await kids() }
    else if (t === 'column' || t === 'synced_block') out += await kids();
    else if (t === 'child_page') { if (SKIP_PAGE.test(v.title) || depth > 4 || budget.n-- <= 0) continue; out += `<h3>${h(v.title)}</h3>` + await blocksHtml(await notion.children(b.id).catch(() => []), depth + 1, budget, rowsOut) }
    else if (t === 'child_database') { if (budget.n-- <= 0) continue; out += `<h4>${h(v.title || 'Table')}</h4>` + await dbTable(b.id, v.title || 'Table', budget, rowsOut) }
  }
  close(); return out;
}
// the person's study pages: found by title anywhere in the top 3 levels of their Notion home (ids remembered)
async function studyPages(person) {
  const home = notion.state().homes?.[person], cfg = BOOKS[person], s = P(person); if (!home) return [];
  if (s.pages?.home === home && s.pages.list?.length && Date.now() - (s.pages.at || 0) < 24 * 36e5) return s.pages.list;
  const list = [];
  async function scan(id, d) {
    for (const b of await notion.children(id).catch(() => [])) {
      if (b.type === 'child_page') { if (cfg.study.some(re => re.test(b.child_page.title)) && !list.some(x => x.id === b.id)) list.push({ id: b.id, title: b.child_page.title }) }
      else if (b.has_children && d < 3 && ['column_list', 'column', 'toggle', 'callout', 'synced_block'].includes(b.type)) await scan(b.id, d + 1);
    }
  }
  await scan(home, 0);
  s.pages = { home, list, at: Date.now() }; save(); return list;
}

// ---------- document builders ----------
const wrap = (title, person, body) => `<html><head><meta charset="utf-8"><title>${h(title)}</title></head><body>
<h1>${h(title)} · ${h(person)}</h1>
<p><i>Kept up to date by fiaOS for the NotebookLM notebook “${h(BOOKS[person].notebook)}”. Last synced ${h(when(new Date()))} (UTC). Edits made here are replaced at the next sync, so change things in fiaOS or Notion instead.</i></p>
${body}</body></html>`;
const SYNCED_AT = /Last synced [^<]*\(UTC\)/; // ignored when deciding whether a doc changed

async function uniItems(person) { // fiaOS Uni database in Notion + the app's own items not in Notion yet
  const items = [];
  try {
    const s = await notion.ensure();
    for (const r of await notion.queryAll(s.ids.uni, { property: 'Person', select: { equals: person } })) if (!r.archived) { const x = notion.NORM.uni(r); items.push({ ...x, src: 'fiaOS' }) }
  } catch (e) { items.err = 'Notion Uni: ' + e.message }
  const L = st.local[person] || {}, have = new Set(items.map(x => x.nid));
  for (const a of L.assignments || []) if (!a.nid || !have.has(a.nid)) items.push({ type: 'Assignment', title: a.title, course: a.course, due: a.due, pct: a.pct, src: 'fiaOS app' });
  for (const e of L.exams || []) if (!e.nid || !have.has(e.nid)) items.push({ type: 'Exam', title: e.subject, course: e.course || '', due: e.date, src: 'fiaOS app' });
  return items;
}
function planHtml(person, items, extra) {
  const today = ymd(), up = items.filter(x => x.due && x.due >= today).sort((a, b) => a.due.localeCompare(b.due));
  const late = items.filter(x => x.due && x.due < today && x.type !== 'Exam' && (+x.pct || 0) < 100);
  const row = x => `<tr><td>${h(fmtD(x.due))}</td><td>${x.due ? h(daysTo(x.due) + ' d') : ''}</td><td>${h(x.type)}</td><td><b>${h(x.title)}</b></td><td>${h(x.course || '')}</td><td>${x.type === 'Exam' ? '' : h((+x.pct || 0) + '%')}</td></tr>`;
  const head = '<tr><th>Date</th><th>In</th><th>Type</th><th>What</th><th>Course</th><th>Done</th></tr>';
  const blocks = []; for (const e of up.filter(x => x.type === 'Exam')) { const n = daysTo(e.due); if (n > 14) continue; for (let k = Math.min(n, 14); k >= 1; k--) { const d = new Date(Date.parse(e.due + 'T12:00:00+00:00') - k * 864e5); const ds = ymd(d); if (ds < today) continue; blocks.push({ date: ds, title: e.title, hrs: k <= 3 ? 3 : k <= 7 ? 2 : 1 }) } }
  blocks.sort((a, b) => a.date.localeCompare(b.date));
  let b = `<h2>Coming up</h2>${up.length ? `<table border="1" cellpadding="4">${head}${up.map(row).join('')}</table>` : '<p>No upcoming assignments or exams recorded yet.</p>'}`;
  if (late.length) b += `<h2>Overdue or unfinished</h2><table border="1" cellpadding="4">${head}${late.map(row).join('')}</table>`;
  b += `<h2>Planned study blocks (2 weeks before each exam)</h2>${blocks.length ? '<ul>' + blocks.map(x => `<li>${h(fmtD(x.date))}: ${h(x.title)}, ${x.hrs} h</li>`).join('') + '</ul>' : '<p>None yet (they appear when an exam is within 14 days).</p>'}`;
  if (extra) b += extra;
  b += `<h2>From ${h(BOOKS[person].lms)}</h2><p>${h(BOOKS[person].lms)} isn't connected to fiaOS yet. Once it is, its assignments, due dates and announcements appear here automatically.</p>`;
  b += `<h2>Ask NotebookLM</h2><ul><li>Make me a revision timetable from these dates.</li><li>What should I prioritise this week?</li><li>Quiz me on the units with the nearest exams.</li></ul>`;
  if (items.err) b += `<p><i>Note: ${h(items.err)}</i></p>`;
  return b;
}
const CARD_DB = /flash|anki|card|quiz|study log|lectures?/i, CARD_COL = /anki|flash|card|quiz|score|mark|result/i;
function cardsHtml(rowsOut, items) { // only rows that actually say something about flashcards / quizzes / study sessions
  let b = '', n = 0;
  for (const { db, rows } of rowsOut) {
    if (!CARD_DB.test(db) || !rows.length) continue;
    const keep = /lecture/i.test(db) ? rows.filter(r => Object.entries(r.properties).some(([k, p]) => CARD_COL.test(k) && p.type === 'checkbox' && p.checkbox)) : rows;
    if (!keep.length) continue; n += keep.length;
    const names = Object.keys(keep[0].properties).filter(k => keep.some(r => String(propText(r.properties[k])).trim()));
    b += `<h2>${h(db)}</h2><table border="1" cellpadding="4"><tr>${names.map(k => `<th>${h(k)}</th>`).join('')}</tr>${keep.slice(0, 400).map(r => `<tr>${names.map(k => `<td>${h(propText(r.properties[k]))}</td>`).join('')}</tr>`).join('')}</table>`;
  }
  const quizzes = items.filter(x => /quiz|test|flash/i.test(x.title || ''));
  if (quizzes.length) { n += quizzes.length; b += `<h2>Quizzes in fiaOS</h2><ul>${quizzes.map(x => `<li>${h(fmtD(x.due))}: ${h(x.title)}${x.course ? ' (' + h(x.course) + ')' : ''}</li>`).join('')}</ul>` }
  return n ? b : '';
}
async function notesHtml(person, rowsOut) {
  const pages = await studyPages(person), budget = { n: 400 };
  if (!pages.length) return { html: `<p>No study pages found in ${h(person)}'s Notion home yet.</p>`, pages };
  let b = '';
  for (const pg of pages) { b += `<h2>${h(pg.title.replace(/^Miku\s*·\s*/i, ''))}</h2>` + (await blocksHtml(await notion.children(pg.id).catch(() => []), 0, budget, rowsOut) || '<p><i>Empty.</i></p>') }
  return { html: b, pages };
}

// ---------- sync ----------
let busy = null;
async function syncPerson(person) {
  const s = P(person), who = account(person);
  if (!who) throw new Error('No Google Drive access yet');
  const email = emailOf(who);
  if (s.account && s.account !== email) { s.docs = {}; s.folder = null; s.root = null } // a different Drive: start fresh there
  s.account = email; s.via = who;
  const root = st.roots?.[email] ? await folder(who, ROOT, null, st.roots[email]) : await folder(who, ROOT, null, null);
  (st.roots ??= {})[email] = root; s.root = root;
  s.folder = await folder(who, BOOKS[person].folder, root, s.folder);
  const rowsOut = [], items = await uniItems(person), notes = await notesHtml(person, rowsOut);
  const exams = rowsOut.filter(x => /exam|assess/i.test(x.db)).flatMap(x => x.rows);
  const extra = exams.length ? `<h2>Exams & assessments (from Notion)</h2><table border="1" cellpadding="4">${exams.slice(0, 200).map(r => `<tr>${Object.values(r.properties).map(p => `<td>${h(propText(p))}</td>`).join('')}</tr>`).join('')}</table>` : '';
  const want = { plan: planHtml(person, items, extra), notes: notes.html + `<p><i>Pages read: ${h(notes.pages.map(p => p.title).join(', ') || 'none')}.</i></p>` };
  const cards = cardsHtml(rowsOut, items); if (cards || s.docs.cards) want.cards = cards || '<p>No flashcards or quizzes logged right now.</p>';
  const out = { changed: [], same: [] };
  for (const [k, body] of Object.entries(want)) {
    const html = wrap(DOCS[k], person, body), hash = sha(html.replace(SYNCED_AT, '')), d = s.docs[k] || {};
    let f = null;
    if (d.id && d.hash === hash && await alive(who, d.id)) { out.same.push(DOCS[k]); continue }
    if (d.id) try { f = await updateDoc(who, d.id, html) } catch (e) { if (e.status !== 404) throw e }
    if (!f) { f = await createDoc(who, DOCS[k], s.folder, html); d.created = new Date().toISOString() }
    s.docs[k] = { ...d, id: f.id, url: f.webViewLink || `https://docs.google.com/document/d/${f.id}/edit`, hash, updated: new Date().toISOString() };
    out.changed.push(DOCS[k]);
  }
  s.last = new Date().toISOString(); s.error = null; save();
  return out;
}
async function syncAll(people = Object.keys(BOOKS), why = 'manual') {
  if (busy) return busy;
  busy = (async () => {
    const res = {};
    for (const p of people) {
      try { res[p] = await syncPerson(p); log(`${p} (${why}): updated ${res[p].changed.join(', ') || 'nothing'}`) }
      catch (e) { P(p).error = e.message; P(p).errorAt = new Date().toISOString(); save(); res[p] = { error: e.message }; log(`${p} (${why}) error: ${e.message}`) }
    }
    st.lastRun = new Date().toISOString(); save(); return res;
  })();
  try { return await busy } finally { busy = null }
}
function status() {
  const out = { busy: !!busy, lastRun: st.lastRun || null, everyHours: EVERY / 36e5, project: PROJECT, people: {} };
  for (const [p, b] of Object.entries(BOOKS)) {
    const s = P(p), who = account(p);
    out.people[p] = { notebook: b.notebook, folderName: b.folder, lms: b.lms, drive: !!who, via: who, account: who ? emailOf(who) : null, ownGoogle: !!integ._store()[p]?.google,
      folder: s.folder ? `https://drive.google.com/drive/folders/${s.folder}` : null, root: s.root ? `https://drive.google.com/drive/folders/${s.root}` : null,
      docs: Object.entries(s.docs || {}).map(([k, d]) => ({ key: k, name: DOCS[k], url: d.url, updated: d.updated })), last: s.last || null, error: who ? (s.error || null) : null,
      pages: (s.pages?.list || []).map(x => x.title) };
  }
  return out;
}
function setLocal(b) {
  for (const p of Object.keys(BOOKS)) { const L = b?.people?.[p]; if (!L) continue;
    const clip = (a, f) => (Array.isArray(a) ? a : []).slice(0, 300).map(f);
    st.local[p] = { at: new Date().toISOString(),
      assignments: clip(L.assignments, a => ({ nid: String(a.nid || ''), title: String(a.title || '').slice(0, 200), course: String(a.course || '').slice(0, 100), due: String(a.due || '').slice(0, 10), pct: +a.pct || 0 })),
      exams: clip(L.exams, e => ({ nid: String(e.nid || ''), subject: String(e.subject || '').slice(0, 200), course: String(e.course || '').slice(0, 100), date: String(e.date || '').slice(0, 10) })) } }
  save(); return { ok: true };
}
function start() {
  const tick = () => { const ready = Object.keys(BOOKS).filter(p => account(p)); if (!ready.length || busy) return;
    const due = ready.filter(p => !P(p).last || Date.now() - Date.parse(P(p).last) > EVERY - 5 * 60e3);
    if (due.length) syncAll(due, 'auto').catch(() => { }) };
  setTimeout(tick, 60e3).unref?.(); setInterval(tick, 10 * 60e3).unref?.();
}
async function handle(req, res, u, readBody) {
  const send = (code, b) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(b)) };
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  if (!LAN.test(req.socket.remoteAddress || '')) return send(403, { error: 'local only' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}') } catch { return {} } };
  try {
    const r = u.pathname;
    if (r === '/api/nlm/status') return send(200, status());
    if (r === '/api/nlm/sync' && req.method === 'POST') { const b = await J(); const ppl = b.person ? [b.person].filter(p => BOOKS[p]) : Object.keys(BOOKS); if (!ppl.length) throw new Error('unknown person'); const result = await syncAll(ppl, 'Sync now'); return send(200, { result, status: status() }) }
    if (r === '/api/nlm/local' && req.method === 'POST') return send(200, setLocal(await J()));
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message }) }
}
module.exports = { handle, start, syncAll, status, BOOKS, _test: { notesHtml, planHtml, uniItems, cardsHtml, wrap } };
