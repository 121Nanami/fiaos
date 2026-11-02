// FiaNotes / FiaDocs (server). Local replacement for Notion, Obsidian, OneNote, Office and Anki.
// JSON only, under data/fianotes.json (FIAOS_DATA). No npm dependencies. Nothing is uploaded anywhere.
//
// GET  /api/fianotes                      -> library index (folders, note meta, card counts, whether Negi-chan is available)
// GET  /api/fianotes/note?id=             -> one note + rendered html, backlinks, sheet values
// POST /api/fianotes/note                 -> create or update {id?, kind, title, body, folder, tags, person, cells?}
// POST /api/fianotes/delete               -> {id}
// POST /api/fianotes/folder               -> {op:'add'|'rename'|'remove', id?, name?, parent?}
// GET  /api/fianotes/search?q=            -> ranked matches
// GET  /api/fianotes/backlinks?id=
// POST /api/fianotes/render               -> {md} -> {html}   (preview; same renderer as export)
// GET  /api/fianotes/export?id=&fmt=md|html|pdf|csv
// POST /api/fianotes/import               -> {fmt:'md'|'docx'|'csv', name, data, folder?}
// POST /api/fianotes/migrate              -> {board?, notion?, app?, live?, notionFile?}
// POST /api/fianotes/examples/clear
// GET  /api/fianotes/cards                -> {due, later, counts}
// POST /api/fianotes/cards                -> {op:'add'|'addMany'|'grade'|'remove'|'fromNote', ...}
// POST /api/fianotes/ai                   -> {op:'summarise'|'flashcards', id}  (Negi-chan if XAI_API_KEY, else local)
//
// Migration reads the family board (data/notes.json: {notes:[{id,who,text,until,untilLabel,created,src}]})
// and a Notion pull (wiki, journal, recipes, uni, chores, bills, habits, people, expenses, …).
// The board file is never modified. Re-running migration does not duplicate (srcId).
// POSTs need header X-FiaOS: 1. LAN / localhost only, same rule as notes.js.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const DATA = process.env.FIAOS_DATA || path.join(__dirname, 'data');
const FILE = path.join(DATA, 'fianotes.json');
const SEED = path.join(__dirname, 'examples', 'fianotes.seed.json');
const BOARD = path.join(DATA, 'notes.json');
const NOTION_DUMP = path.join(DATA, 'notion-pull.json');
const PEOPLE = ['Ada', 'Bea', 'Cam', 'Everyone'];
const KINDS = ['note', 'doc', 'sheet'];
let grokFn = null;
let DB = null;

const uid = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();
const ymd = d => new Date(d).toLocaleDateString('en-CA');
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function save() {
  try {
    fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB, null, 1), { mode: 0o600 });
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.log('fianotes: save', e.message); }
}
function blank() {
  return { version: 1, example: false, folders: [{ id: 'inbox', name: 'Inbox', parent: null }], notes: [], cards: [], meta: {} };
}
function norm(db) {
  db.version = 1; db.folders ??= []; db.notes ??= []; db.cards ??= []; db.meta ??= {};
  if (!db.folders.some(f => f.id === 'inbox')) db.folders.unshift({ id: 'inbox', name: 'Inbox', parent: null });
  return db;
}
function readSeed() {
  try { return norm(JSON.parse(fs.readFileSync(SEED, 'utf8'))); }
  catch (e) { console.log('fianotes: seed', e.message); return blank(); }
}
function freshFromDisk() {
  try { DB = norm(JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch { DB = readSeed(); }
  return DB;
}
function db() { if (!DB) freshFromDisk(); return DB; }

function folderById(id) { return db().folders.find(f => f.id === id); }
function folderName(id) { return folderById(id)?.name || 'Inbox'; }
function ensureFolder(name, parent) {
  const n = clip(name, 60); if (!n) return folderById('inbox');
  const hit = db().folders.find(f => f.name.toLowerCase() === n.toLowerCase() && (f.parent || null) === (parent || null));
  if (hit) return hit;
  const f = { id: uid(), name: n, parent: parent || null };
  db().folders.push(f); return f;
}
function personOf(p, dflt = 'Everyone') {
  return PEOPLE.find(x => x.toLowerCase() === String(p || '').trim().toLowerCase()) || dflt;
}
function tagsOf(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,#]/);
  return [...new Set(arr.map(t => String(t).replace(/^#/, '').trim().toLowerCase()).filter(t => t && t.length < 40))].slice(0, 24);
}
function noteById(id) { return db().notes.find(n => n.id === id); }

// ---------- markdown (safe HTML; wikilinks resolved against the library) ----------
function titleMap() {
  const m = new Map();
  for (const n of db().notes) {
    m.set(n.id, n.id);
    if (!m.has(n.title.toLowerCase())) m.set(n.title.toLowerCase(), n.id);
  }
  return m;
}
function resolveRef(ref, map) {
  const r = String(ref || '').trim();
  if (!r) return '';
  if (map.has(r)) return map.get(r);
  if (map.has(r.toLowerCase())) return map.get(r.toLowerCase());
  return '';
}
function safeUrl(u) {
  const s = String(u || '').trim();
  if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
  return '';
}
function inline(raw, map) {
  const s = String(raw ?? '');
  const re = /(`[^`]+`)|(\[\[[^\]]+\]\])|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~)/g;
  let last = 0, m, out = '';
  while ((m = re.exec(s))) {
    if (m.index > last) out += esc(s.slice(last, m.index));
    if (m[1]) out += '<code>' + esc(m[1].slice(1, -1)) + '</code>';
    else if (m[2]) {
      const inner = m[2].slice(2, -2);
      const bits = inner.split('|');
      const ref = bits[0].split('#')[0].trim();
      const label = (bits[1] || bits[0]).trim();
      const id = resolveRef(ref, map);
      out += `<a class="fn-wiki" href="#${esc(id || ref)}" data-ref="${esc(ref)}">${esc(label)}</a>`;
    } else if (m[3]) {
      const href = safeUrl(m[5]);
      out += href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(m[4])}</a>` : esc(m[4]);
    } else if (m[6]) {
      const x = m[6];
      if (x.startsWith('***')) out += '<strong><em>' + inline(x.slice(3, -3), map) + '</em></strong>';
      else if (x.startsWith('**')) out += '<strong>' + inline(x.slice(2, -2), map) + '</strong>';
      else if (x.startsWith('*')) out += '<em>' + inline(x.slice(1, -1), map) + '</em>';
      else out += '<del>' + inline(x.slice(2, -2), map) + '</del>';
    }
    last = m.index + m[0].length;
  }
  out += esc(s.slice(last));
  return out;
}
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}
function isSep(line) {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c));
}
function mdToHtml(md, map) {
  map = map || titleMap();
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) i++;
      html += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>';
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) { const lv = h[1].length; html += `<h${lv}>${inline(h[2], map)}</h${lv}>`; i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { html += '<hr>'; i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      html += '<blockquote>' + mdToHtml(buf.join('\n'), map) + '</blockquote>';
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const item = lines[i++].replace(/^\s*[-*]\s+/, '');
        const box = /^\[( |x|X)\]\s+(.*)$/.exec(item);
        buf.push(box
          ? `<li><label><input type="checkbox" disabled ${box[1].toLowerCase() === 'x' ? 'checked' : ''}> ${inline(box[2], map)}</label></li>`
          : `<li>${inline(item, map)}</li>`);
      }
      html += '<ul>' + buf.join('') + '</ul>';
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) buf.push(`<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ''), map)}</li>`);
      html += '<ol>' + buf.join('') + '</ol>';
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const sep = rows.length > 1 && isSep(rows[1]);
      const head = sep ? splitRow(rows[0]) : null;
      const body = (sep ? rows.slice(2) : rows).filter(r => !isSep(r));
      let t = '<table>';
      if (head) t += '<thead><tr>' + head.map(c => `<th>${inline(c, map)}</th>`).join('') + '</tr></thead>';
      t += '<tbody>' + body.map(r => '<tr>' + splitRow(r).map(c => `<td>${inline(c, map)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      html += t;
      continue;
    }
    const buf = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\s*[-*]\s|\s*\d+[.)]\s|\s*>|\s*\|)/.test(lines[i]) && !/^(-{3,}|\*{3,})$/.test(lines[i].trim())) buf.push(lines[i++]);
    html += '<p>' + inline(buf.join(' '), map) + '</p>';
  }
  return html;
}
function wikiRefs(md) {
  const out = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let m; while ((m = re.exec(String(md || '')))) out.push(m[1].trim());
  return out;
}
function backlinksOf(id) {
  const n = noteById(id); if (!n) return [];
  const map = titleMap();
  const hits = [];
  for (const other of db().notes) {
    if (other.id === id) continue;
    const refs = wikiRefs(other.kind === 'sheet' ? '' : other.body);
    if (refs.some(r => resolveRef(r, map) === id || r.toLowerCase() === n.title.toLowerCase() || r === id)) hits.push({ id: other.id, title: other.title, kind: other.kind });
  }
  return hits;
}
function snippet(text, q, n = 140) {
  const s = String(text || '').replace(/[#>*_`\[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const i = q ? s.toLowerCase().indexOf(String(q).toLowerCase()) : 0;
  const from = Math.max(0, (i < 0 ? 0 : i) - 40);
  return (from ? '…' : '') + s.slice(from, from + n) + (from + n < s.length ? '…' : '');
}

// ---------- spreadsheet ----------
function colName(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function parseRef(ref) {
  const m = /^([A-Z]+)([1-9][0-9]*)$/.exec(String(ref || '').toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const c of m[1]) col = col * 26 + (c.charCodeAt(0) - 64);
  const row = +m[2];
  if (col < 1 || col > 100 || row > 500) return null;
  return { col, row };
}
function expandRange(a, b) {
  const A = parseRef(a), B = parseRef(b);
  if (!A || !B) throw new Error('#REF');
  const c1 = Math.min(A.col, B.col), c2 = Math.max(A.col, B.col), r1 = Math.min(A.row, B.row), r2 = Math.max(A.row, B.row);
  if ((c2 - c1 + 1) * (r2 - r1 + 1) > 5000) throw new Error('#REF');
  const out = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(colName(c) + r);
  return out;
}
function tokenize(s) {
  const t = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (s.startsWith('>=', i) || s.startsWith('<=', i) || s.startsWith('<>', i)) { t.push({ k: 'op', v: s.slice(i, i + 2) }); i += 2; continue; }
    if ('+-*/(),:><='.includes(c)) { t.push({ k: 'op', v: c }); i++; continue; }
    if (c === '"') {
      let j = i + 1, str = '';
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\') { str += s[j + 1] || ''; j += 2; continue; } str += s[j++]; }
      if (s[j] !== '"') throw new Error('#ERR');
      t.push({ k: 'str', v: str }); i = j + 1; continue;
    }
    const word = /^[A-Za-z]+/.exec(s.slice(i));
    if (word) {
      i += word[0].length;
      const d = /^\d+/.exec(s.slice(i));
      if (d) { t.push({ k: 'ref', v: (word[0] + d[0]).toUpperCase() }); i += d[0].length; }
      else t.push({ k: 'name', v: word[0].toUpperCase() });
      continue;
    }
    const num = /^(?:\d+\.\d*|\.\d+|\d+)/.exec(s.slice(i));
    if (num) { t.push({ k: 'num', v: +num[0] }); i += num[0].length; continue; }
    throw new Error('#ERR');
  }
  return t;
}
function isNumText(s) { return /^-?(?:\d+\.\d*|\.\d+|\d+)$/.test(String(s).trim()); }
function evalSheet(cells) {
  const raw = {};
  for (const [k, v] of Object.entries(cells || {})) {
    const ref = String(k).toUpperCase();
    if (parseRef(ref)) raw[ref] = v == null ? '' : String(v);
  }
  const cache = new Map(), stack = new Set();
  function valueOf(ref) {
    ref = String(ref).toUpperCase();
    if (cache.has(ref)) return cache.get(ref);
    if (!parseRef(ref)) return { error: '#REF' };
    if (stack.has(ref)) return { error: '#CYCLE' };
    stack.add(ref);
    let result;
    try {
      const src = raw[ref];
      if (src == null || src === '') result = { value: null, type: 'blank' };
      else if (src[0] === '=') result = evalFormula(src.slice(1));
      else if (isNumText(src)) result = { value: +src, type: 'num' };
      else result = { value: src, type: 'str' };
      if (result && result.error) result = { error: result.error };
    } catch (e) { result = { error: String(e.message || '#ERR').startsWith('#') ? e.message : '#ERR' }; }
    stack.delete(ref);
    cache.set(ref, result);
    return result;
  }
  function asNum(v) {
    if (!v || v.error) throw new Error(v?.error || '#ERR');
    if (v.type === 'blank' || v.value == null || v.value === '') return 0;
    if (v.type === 'num') return v.value;
    if (typeof v.value === 'number') return v.value;
    if (typeof v.value === 'string' && isNumText(v.value)) return +v.value;
    throw new Error('#VALUE');
  }
  function collect(args) {
    const nums = [];
    const walk = v => {
      if (!v) return;
      if (v.range) { for (const ref of expandRange(v.range[0], v.range[1])) walk(valueOf(ref)); return; }
      if (v.error) throw new Error(v.error);
      if (v.type === 'num') nums.push(v.value);
      else if (v.type === 'str' && isNumText(v.value)) nums.push(+v.value);
    };
    args.forEach(walk);
    return nums;
  }
  function truthy(v) { if (!v || v.error) return false; if (v.type === 'num') return v.value !== 0; if (v.type === 'blank' || v.value == null || v.value === '') return false; return true; }
    function flat(arg) {
      if (!arg) return [];
      if (arg.range) return expandRange(arg.range[0], arg.range[1]).map(valueOf);
      return [arg];
    }
    function critMatch(cell, crit) {
      const raw = crit && crit.type === 'str' ? String(crit.value) : (crit && crit.type === 'num' ? crit.value : crit);
      const text = cell && cell.value != null ? cell.value : '';
      const m = typeof raw === 'string' ? /^(>=|<=|<>|>|<|=)?(.*)$/.exec(raw) : null;
      if (m && m[1]) {
        const n = +text, c = +m[2];
        if (m[1] === '>') return n > c; if (m[1] === '<') return n < c; if (m[1] === '>=') return n >= c; if (m[1] === '<=') return n <= c;
        if (m[1] === '<>') return String(text) !== m[2]; return String(text) === m[2] || n === c;
      }
      if (typeof raw === 'number') return +text === raw;
      return String(text) === String(raw);
    }
    function dateParts(v) {
      const s = v && v.type === 'str' ? v.value : (typeof v === 'string' ? v : '');
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
      if (!m) throw new Error('#VALUE');
      return { y: +m[1], m: +m[2], d: +m[3] };
    }
    function applyFn(name, args) {
    const AGG = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'];
    if (AGG.includes(name)) {
      const nums = collect(args);
      if (name === 'SUM') return { value: nums.reduce((a, b) => a + b, 0), type: 'num' };
      if (name === 'COUNT') return { value: nums.length, type: 'num' };
      if (name === 'AVERAGE') { if (!nums.length) throw new Error('#DIV/0'); return { value: nums.reduce((a, b) => a + b, 0) / nums.length, type: 'num' }; }
      if (name === 'MIN') return { value: nums.length ? Math.min(...nums) : 0, type: 'num' };
      if (name === 'MAX') return { value: nums.length ? Math.max(...nums) : 0, type: 'num' };
    }
    if (name === 'IF') { if (args.length < 2) throw new Error('#ERR'); return truthy(args[0]) ? args[1] : (args[2] || { value: '', type: 'str' }); }
    if (name === 'COUNTIF') {
      if (!args[0] || !args[0].range) throw new Error('#ERR');
      return { value: flat(args[0]).filter(c => critMatch(c, args[1])).length, type: 'num' };
    }
    if (name === 'LOOKUP' || name === 'VLOOKUP') {
      if (!args[0] || !args[1] || !args[1].range) throw new Error('#ERR');
      const key = args[0].value;
      const [a, b] = args[1].range;
      const A = parseRef(a), B = parseRef(b);
      const c1 = Math.min(A.col, B.col), c2 = Math.max(A.col, B.col), r1 = Math.min(A.row, B.row), r2 = Math.max(A.row, B.row);
      const col = name === 'VLOOKUP' ? Math.max(1, Math.round(asNum(args[2] || { value: c2 - c1 + 1, type: 'num' }))) : (c2 - c1 + 1);
      if (col < 1 || col > c2 - c1 + 1) throw new Error('#REF');
      for (let r = r1; r <= r2; r++) {
        const left = valueOf(colName(c1) + r);
        if (String(left.value) === String(key) || (left.type === 'num' && +key === left.value)) return valueOf(colName(c1 + col - 1) + r);
      }
      throw new Error('#N/A');
    }
    if (name === 'TODAY') { const d = new Date(); return { value: d.toLocaleDateString('en-CA'), type: 'str' }; }
    if (name === 'DATE') {
      const y = Math.round(asNum(args[0])), m = Math.round(asNum(args[1])), d = Math.round(asNum(args[2]));
      if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error('#VALUE');
      return { value: y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), type: 'str' };
    }
    if (name === 'YEAR' || name === 'MONTH' || name === 'DAY') {
      const p = dateParts(args[0]);
      return { value: name === 'YEAR' ? p.y : name === 'MONTH' ? p.m : p.d, type: 'num' };
    }
    throw new Error('#NAME');
  }
  function evalFormula(src) {
    const tokens = tokenize(src); let i = 0;
    const peek = () => tokens[i];
    function parseCmp() {
      let left = parseExpr();
      const cmp = peek() && ['>=', '<=', '<>', '>', '<', '='].includes(peek().v);
      if (!cmp) return left;
      const op = tokens[i++].v, right = parseExpr();
      const av = left && left.value, bv = right && right.value;
      let ok = false;
      if (op === '=' || op === '<>') ok = String(av) === String(bv);
      else { const an = +av, bn = +bv; ok = op === '>' ? an > bn : op === '<' ? an < bn : op === '>=' ? an >= bn : an <= bn; }
      if (op === '<>') ok = !ok;
      return { value: ok ? 1 : 0, type: 'num' };
    }
    function parseExpr() {
      let left = parseTerm();
      while (peek() && (peek().v === '+' || peek().v === '-')) {
        const op = tokens[i++].v, right = parseTerm();
        const a = asNum(left), b = asNum(right);
        left = { value: op === '+' ? a + b : a - b, type: 'num' };
      }
      return left;
    }
    function parseTerm() {
      let left = parseUnary();
      while (peek() && (peek().v === '*' || peek().v === '/')) {
        const op = tokens[i++].v, right = parseUnary();
        const a = asNum(left), b = asNum(right);
        if (op === '/' && b === 0) throw new Error('#DIV/0');
        left = { value: op === '*' ? a * b : a / b, type: 'num' };
      }
      return left;
    }
    function parseUnary() {
      if (peek() && peek().v === '-') { i++; return { value: -asNum(parseUnary()), type: 'num' }; }
      if (peek() && peek().v === '+') { i++; return parseUnary(); }
      return parsePrimary();
    }
    function parsePrimary() {
      const t = peek(); if (!t) throw new Error('#ERR');
      if (t.k === 'num') { i++; return { value: t.v, type: 'num' }; }
      if (t.k === 'str') { i++; return { value: t.v, type: 'str' }; }
      if (t.k === 'ref') { i++; return valueOf(t.v); }
      if (t.k === 'name') {
        i++;
        if (!peek() || peek().v !== '(') throw new Error('#NAME');
        i++;
        const args = [];
        if (!(peek() && peek().v === ')')) {
          while (true) {
            if (peek() && peek().k === 'ref' && tokens[i + 1] && tokens[i + 1].v === ':') {
              const a = tokens[i].v; i += 2;
              if (!peek() || peek().k !== 'ref') throw new Error('#REF');
              const b = tokens[i++].v;
              args.push({ range: [a, b] });
            } else args.push(parseCmp());
            if (peek() && peek().v === ',') { i++; continue; }
            break;
          }
        }
        if (!peek() || peek().v !== ')') throw new Error('#ERR');
        i++;
        return applyFn(t.v, args);
      }
      if (t.v === '(') { i++; const v = parseCmp(); if (!peek() || peek().v !== ')') throw new Error('#ERR'); i++; return v; }
      throw new Error('#ERR');
    }
    const v = parseCmp();
    if (i < tokens.length) throw new Error('#ERR');
    return v;
  }
  const values = {};
  for (const ref of Object.keys(raw)) {
    const r = valueOf(ref);
    values[ref] = r.error ? { error: r.error, raw: raw[ref] } : { value: r.type === 'num' ? roundNum(r.value) : r.value, type: r.type, raw: raw[ref] };
  }
  return values;
}
function roundNum(n) { return Math.round(n * 1e10) / 1e10; }
function colNum(name) { let c = 0; for (const ch of name) c = c * 26 + (ch.charCodeAt(0) - 64); return c; }
function adjustFormula(src, dRow, dCol) {
  if (typeof src !== 'string' || src[0] !== '=') return src;
  return src.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, ca, col, ra, row) => {
    let c = colNum(col), r = +row;
    if (!ca) c += dCol;
    if (!ra) r += dRow;
    if (c < 1 || r < 1) return m;
    return (ca || '') + colName(c) + (ra || '') + r;
  });
}
function remapMoved(src, moves) {
  if (typeof src !== 'string' || src[0] !== '=') return src;
  return src.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, ca, col, ra, row) => {
    const dest = moves.get(col.toUpperCase() + row);
    if (!dest) return m;
    const dm = /^([A-Z]+)(\d+)$/.exec(dest);
    return (ca || '') + dm[1] + (ra || '') + dm[2];
  });
}
function sortRange(cells, a, b, keyCol = 0, dir = 'asc') {
  const values = evalSheet(cells);
  const A = parseRef(a), B = parseRef(b);
  if (!A || !B) throw new Error('#REF');
  const c1 = Math.min(A.col, B.col), c2 = Math.max(A.col, B.col), r1 = Math.min(A.row, B.row), r2 = Math.max(A.row, B.row);
  const span = c2 - c1;
  const indexed = [];
  for (let r = r1; r <= r2; r++) {
    const raw = [];
    for (let c = c1; c <= c2; c++) raw.push(cells[colName(c) + r] || '');
    const keyRef = colName(c1 + Math.max(0, Math.min(keyCol, span))) + r;
    const key = values[keyRef] && values[keyRef].value != null ? values[keyRef].value : raw[Math.max(0, Math.min(keyCol, span))];
    indexed.push({ r, raw, key });
  }
  indexed.sort((x, y) => { const n = String(x.key).localeCompare(String(y.key), undefined, { numeric: true }); return dir === 'desc' ? -n : n; });
  const moves = new Map();
  indexed.forEach((row, i) => { for (let c = c1; c <= c2; c++) moves.set(colName(c) + row.r, colName(c) + (r1 + i)); });
  const inside = ref => { const p = parseRef(ref); return p && p.col >= c1 && p.col <= c2 && p.row >= r1 && p.row <= r2; };
  const next = {};
  for (const [ref, raw] of Object.entries(cells)) if (!inside(ref)) next[ref] = remapMoved(raw, moves);
  indexed.forEach((row, i) => {
    const dRow = (r1 + i) - row.r;
    row.raw.forEach((raw, j) => { const out = adjustFormula(raw, dRow, 0); if (out !== '') next[colName(c1 + j) + (r1 + i)] = out; });
  });
  return next;
}
function xmlText(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).slice(0, 12); }
function chartFrom(cells, a, b, kind = 'bar') {
  const values = evalSheet(cells);
  const A = parseRef(a), B = parseRef(b);
  if (!A || !B) throw new Error('#REF');
  const c1 = Math.min(A.col, B.col), c2 = Math.max(A.col, B.col), r1 = Math.min(A.row, B.row), r2 = Math.max(A.row, B.row);
  const labels = [], xs = [], ys = [];
  for (let r = r1; r <= r2; r++) {
    const left = values[colName(c1) + r], right = c2 > c1 ? values[colName(c2) + r] : left;
    const n = right && right.type === 'num' ? right.value : (left && left.type === 'num' ? left.value : null);
    if (n == null || !isFinite(n)) continue;
    labels.push(c2 > c1 && left && left.type !== 'num' ? String(left.value) : String(r));
    xs.push(left && left.type === 'num' ? left.value : ys.length);
    ys.push(n);
  }
  if (!ys.length) throw new Error('nothing to chart');
  const w = Math.max(180, ys.length * 48 + 24), h = 180;
  if (kind === 'line') {
    const max = Math.max(...ys, 1);
    const pts = ys.map((v, i) => `${20 + i * ((w - 40) / Math.max(1, ys.length - 1))},${30 + (1 - v / max) * 110}`).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="#39C5BB" stroke-width="2"/></svg>`;
  }
  if (kind === 'scatter') {
    const maxX = Math.max(...xs, 1), maxY = Math.max(...ys, 1);
    const dots = ys.map((v, i) => `<circle cx="${20 + (xs[i] / maxX) * (w - 40)}" cy="${30 + (1 - v / maxY) * 110}" r="4" fill="#E12885"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${dots}</svg>`;
  }
  if (kind === 'pie') {
    const sum = ys.reduce((n, v) => n + Math.max(0, v), 0) || 1;
    if (ys.length === 1) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180"><circle cx="90" cy="90" r="60" fill="#39C5BB"/></svg>`;
    let ang = -Math.PI / 2; const parts = [];
    ys.forEach((v, i) => {
      const slice = Math.max(0, v) / sum * Math.PI * 2;
      const x1 = 90 + Math.cos(ang) * 60, y1 = 90 + Math.sin(ang) * 60;
      ang += slice;
      const x2 = 90 + Math.cos(ang) * 60, y2 = 90 + Math.sin(ang) * 60;
      const large = slice > Math.PI ? 1 : 0;
      const color = ['#39C5BB', '#E12885', '#F4D35E', '#86CECB', '#FF8000'][i % 5];
      parts.push(`<path d="M 90 90 L ${x1} ${y1} A 60 60 0 ${large} 1 ${x2} ${y2} Z" fill="${color}"/>`);
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">${parts.join('')}</svg>`;
  }
  const max = Math.max(...ys, 1);
  const bars = ys.map((v, i) => `<rect x="${12 + i * 48}" y="${20 + (1 - v / max) * 100}" width="32" height="${Math.max(1, v / max * 100)}" fill="#39C5BB"/>`).join('');
  const texts = labels.map((lb, i) => `<text x="${28 + i * 48}" y="150" text-anchor="middle" font-size="11" fill="#9fb3bd">${xmlText(lb)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${bars}${texts}</svg>`;
}
function fmtVal(v) {
  if (!v) return '';
  if (v.error) return v.error;
  if (v.value == null || v.type === 'blank') return '';
  return String(v.value);
}
function sheetCsv(note) {
  const cells = note.cells || {}, values = evalSheet(cells);
  let maxC = 1, maxR = 1;
  for (const ref of Object.keys(cells)) { const p = parseRef(ref); if (p) { maxC = Math.max(maxC, p.col); maxR = Math.max(maxR, p.row); } }
  const rows = [];
  for (let r = 1; r <= maxR; r++) {
    const row = [];
    for (let c = 1; c <= maxC; c++) {
      const ref = colName(c) + r;
      const raw = cells[ref] ?? '';
      row.push(raw);
    }
    rows.push(row);
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n';
}
function csvCell(s) {
  s = String(s ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}
function cellsFromCsv(text) {
  const rows = parseCsv(text), cells = {};
  rows.forEach((row, ri) => row.forEach((val, ci) => {
    if (ri > 498 || ci > 99) return;
    if (val !== '') cells[colName(ci + 1) + (ri + 1)] = String(val).slice(0, 500);
  }));
  return cells;
}

// ---------- flashcards (SM-2) ----------
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return dt.toLocaleDateString('en-CA');
}
function sm2(card, q, now = new Date()) {
  q = Math.max(0, Math.min(5, Math.round(+q)));
  let ease = +card.ease || 2.5, interval = +card.interval || 0, reps = +card.reps || 0, lapses = +card.lapses || 0;
  if (q < 3) { reps = 0; interval = 1; lapses += 1; }
  else {
    if (reps <= 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.max(1, Math.round(interval * ease));
    reps += 1;
  }
  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ease < 1.3) ease = 1.3;
  const today = ymd(now);
  return { ease: Math.round(ease * 100) / 100, interval, reps, lapses, due: addDays(today, interval), last: today, q };
}
function previewGrades(card, now = new Date()) {
  const out = {};
  for (const q of [1, 3, 4, 5]) out[q] = sm2(card, q, now).interval + 'd';
  return out;
}
function cardsFromBody(body) {
  const text = String(body || ''), out = [];
  const seen = new Set();
  const push = (front, back) => {
    front = clip(front, 240); back = clip(back, 600);
    if (!front || !back) return;
    const k = front.toLowerCase(); if (seen.has(k)) return; seen.add(k);
    out.push({ front, back });
  };
  for (const line of text.split('\n')) {
    const m = /^\s*(.+?)\s+::\s+(.+?)\s*$/.exec(line);
    if (m) push(m[1], m[2]);
    const cloze = [...line.matchAll(/\{\{(.+?)\}\}/g)];
    if (cloze.length) push(line.replace(/\{\{.+?\}\}/g, '_____').trim(), cloze.map(c => c[1].trim()).join(', '));
  }
  const qa = /^Q:\s*(.+)\n+A:\s*([\s\S]+?)(?=\n\s*Q:|\n#{1,3} |$)/gim;
  let m; while ((m = qa.exec(text))) push(m[1], m[2]);
  if (!out.length) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const h = /^#{1,3}\s+(.+)$/.exec(lines[i]);
      if (!h) continue;
      const buf = [];
      for (let j = i + 1; j < lines.length && !/^#{1,3}\s+/.test(lines[j]); j++) if (lines[j].trim()) buf.push(lines[j].trim());
      if (buf.length) push(h[1], buf.slice(0, 4).join(' '));
    }
  }
  return out.slice(0, 40);
}
function addCard(b) {
  const note = b.noteId ? noteById(b.noteId) : null;
  const front = clip(b.front, 240), back = clip(b.back, 600);
  if (!front || !back) throw new Error('front and back needed');
  const key = front.toLowerCase();
  const ex = db().cards.find(c => c.noteId === (note?.id || b.noteId || '') && c.front.toLowerCase() === key);
  if (ex) return ex;
  const today = ymd(new Date());
  const c = {
    id: uid(), noteId: note?.id || '', front, back, tags: tagsOf(b.tags || note?.tags || []),
    ease: 2.5, interval: 0, reps: 0, lapses: 0, due: today, created: nowIso(), example: false
  };
  db().cards.push(c); return c;
}
function dueCards(now = new Date(), ahead = false) {
  const today = ymd(now);
  const all = db().cards.map(c => ({ ...c, preview: previewGrades(c, now) }));
  const due = all.filter(c => c.due <= today).sort((a, b) => a.due.localeCompare(b.due) || a.front.localeCompare(b.front));
  const later = all.filter(c => c.due > today).sort((a, b) => a.due.localeCompare(b.due));
  return { due: ahead ? [...due, ...later] : due, later, counts: { due: due.length, later: later.length, total: all.length } };
}

// ---------- pdf (plain text, Helvetica, print-to-PDF is the rich path) ----------
function pdfStr(s) {
  let o = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c === 0x5c || c === 0x28 || c === 0x29) o += '\\' + ch;
    else if (c >= 32 && c <= 126) o += ch;
    else if (c >= 160 && c <= 255) o += '\\' + c.toString(8).padStart(3, '0');
    else if (ch === '\t') o += '    ';
    else o += '?';
  }
  return '(' + o + ')';
}
function wrapText(text, width = 85) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const next = line ? line + ' ' + word : word;
      if (next.length > width && line) { out.push(line); line = word; }
      else line = next;
      while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
    }
    if (line) out.push(line);
  }
  return out;
}
function mdToText(md) {
  return String(md || '')
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, a, b) => (b || a).trim())
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,3}\s+/gm, '')
    .replace(/[*_~`>]/g, '');
}
function toPdf(title, text) {
  const pageH = 842, pageW = 595, margin = 54, leading = 14, size = 11, per = Math.floor((pageH - margin * 2) / leading);
  const lines = [title, ''].concat(wrapText(text));
  const pages = [];
  for (let i = 0; i < lines.length; i += per) pages.push(lines.slice(i, i + per));
  if (!pages.length) pages.push(['']);
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const kids = []; let next = 4;
  for (const chunk of pages) {
    const pageId = next++, contentId = next++;
    kids.push(pageId + ' 0 R');
    const cmds = ['BT', `/F1 ${size} Tf`, `${leading} TL`, `1 0 0 1 ${margin} ${pageH - margin} Tm`];
    chunk.forEach((ln, idx) => { if (idx) cmds.push('T*'); cmds.push(pdfStr(ln) + ' Tj'); });
    cmds.push('ET');
    const stream = cmds.join('\n');
    objs[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
  }
  objs[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < next; id++) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let id = 1; id < next; id++) out += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'binary');
}
function htmlDoc(title, body) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:16px "Segoe UI",system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#14202b;line-height:1.5}
h1,h2,h3{line-height:1.25}code,pre{font-family:ui-monospace,Menlo,monospace;background:#f4f7f8}pre{padding:12px;overflow:auto}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}
blockquote{border-left:3px solid #39C5BB;margin-left:0;padding-left:12px;color:#333}
a{color:#0b6e75}.meta{color:#555;font-size:13px}
@media print{body{margin:12px;max-width:none}a{color:#000;text-decoration:none}}
</style></head><body>${body}<p class="meta">FiaNotes · print this page and choose “Save as PDF” for a formatted copy.</p></body></html>`;
}

// ---------- docx (zip + word/document.xml, no dependencies) ----------
function unzip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('bad zip local header');
    const ln = buf.readUInt16LE(localOff + 26), le = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + ln + le;
    const data = buf.slice(start, start + compSize);
    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = zlib.inflateRawSync(data);
    else throw new Error('unsupported zip compression ' + method);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
function decodeXml(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
}
function paraToMd(p) {
  const style = (/<w:pStyle[^>]*w:val="([^"]+)"/i.exec(p) || [])[1] || '';
  let text = '';
  const runs = p.match(/<w:r\b[\s\S]*?<\/w:r>/g) || [];
  for (const r of runs) {
    if (/<w:br\b/.test(r)) text += '\n';
    if (/<w:tab\b/.test(r)) text += '  ';
    let t = [...r.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => decodeXml(m[1])).join('');
    if (!t) continue;
    const bold = /<w:b(?:\s[^>]*w:val="(?:1|true|on)"|\/?>)/i.test(r) && !/<w:b[^>]*w:val="(?:0|false|off)"/i.test(r);
    const ital = /<w:i(?:\s[^>]*w:val="(?:1|true|on)"|\/?>)/i.test(r) && !/<w:i[^>]*w:val="(?:0|false|off)"/i.test(r);
    if (bold && ital) t = '***' + t + '***';
    else if (bold) t = '**' + t + '**';
    else if (ital) t = '*' + t + '*';
    text += t;
  }
  text = text.replace(/[ \t]+\n/g, '\n').trim();
  if (!text) return '';
  if (/^(heading1|title)$/i.test(style)) return '# ' + text;
  if (/^heading2$/i.test(style)) return '## ' + text;
  if (/^(heading3|subtitle)$/i.test(style)) return '### ' + text;
  if (/<w:numPr\b/.test(p)) return '- ' + text.replace(/\n/g, ' ');
  return text;
}
function tableToMd(tbl) {
  const rows = tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  const grid = rows.map(row => (row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map(cell => {
    const paras = cell.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    return paras.map(paraToMd).filter(Boolean).join(' ').replace(/\|/g, '\\|') || ' ';
  }));
  if (!grid.length) return '';
  const width = Math.max(...grid.map(r => r.length));
  const norm = grid.map(r => { while (r.length < width) r.push(' '); return r; });
  const head = '| ' + norm[0].join(' | ') + ' |';
  const sep = '| ' + norm[0].map(() => '---').join(' | ') + ' |';
  const body = norm.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}
function docxToMd(xml) {
  const tables = [];
  let left = String(xml).replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, m => { tables.push(tableToMd(m)); return `\n@@TBL${tables.length - 1}@@\n`; });
  const parts = left.split(/(<w:p\b[\s\S]*?<\/w:p>|@@TBL\d+@@)/);
  const out = [];
  for (const part of parts) {
    if (!part) continue;
    const tm = /^@@TBL(\d+)@@$/.exec(part);
    if (tm) { out.push(tables[+tm[1]] || ''); continue; }
    if (part.startsWith('<w:p')) { const line = paraToMd(part); if (line) out.push(line); }
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
function importDocx(buf) {
  const files = unzip(buf);
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('This .docx has no word/document.xml');
  return docxToMd(xml.toString('utf8'));
}

// ---------- notion block bodies (live migration) ----------
function richToMd(arr) {
  return (arr || []).map(t => {
    let s = t.plain_text || '';
    if (!s) return '';
    if (t.annotations?.code) s = '`' + s + '`';
    if (t.annotations?.bold && t.annotations?.italic) s = '***' + s + '***';
    else if (t.annotations?.bold) s = '**' + s + '**';
    else if (t.annotations?.italic) s = '*' + s + '*';
    if (t.href && safeUrl(t.href)) s = `[${s}](${t.href})`;
    return s;
  }).join('');
}
function blocksToMd(blocks) {
  const lines = [];
  for (const b of blocks || []) {
    const t = b.type, data = b[t] || {}, text = richToMd(data.rich_text || data.text);
    if (t === 'heading_1') lines.push('# ' + text);
    else if (t === 'heading_2') lines.push('## ' + text);
    else if (t === 'heading_3') lines.push('### ' + text);
    else if (t === 'bulleted_list_item') lines.push('- ' + text);
    else if (t === 'numbered_list_item') lines.push('1. ' + text);
    else if (t === 'to_do') lines.push(`- [${data.checked ? 'x' : ' '}] ` + text);
    else if (t === 'quote') lines.push('> ' + text);
    else if (t === 'code') lines.push('```' + (data.language || '') + '\n' + text + '\n```');
    else if (t === 'divider') lines.push('---');
    else if (t === 'paragraph') lines.push(text);
    else if (text) lines.push(text);
    if (b.children) lines.push(blocksToMd(b.children));
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function normaliseJournal(r) {
  const p = r.properties || {};
  const plain = a => (a || []).map(x => x.plain_text || '').join('');
  return {
    nid: r.id,
    title: plain(p.Name?.title) || 'Journal',
    date: p.Date?.date?.start?.slice(0, 10) || '',
    person: p.Person?.select?.name || '',
    brief: plain(p.Brief?.rich_text),
    mood: p.Mood?.select?.name || '',
    edited: r.last_edited_time || ''
  };
}

// ---------- library mutations ----------
function indexNote(n) {
  const text = n.kind === 'sheet' ? Object.values(n.cells || {}).join(' ') : n.body;
  return {
    id: n.id, title: n.title, kind: n.kind, folder: n.folder, tags: n.tags || [], person: n.person,
    updated: n.updated, created: n.created, example: !!n.example, src: n.src || '', snippet: snippet(text, '', 160)
  };
}
function publicIndex() {
  const d = db();
  const today = ymd(new Date());
  return {
    example: !!d.example,
    folders: d.folders,
    notes: d.notes.map(indexNote).sort((a, b) => (b.updated || '').localeCompare(a.updated || '')),
    cards: d.cards.map(c => ({ ...c, preview: previewGrades(c) })),
    counts: { notes: d.notes.length, due: d.cards.filter(c => c.due <= today).length, cards: d.cards.length },
    meta: d.meta || {},
    ai: !!grokFn
  };
}
function noteView(n) {
  if (!n) return null;
  const map = titleMap();
  const html = n.kind === 'sheet' ? '' : mdToHtml(n.body || '', map);
  const values = n.kind === 'sheet' ? evalSheet(n.cells || {}) : null;
  return { note: n, html, backlinks: backlinksOf(n.id), values };
}
function cleanCells(obj) {
  const cells = {};
  if (!obj || typeof obj !== 'object') return cells;
  for (const [k, v] of Object.entries(obj)) {
    const ref = String(k).toUpperCase();
    if (!parseRef(ref)) continue;
    const s = String(v ?? '').slice(0, 500);
    if (s !== '') cells[ref] = s;
    if (Object.keys(cells).length >= 2000) break;
  }
  return cells;
}
function upsertNote(b) {
  db();
  const prev = b.id ? noteById(b.id) : null;
  if (b.id && !prev) throw new Error('note not found');
  const kind = KINDS.includes(b.kind) ? b.kind : (prev?.kind || 'note');
  const title = clip(b.title ?? prev?.title, 140) || 'Untitled';
  const body = String(b.body ?? prev?.body ?? '').slice(0, 200000);
  const tags = b.tags == null && prev ? prev.tags : tagsOf(b.tags);
  const person = personOf(b.person ?? prev?.person, 'Everyone');
  const folder = folderById(b.folder || prev?.folder || 'inbox') ? (b.folder || prev?.folder || 'inbox') : 'inbox';
  const cells = b.cells ? cleanCells(b.cells) : (prev?.cells || {});
  const changed = !prev || title !== prev.title || body !== (prev.body || '') || JSON.stringify(cells) !== JSON.stringify(prev.cells || {}) || folder !== prev.folder || person !== prev.person || JSON.stringify(tags) !== JSON.stringify(prev.tags || []);
  const note = prev || { id: uid(), created: nowIso(), src: 'app', example: false };
  Object.assign(note, { kind, title, body, tags, person, folder, cells, updated: changed ? nowIso() : (prev.updated || nowIso()) });
  if (changed && prev?.example) note.example = false;
  if (!prev) db().notes.push(note);
  if (db().notes.every(n => !n.example) && db().cards.every(c => !c.example)) db().example = false;
  save();
  return noteView(note);
}
function deleteNote(id) {
  const d = db();
  const n = noteById(id); if (!n) throw new Error('note not found');
  d.notes = d.notes.filter(x => x.id !== id);
  d.cards = d.cards.filter(c => c.noteId !== id);
  save();
  return { ok: true };
}
function folderOp(b) {
  const d = db();
  if (b.op === 'add') {
    const name = clip(b.name, 60); if (!name) throw new Error('name needed');
    const parent = b.parent && folderById(b.parent) ? b.parent : null;
    const f = ensureFolder(name, parent); save(); return f;
  }
  const f = folderById(b.id); if (!f || f.id === 'inbox') throw new Error('folder not found');
  if (b.op === 'rename') { const name = clip(b.name, 60); if (!name) throw new Error('name needed'); f.name = name; save(); return f; }
  if (b.op === 'remove') {
    const ids = new Set([f.id]);
    let grew = true;
    while (grew) { grew = false; for (const x of d.folders) if (x.parent && ids.has(x.parent) && !ids.has(x.id)) { ids.add(x.id); grew = true; } }
    d.notes.forEach(n => { if (ids.has(n.folder)) n.folder = 'inbox'; });
    d.folders = d.folders.filter(x => !ids.has(x.id));
    save(); return { ok: true };
  }
  throw new Error('bad op');
}
function search(q) {
  const terms = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const n of db().notes) {
    const folder = folderName(n.folder);
    const hay = [n.title, n.kind === 'sheet' ? Object.values(n.cells || {}).join('\n') : n.body, (n.tags || []).join(' '), n.person, folder].join('\n').toLowerCase();
    if (!terms.every(t => hay.includes(t))) continue;
    let score = 0;
    const title = n.title.toLowerCase();
    if (title === terms.join(' ')) score += 8;
    if (terms.every(t => title.includes(t))) score += 4;
    if ((n.tags || []).some(t => terms.some(q => t.includes(q)))) score += 2;
    hits.push({ ...indexNote(n), score, snippet: snippet(n.kind === 'sheet' ? Object.values(n.cells || {}).join(' ') : n.body, terms[0]) });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 50);
}

// ---------- migration ----------
function counts() { return { added: 0, updated: 0, kept: 0 }; }
function bump(c, how) { if (how === 'added') c.added++; else if (how === 'updated') c.updated++; else c.kept++; }
function upsertBySrc(srcId, fields, c) {
  const ex = db().notes.find(n => n.srcId === srcId);
  if (!ex) {
    db().notes.push({ id: uid(), created: nowIso(), updated: nowIso(), example: false, cells: {}, ...fields, srcId });
    bump(c, 'added'); return;
  }
  const nextBody = fields.body ?? '';
  const richer = nextBody && nextBody.length > (ex.body || '').length + 8;
  if (richer || (fields.body && fields.body !== ex.body && ex.src === 'seed')) {
    ex.body = fields.body; ex.updated = nowIso(); if (fields.title) ex.title = fields.title; bump(c, 'updated');
  } else bump(c, 'kept');
}
function migrateBoard(raw, c = counts()) {
  const notes = Array.isArray(raw) ? raw : (raw?.notes || []);
  const folder = ensureFolder('Message board');
  for (const x of notes) {
    const text = clip(x.text, 500); if (!text) continue;
    const id = String(x.id || '').trim() || text.slice(0, 24);
    const who = personOf(x.who, 'Everyone');
    const body = [text, '', who ? `From **${who}**.` : '', x.untilLabel ? `Shown ${x.untilLabel}.` : '', x.until ? `Expires ${x.until}.` : '', x.src ? `Source: ${x.src}.` : '', '', '_Imported from the family message board (notes.json). The board itself is unchanged._'].filter(Boolean).join('\n');
    upsertBySrc('board:' + id, {
      kind: 'note', title: clip(text, 72) || 'Board note', body, folder: folder.id,
      tags: tagsOf(['board', who]), person: who, src: 'board', created: x.created || nowIso()
    }, c);
  }
  return c;
}
function migrateBoardFile() {
  let raw; try { raw = JSON.parse(fs.readFileSync(BOARD, 'utf8')); } catch { return counts(); }
  const c = migrateBoard(raw); if (c.added || c.updated) save(); return c;
}
function recipeBody(r) {
  const ing = Object.entries(r.ing || {}).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return [`**${r.kcal || 0} kcal** · protein ${r.p || 0}g · carbs ${r.c || 0}g · fat ${r.f || 0}g`, ing ? '\n## Ingredients\n' + ing : ''].join('\n').trim();
}
function digest(title, headers, rows) {
  if (!rows.length) return '';
  const head = '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n';
  return '# ' + title + '\n\n' + head + rows.map(r => '| ' + r.map(c => String(c ?? '').replace(/\|/g, '/')).join(' | ') + ' |').join('\n') + '\n';
}
function migrateNotion(pull, c = counts()) {
  if (!pull || typeof pull !== 'object') return c;
  const bodies = pull.wikiBodies || {};
  for (const w of pull.wiki || []) {
    if (!w || !(w.title || w.nid)) continue;
    const nid = w.nid || w.title;
    const body = bodies[w.nid] || [w.category ? `Category: **${w.category}**.` : '', w.url ? `Notion page: ${w.url}` : '', '', '_Wiki row migrated from Notion. The page body is filled in when Notion is connected, or when a pull includes wikiBodies._'].filter(Boolean).join('\n');
    upsertBySrc('notion:wiki:' + nid, {
      kind: 'doc', title: w.title || 'Wiki page', body, folder: ensureFolder('Household wiki').id,
      tags: tagsOf(['wiki', w.category || '']), person: 'Everyone', src: 'notion'
    }, c);
  }
  for (const j of pull.journal || []) {
    const nid = j.nid || (j.person || '') + (j.date || '');
    if (!nid || !(j.brief || j.title)) continue;
    upsertBySrc('notion:journal:' + nid, {
      kind: 'note', title: j.title || `${j.person || 'Journal'} · ${j.date || ''}`.trim(),
      body: [j.brief || '', j.mood ? `\nMood: ${j.mood}` : '', j.date ? `\nDate: ${j.date}` : ''].join('').trim(),
      folder: ensureFolder('Journal').id, tags: tagsOf(['journal', j.person || '']), person: personOf(j.person, 'Everyone'), src: 'notion'
    }, c);
  }
  for (const r of pull.recipes || []) {
    if (!r || !r.name) continue;
    upsertBySrc('notion:recipe:' + (r.nid || r.name), {
      kind: 'note', title: r.name, body: recipeBody(r), folder: ensureFolder('Recipes').id,
      tags: tagsOf(['recipe', ...(r.tags || [])]), person: 'Everyone', src: 'notion'
    }, c);
  }
  for (const u of pull.uni || []) {
    const title = u.title || u.subject; if (!title) continue;
    const exam = u.type === 'Exam';
    upsertBySrc('notion:uni:' + (u.nid || title), {
      kind: 'note', title, person: personOf(u.person, 'Bea'), folder: ensureFolder('Uni').id,
      tags: tagsOf(['uni', exam ? 'exam' : 'assignment', u.course || '']), src: 'notion',
      body: [`**${exam ? 'Exam' : 'Assignment'}** for ${u.person || 'someone'}`, u.course ? `Course: ${u.course}` : '', (u.due || u.date) ? `Date: ${u.due || u.date}` : '', u.pct != null && !exam ? `Progress: ${u.pct}%` : ''].filter(Boolean).join('\n')
    }, c);
  }
  for (const ch of pull.chores || []) {
    if (!ch?.name) continue;
    upsertBySrc('notion:chore:' + (ch.nid || ch.name), {
      kind: 'note', title: ch.name, person: personOf(ch.person, 'Everyone'), folder: ensureFolder('Chores').id,
      tags: tagsOf(['chore', ch.day || '']), src: 'notion',
      body: `${ch.person || 'Everyone'} · ${ch.day || 'Any'}${ch.done ? ' · done' : ''}`
    }, c);
  }
  for (const b of pull.bills || []) {
    if (!b?.name) continue;
    upsertBySrc('notion:bill:' + (b.nid || b.name), {
      kind: 'note', title: b.name, person: 'Everyone', folder: ensureFolder('Money').id,
      tags: tagsOf(['bill', b.freq || '']), src: 'notion',
      body: `$${Number(b.amount || 0).toFixed(2)} · ${b.freq || 'monthly'}${b.due ? ` · due ${b.due}` : ''}`
    }, c);
  }
  for (const h of pull.habits || []) {
    if (!h?.name) continue;
    upsertBySrc('notion:habit:' + (h.nid || h.name), {
      kind: 'note', title: h.name, person: personOf(h.person, 'Bea'), folder: ensureFolder('Habits').id,
      tags: ['habit'], src: 'notion',
      body: [h.person ? `For ${h.person}.` : '', h.done ? 'Done today.' : '', h.log ? `Log: ${h.log}` : ''].filter(Boolean).join('\n')
    }, c);
  }
  if ((pull.people || []).length) {
    const body = (pull.people || []).map(p => `- **${p.name || 'Person'}** · goal: ${p.goal || '—'} · ${p.kcal ?? '—'} kcal · P ${p.p ?? '—'} · C ${p.c ?? '—'} · F ${p.f ?? '—'} · budget $${p.budget ?? '—'}`).join('\n');
    upsertBySrc('household:people', { kind: 'note', title: 'People and targets', body, folder: ensureFolder('Household').id, tags: ['targets'], person: 'Everyone', src: 'notion' }, c);
  }
  const exp = pull.expenses || [];
  if (exp.length) upsertBySrc('notion:expenses', {
    kind: 'note', title: 'Expenses (from Notion)', folder: ensureFolder('Money').id, tags: ['money'], person: 'Everyone', src: 'notion',
    body: digest('Expenses', ['Date', 'Who', 'What', 'Category', 'Amount'], exp.map(e => [e.date || '', e.person || '', e.desc || '', e.cat || '', e.amount ?? '']))
  }, c);
  const food = pull.food || [];
  if (food.length) upsertBySrc('notion:food', {
    kind: 'note', title: 'Food log (from Notion)', folder: ensureFolder('Meals').id, tags: ['food'], person: 'Everyone', src: 'notion',
    body: digest('Food log', ['Date', 'Who', 'Food', 'kcal'], food.map(f => [f.date || '', f.person || '', f.name || '', f.kcal ?? '']))
  }, c);
  const wo = pull.workouts || [];
  if (wo.length) upsertBySrc('notion:workouts', {
    kind: 'note', title: 'Workouts (from Notion)', folder: ensureFolder('Workouts').id, tags: ['workout'], person: 'Everyone', src: 'notion',
    body: digest('Workouts', ['Date', 'Who', 'Type', 'Mins', 'Intensity'], wo.map(w => [w.date || '', w.person || '', w.type || '', w.mins ?? '', w.intensity || '']))
  }, c);
  return c;
}
function migrateApp(state, c = counts()) {
  if (!state || typeof state !== 'object') return c;
  const recipes = state.recipes && !Array.isArray(state.recipes) ? Object.entries(state.recipes).map(([id, r]) => ({ id, ...r })) : (state.recipes || []);
  for (const r of recipes) {
    if (!r || !r.name || r.ex) continue;
    const srcId = r.nid ? 'notion:recipe:' + r.nid : 'fiaos:recipe:' + (r.id || r.name);
    upsertBySrc(srcId, { kind: 'note', title: r.name, body: recipeBody(r), folder: ensureFolder('Recipes').id, tags: tagsOf(['recipe', ...(r.tags || [])]), person: 'Everyone', src: r.nid ? 'notion' : 'fiaos' }, c);
  }
  for (const a of state.assignments || []) {
    if (!a?.title || a.ex) continue;
    upsertBySrc(a.nid ? 'notion:uni:' + a.nid : 'fiaos:asg:' + (a.id || a.title), {
      kind: 'note', title: a.title, person: personOf(a.person, 'Bea'), folder: ensureFolder('Uni').id, tags: tagsOf(['uni', 'assignment', a.course || '']), src: a.nid ? 'notion' : 'fiaos',
      body: [`**Assignment** for ${a.person || 'someone'}`, a.course ? `Course: ${a.course}` : '', a.due ? `Due: ${a.due}` : '', `Progress: ${a.pct || 0}%`].filter(Boolean).join('\n')
    }, c);
  }
  for (const e of state.exams || []) {
    if (!e?.subject || e.ex) continue;
    upsertBySrc(e.nid ? 'notion:uni:' + e.nid : 'fiaos:exam:' + (e.id || e.subject), {
      kind: 'note', title: e.subject, person: personOf(e.person, 'Bea'), folder: ensureFolder('Uni').id, tags: tagsOf(['uni', 'exam']), src: e.nid ? 'notion' : 'fiaos',
      body: [`**Exam** for ${e.person || 'someone'}`, e.course ? `Course: ${e.course}` : '', e.date ? `Date: ${e.date}` : ''].filter(Boolean).join('\n')
    }, c);
  }
  for (const ch of state.chores || []) {
    if (!ch?.name || ch.ex) continue;
    upsertBySrc(ch.nid ? 'notion:chore:' + ch.nid : 'fiaos:chore:' + (ch.id || ch.name + ch.person), {
      kind: 'note', title: ch.name, person: personOf(ch.person, 'Everyone'), folder: ensureFolder('Chores').id, tags: tagsOf(['chore', ch.day || '']), src: ch.nid ? 'notion' : 'fiaos',
      body: `${ch.person || 'Everyone'} · ${ch.day || 'Any'}${ch.done ? ' · done' : ''}`
    }, c);
  }
  for (const b of state.bills || []) {
    if (!b?.name || b.ex) continue;
    upsertBySrc(b.nid ? 'notion:bill:' + b.nid : 'fiaos:bill:' + (b.id || b.name), {
      kind: 'note', title: b.name, person: 'Everyone', folder: ensureFolder('Money').id, tags: tagsOf(['bill', b.freq || '']), src: b.nid ? 'notion' : 'fiaos',
      body: `$${Number(b.amount || 0).toFixed(2)} · ${b.freq || 'monthly'}${b.due ? ` · due ${b.due}` : ''}`
    }, c);
  }
  for (const h of state.habits || []) {
    if (!h?.name || h.ex) continue;
    const log = h.log && typeof h.log === 'object' ? Object.keys(h.log).filter(d => h.log[d]).sort().join(', ') : (h.log || '');
    upsertBySrc(h.nid ? 'notion:habit:' + h.nid : 'fiaos:habit:' + (h.id || h.name), {
      kind: 'note', title: h.name, person: personOf(h.person, 'Bea'), folder: ensureFolder('Habits').id, tags: ['habit'], src: h.nid ? 'notion' : 'fiaos',
      body: [h.person ? `For ${h.person}.` : '', log ? `Days: ${log}` : ''].filter(Boolean).join('\n')
    }, c);
  }
  if (state.people && typeof state.people === 'object') {
    const rows = Object.entries(state.people).filter(([, t]) => t && (t.goal || t.kcal || t.budget));
    if (rows.length) {
      const body = rows.map(([name, t]) => `- **${name}** · goal: ${t.goal || '—'} · ${t.kcal || 0} kcal · P ${t.p || 0} · C ${t.c || 0} · F ${t.f || 0} · budget $${t.budget || 0}`).join('\n');
      upsertBySrc('household:people', { kind: 'note', title: 'People and targets', body, folder: ensureFolder('Household').id, tags: ['targets'], person: 'Everyone', src: 'fiaos' }, c);
    }
  }
  return c;
}
async function migrateLive() {
  if (!process.env.NOTION_TOKEN) return { error: 'NOTION_TOKEN not set on the fiaOS server', added: 0, updated: 0, kept: 0 };
  const notion = require('./notion');
  const pull = await notion.pull();
  pull.wikiBodies = {};
  for (const w of pull.wiki || []) {
    try {
      const blocks = await notion.children(w.nid);
      const md = blocksToMd(blocks);
      if (md.trim()) pull.wikiBodies[w.nid] = md;
    } catch (e) { /* title and url still migrate */ }
  }
  try {
    const ids = notion.state().ids || {};
    if (ids.journal) {
      const rows = await notion.queryAll(ids.journal);
      pull.journal = rows.filter(r => !r.archived).map(normaliseJournal);
    }
  } catch (e) { pull.journalError = e.message; }
  const c = migrateNotion(pull);
  db().meta.lastNotion = nowIso();
  return { ...c, journalError: pull.journalError };
}
function migrateNotionFile() {
  let raw; try { raw = JSON.parse(fs.readFileSync(NOTION_DUMP, 'utf8')); } catch { return counts(); }
  const c = migrateNotion(raw); if (c.added || c.updated) { db().meta.lastNotionFile = nowIso(); save(); } return c;
}
function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim().replace(/^["']|["']$/g, '');
    if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
    meta[kv[1].toLowerCase()] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}
function importMd(name, text, folderId) {
  const { meta, body } = frontMatter(String(text || ''));
  const h = /^#{1,3}\s+(.+)$/m.exec(body);
  const title = clip(meta.title || (h && h[1]) || String(name || '').replace(/\.(md|markdown|txt)$/i, '') || 'Imported note', 140);
  const folder = meta.folder ? ensureFolder(meta.folder).id : (folderById(folderId) ? folderId : 'inbox');
  const note = {
    id: uid(), kind: 'doc', title, body: body.replace(/^\s+/, ''), folder, tags: tagsOf(meta.tags || ''),
    person: personOf(meta.person, 'Everyone'), created: nowIso(), updated: nowIso(), src: 'import', example: false, cells: {}
  };
  db().notes.push(note); save(); return noteView(note);
}
function importCsv(name, text, folderId) {
  const cells = cellsFromCsv(text);
  if (!Object.keys(cells).length) throw new Error('no rows in that CSV');
  const title = clip(String(name || '').replace(/\.csv$/i, '') || 'Imported sheet', 140);
  const note = {
    id: uid(), kind: 'sheet', title, body: '', cells, folder: folderById(folderId) ? folderId : 'inbox',
    tags: ['sheet'], person: 'Everyone', created: nowIso(), updated: nowIso(), src: 'import', example: false
  };
  db().notes.push(note); save(); return noteView(note);
}
function clearExamples() {
  const d = db();
  const gone = new Set(d.notes.filter(n => n.example).map(n => n.id));
  d.notes = d.notes.filter(n => !n.example);
  d.cards = d.cards.filter(c => !c.example && !gone.has(c.noteId));
  d.example = false;
  save();
  return publicIndex();
}

// ---------- Negi-chan (optional) and local fallback ----------
function localSummary(note) {
  const text = note.kind === 'sheet'
    ? Object.entries(note.cells || {}).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ')
    : mdToText(note.body || '');
  const bits = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const summary = (bits.slice(0, 3).join(' ') || text).slice(0, 500);
  return summary || 'This note is empty.';
}
async function runAi(op, id) {
  const note = noteById(id); if (!note) throw new Error('note not found');
  const local = () => ({
    via: 'local',
    summary: localSummary(note),
    cards: note.kind === 'sheet' ? [] : cardsFromBody(note.body),
    note: grokFn ? '' : 'Negi-chan needs XAI_API_KEY on the fiaOS server. Used the note itself.'
  });
  if (!grokFn) return local();
  const source = note.kind === 'sheet' ? Object.entries(note.cells || {}).map(([k, v]) => k + '\t' + v).join('\n') : String(note.body || '').slice(0, 8000);
  try {
    const content = await grokFn([
      { role: 'system', content: 'You are Negi-chan, Bea\'s helper inside fiaOS (en-AU). Reply with one JSON object only: {"summary":"at most 4 sentences","cards":[{"front":"short prompt","back":"short answer"}]}. Use only facts from the note. Do not invent. For summarise, cards may be empty. For flashcards, return 3 to 8 cards a student could review with spaced repetition.' },
      { role: 'user', content: `OP: ${op === 'flashcards' ? 'flashcards' : 'summarise'}\nTITLE: ${note.title}\n\n${source}` }
    ]);
    const cleaned = String(content || '').replace(/^```json\s*|```$/g, '').trim();
    const j = JSON.parse(cleaned);
    const cards = (Array.isArray(j.cards) ? j.cards : []).map(c => ({ front: clip(c.front, 240), back: clip(c.back, 600) })).filter(c => c.front && c.back).slice(0, 12);
    return { via: 'grok', summary: clip(j.summary, 1200), cards, note: '' };
  } catch (e) {
    const fb = local(); fb.note = 'Negi-chan could not answer (' + e.message + '). Used the note itself.'; fb.via = 'local'; return fb;
  }
}

function slug(name, ext) {
  const s = String(name || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
  return s + '.' + ext;
}
function exportOf(n, fmt) {
  if (fmt === 'csv') {
    if (n.kind !== 'sheet') throw new Error('CSV export is for spreadsheets');
    return { body: sheetCsv(n), type: 'text/csv; charset=utf-8', file: slug(n.title, 'csv') };
  }
  if (fmt === 'md') {
    const md = n.kind === 'sheet' ? '```\n' + sheetCsv(n) + '```\n' : (n.body || '');
    const head = `---\ntitle: ${n.title.replace(/\n/g, ' ')}\ntags: ${(n.tags || []).join(', ')}\nperson: ${n.person || ''}\n---\n\n`;
    return { body: head + md, type: 'text/markdown; charset=utf-8', file: slug(n.title, 'md') };
  }
  if (fmt === 'html') {
    const inner = n.kind === 'sheet' ? '<table>' + sheetTable(n) + '</table>' : `<p class="meta">${esc((n.tags || []).map(t => '#' + t).join(' '))} · ${esc(n.person || '')}</p>` + mdToHtml(n.body || '');
    return { body: htmlDoc(n.title, `<h1>${esc(n.title)}</h1>` + inner), type: 'text/html; charset=utf-8', file: slug(n.title, 'html') };
  }
  if (fmt === 'pdf') {
    const text = n.kind === 'sheet' ? sheetCsv(n) : mdToText(n.body || '');
    return { body: toPdf(n.title, text), type: 'application/pdf', file: slug(n.title, 'pdf') };
  }
  throw new Error('format must be md, html, pdf or csv');
}
function sheetTable(n) {
  const values = evalSheet(n.cells || {});
  let maxC = 1, maxR = 1;
  for (const ref of Object.keys(n.cells || {})) { const p = parseRef(ref); if (p) { maxC = Math.max(maxC, p.col); maxR = Math.max(maxR, p.row); } }
  let html = '';
  for (let r = 1; r <= maxR; r++) {
    html += '<tr>';
    for (let c = 1; c <= maxC; c++) html += '<td>' + esc(fmtVal(values[colName(c) + r]) || (n.cells || {})[colName(c) + r] || '') + '</td>';
    html += '</tr>';
  }
  return html;
}

function localOnly(req) { return /^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(req.socket.remoteAddress || ''); }

async function handle(req, res, u, readBody) {
  const send = (c, o, type = 'application/json') => {
    res.writeHead(c, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o));
  };
  if (!localOnly(req)) return send(403, { error: 'local only' });
  if (req.method === 'POST' && req.headers['x-fiaos'] !== '1') return send(403, { error: 'missing X-FiaOS header' });
  const J = async () => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
  try {
    const r = u.pathname, post = req.method === 'POST';
    if (r === '/api/fianotes' && !post) return send(200, publicIndex());
    if (r === '/api/fianotes/note' && !post) {
      const n = noteById(u.searchParams.get('id')); if (!n) return send(404, { error: 'note not found' });
      return send(200, noteView(n));
    }
    if (r === '/api/fianotes/note' && post) return send(200, upsertNote(await J()));
    if (r === '/api/fianotes/delete' && post) return send(200, deleteNote((await J()).id));
    if (r === '/api/fianotes/folder' && post) return send(200, folderOp(await J()));
    if (r === '/api/fianotes/search' && !post) return send(200, { hits: search(u.searchParams.get('q') || '') });
    if (r === '/api/fianotes/backlinks' && !post) return send(200, { backlinks: backlinksOf(u.searchParams.get('id')) });
    if (r === '/api/fianotes/render' && post) { const b = await J(); return send(200, { html: mdToHtml(b.md || '') }); }
    if (r === '/api/fianotes/export' && !post) {
      const n = noteById(u.searchParams.get('id')); if (!n) return send(404, { error: 'note not found' });
      const exp = exportOf(n, (u.searchParams.get('fmt') || 'md').toLowerCase());
      res.writeHead(200, { 'Content-Type': exp.type, 'Content-Disposition': `attachment; filename="${exp.file}"`, 'Cache-Control': 'no-store' });
      return res.end(exp.body);
    }
    if (r === '/api/fianotes/import' && post) {
      const b = await J(); const fmt = String(b.fmt || '').toLowerCase();
      if (fmt === 'docx') {
        const buf = Buffer.from(String(b.data || '').replace(/^data:.*?;base64,/, ''), 'base64');
        if (buf.length > 2_000_000) throw new Error('file is over 2 MB');
        if (buf.length < 4) throw new Error('empty file');
        const md = importDocx(buf);
        return send(200, importMd(b.name || 'Imported.docx', md, b.folder));
      }
      if (fmt === 'csv') return send(200, importCsv(b.name || 'Imported.csv', b.data || '', b.folder));
      if (fmt === 'md' || fmt === 'markdown' || fmt === 'txt') return send(200, importMd(b.name || 'Imported.md', b.data || '', b.folder));
      throw new Error('import fmt must be md, docx or csv');
    }
    if (r === '/api/fianotes/migrate' && post) {
      const b = await J(); const out = {};
      if (b.board) { const raw = b.notes ? { notes: b.notes } : null; out.board = raw ? migrateBoard(raw) : migrateBoardFile(); }
      if (b.notion) out.notion = migrateNotion(b.notion);
      if (b.app) out.app = migrateApp(b.app);
      if (b.live) { try { out.live = await migrateLive(); } catch (e) { out.live = { error: e.message, added: 0, updated: 0, kept: 0 }; } }
      if (b.notionFile !== false && !b.notion && !b.live) { /* explicit file read only when asked */ }
      if (b.dump) out.dump = migrateNotionFile();
      const touched = ['board', 'notion', 'app', 'live', 'dump'].some(k => out[k] && ((out[k].added || 0) + (out[k].updated || 0) > 0));
      if (touched) { db().meta.lastMigrate = nowIso(); save(); }
      return send(200, { ok: true, ...out, library: publicIndex() });
    }
    if (r === '/api/fianotes/examples/clear' && post) return send(200, clearExamples());
    if (r === '/api/fianotes/cards' && !post) return send(200, dueCards(new Date(), u.searchParams.get('ahead') === '1'));
    if (r === '/api/fianotes/cards' && post) {
      const b = await J();
      if (b.op === 'add') { const c = addCard(b); save(); return send(200, { card: c, ...dueCards() }); }
      if (b.op === 'addMany') {
        const before = db().cards.length;
        const made = []; for (const c of b.cards || []) made.push(addCard({ ...c, noteId: b.noteId, tags: c.tags || b.tags }));
        save(); return send(200, { added: db().cards.length - before, cards: made, ...dueCards() });
      }
      if (b.op === 'fromNote') {
        const n = noteById(b.id); if (!n) throw new Error('note not found');
        const before = db().cards.length;
        const made = cardsFromBody(n.body).map(c => addCard({ ...c, noteId: n.id }));
        save(); return send(200, { added: db().cards.length - before, cards: made, ...dueCards() });
      }
      if (b.op === 'grade') {
        const c = db().cards.find(x => x.id === b.id); if (!c) throw new Error('card not found');
        if (b.q == null || isNaN(+b.q)) throw new Error('grade q 0–5 needed');
        Object.assign(c, sm2(c, +b.q)); c.example = false; save(); return send(200, { card: c, ...dueCards() });
      }
      if (b.op === 'remove') { db().cards = db().cards.filter(x => x.id !== b.id); save(); return send(200, dueCards()); }
      throw new Error('bad op');
    }
    if (r === '/api/fianotes/ai' && post) { const b = await J(); return send(200, await runAi(b.op, b.id)); }
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message || 'error' }); }
}

function start(opts = {}) {
  grokFn = opts.grok || null;
  freshFromDisk();
  const board = migrateBoardFile();
  const dump = migrateNotionFile();
  if (board.added || board.updated || dump.added || dump.updated) {
    db().meta.lastMigrate = nowIso();
    save();
    console.log(`fianotes: migrated board +${board.added} notion-file +${dump.added}`);
  }
  try {
    const hub = require('./fiaos-core');
    hub.register('notes', terms => db().notes.filter(n => hub.match(terms, [n.title, n.kind === 'sheet' ? Object.values(n.cells || {}).join(' ') : n.body, (n.tags || []).join(' ')].join('\n'))).slice(0, 10).map(n => ({ kind: n.kind === 'sheet' ? 'sheet' : (n.kind === 'doc' ? 'doc' : 'note'), id: n.id, title: n.title, snippet: snippet(n.kind === 'sheet' ? Object.values(n.cells || {}).join(' ') : n.body, terms[0], 100), tab: 'Notes', score: n.title.toLowerCase().includes(terms.join(' ')) ? 5 : 2 })));
  } catch (e) { console.log('fianotes search', e.message); }
}

module.exports = {
  handle, start, evalSheet, sortRange, chartFrom, upsertNote, sm2, mdToHtml, importDocx, docxToMd, blocksToMd, normaliseJournal,
  migrateBoard, migrateNotion, migrateApp, cardsFromBody, search, toPdf, parseCsv, unzip,
  _fresh: freshFromDisk, _blank() { DB = blank(); return DB; }, _db: () => db(), _save: save, _file: FILE
};
