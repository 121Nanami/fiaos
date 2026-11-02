// FiaNotes / FiaDocs: formulas, markdown, docx, SM-2, migration, and the HTTP API.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fiaos-notes-'));
process.env.FIAOS_DATA = tmp;
delete process.env.NOTION_TOKEN;
const fn = require('../fianotes');

test('SUM, AVERAGE and arithmetic', () => {
  const v = fn.evalSheet({ A1: '2', A2: '4', A3: 'nope', A4: '', B1: '=SUM(A1:A4)', B2: '=AVERAGE(A1:A2)', B3: '=A1+A2*3', B4: '=MIN(A1:A2)', B5: '=MAX(A1:A2)', B6: '=COUNT(A1:A4)' });
  assert.equal(v.B1.value, 6); // text and blank are skipped
  assert.equal(v.B2.value, 3);
  assert.equal(v.B3.value, 14);
  assert.equal(v.B4.value, 2);
  assert.equal(v.B5.value, 4);
  assert.equal(v.B6.value, 2);
});
test('sheet errors: divide by zero, cycle, unknown name, bad ref', () => {
  const v = fn.evalSheet({ A1: '=1/0', A2: '=B2', B2: '=A2', A3: '=NOSUCH(A1)', A4: '=A0' });
  assert.equal(v.A1.error, '#DIV/0');
  assert.equal(v.A2.error, '#CYCLE');
  assert.equal(v.B2.error, '#CYCLE');
  assert.equal(v.A3.error, '#NAME');
  assert.equal(v.A4.error, '#REF');
});
test('seed grocery sheet totals', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'fianotes.seed.json'), 'utf8'));
  const sheet = seed.notes.find(n => n.kind === 'sheet');
  const v = fn.evalSheet(sheet.cells);
  assert.equal(v.E2.value, 6);
  assert.equal(v.E3.value, 7);
  assert.equal(v.E4.value, 6.5);
});
test('markdown escapes HTML and resolves a wikilink', () => {
  const map = new Map([['bin night', 'exbin']]);
  const html = fn.mdToHtml('# Hi\n\nSee [[Bin night|bins]] and <script>alert(1)</script>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', map);
  assert.match(html, /<h1>Hi<\/h1>/);
  assert.match(html, /data-ref="Bin night"/);
  assert.match(html, /href="#exbin"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
});
test('SM-2 intervals and ease', () => {
  const now = new Date(2026, 10, 2);
  let c = fn.sm2({ ease: 2.5, interval: 0, reps: 0, lapses: 0 }, 4, now);
  assert.equal(c.interval, 1);
  assert.equal(c.reps, 1);
  assert.equal(c.ease, 2.5);
  assert.equal(c.due, '2026-11-03');
  c = fn.sm2(c, 4, new Date(2026, 10, 3));
  assert.equal(c.interval, 6);
  assert.equal(c.reps, 2);
  assert.equal(c.due, '2026-11-09');
  c = fn.sm2(c, 1, new Date(2026, 10, 9));
  assert.equal(c.reps, 0);
  assert.equal(c.interval, 1);
  assert.equal(c.lapses, 1);
  assert.equal(c.ease, 1.96);
  const easy = fn.sm2({ ease: 2.5, interval: 0, reps: 0, lapses: 0 }, 5, now);
  assert.equal(easy.ease, 2.6);
});
test('cards are read out of a note', () => {
  const cards = fn.cardsFromBody('Q: What is a minimal pair?\nA: Two words, one sound apart.\n\nsip :: ship\n\nThe {{velar}} sound.\n');
  assert.deepEqual(cards.map(c => c.front), ['sip', 'The _____ sound.', 'What is a minimal pair?']);
  assert.equal(cards[0].back, 'ship');
  assert.equal(cards[1].back, 'velar');
});
test('docx import keeps headings, emphasis, a list and a table', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Shopping list</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Milk</w:t></w:r><w:r><w:t> and </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>bread</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Apples</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Price &amp; tax</w:t></w:r></w:p>
</w:body></w:document>`;
  const md = fn.importDocx(zipStore({ 'word/document.xml': Buffer.from(xml) }));
  assert.match(md, /^# Shopping list/);
  assert.match(md, /\*\*Milk\*\*/);
  assert.match(md, /\*bread\*/);
  assert.match(md, /^- Apples/m);
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /Price & tax/);
  const deflated = zipDeflate({ 'word/document.xml': Buffer.from(xml) });
  assert.match(fn.importDocx(deflated), /Shopping list/);
});
test('notion blocks become markdown', () => {
  const md = fn.blocksToMd([
    { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Wifi', annotations: {} }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'off', annotations: { bold: true } }] } },
    { type: 'to_do', to_do: { checked: true, rich_text: [{ plain_text: 'label the router', annotations: {} }] } }
  ]);
  assert.match(md, /^# Wifi/);
  assert.match(md, /^- \*\*off\*\*/m);
  assert.match(md, /^- \[x\] label the router/m);
});
test('a pdf is a real document and an html export is safe', () => {
  const pdf = fn.toPdf('Bin night', 'Yellow lid.\n<script>');
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /Bin night/);
  const start = pdf.toString('latin1').match(/startxref\n(\d+)/)[1];
  assert.equal(pdf.slice(+start, +start + 4).toString(), 'xref');
});

function zipStore(files) { return zip(files, false); }
function zipDeflate(files) { return zip(files, true); }
function zip(files, deflate) {
  const parts = [], cds = []; let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nameB = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt32LE(offset, 42);
    cds.push(Buffer.concat([cd, nameB]));
    offset += local.length + nameB.length + data.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
const srv = http.createServer((req, res) => fn.handle(req, res, new URL(req.url, 'http://x'), body));
let base;
test.before(async () => { await new Promise(ok => srv.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${srv.address().port}`; ok(); })); });
test.after(() => srv.close());
const get = async u => { const r = await fetch(base + u); const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch {} return { status: r.status, json, buf, type: r.headers.get('content-type') || '', disp: r.headers.get('content-disposition') || '' }; };
const post = async (u, b, h = { 'X-FiaOS': '1' }) => { const r = await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }); const json = await r.json(); return { status: r.status, json }; };

test('library API: notes, search, backlinks, sheet, import, cards, migration', async () => {
  fn._blank();
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'fianotes.seed.json'), 'utf8'));
  // empty library, then the example seed is what a fresh disk load would show
  fs.rmSync(fn._file, { force: true });
  const fresh = fn._fresh();
  assert.equal(fresh.example, true);
  assert.ok(fresh.notes.some(n => n.title === 'Bin night'));

  fn._blank();
  const made = await post('/api/fianotes/note', { kind: 'note', title: 'Bin night', body: 'Yellow lid Tuesday.', folder: 'inbox', tags: ['house'], person: 'Everyone' });
  assert.equal(made.status, 200);
  const id = made.json.note.id;
  const link = await post('/api/fianotes/note', { kind: 'doc', title: 'Router', body: 'See [[Bin night]] and <img src=x onerror=alert(1)>.', tags: 'wifi, house', person: 'Bea' });
  assert.match(link.json.html, /data-ref="Bin night"/);
  assert.match(link.json.html, /href="#/);
  assert.doesNotMatch(link.json.html, /<img/);
  assert.equal(link.json.backlinks.length, 0);
  const back = await get('/api/fianotes/backlinks?id=' + id);
  assert.equal(back.json.backlinks.length, 1);
  assert.equal(back.json.backlinks[0].title, 'Router');

  const found = await get('/api/fianotes/search?q=' + encodeURIComponent('yellow lid'));
  assert.equal(found.json.hits[0].title, 'Bin night');
  const miss = await get('/api/fianotes/search?q=nope-not-here');
  assert.equal(miss.json.hits.length, 0);

  const sheet = await post('/api/fianotes/note', { kind: 'sheet', title: 'Split', cells: { A1: '1', A2: '3', A3: '=SUM(A1:A2)', A4: '=AVERAGE(A1:A2)' } });
  assert.equal(sheet.json.values.A3.value, 4);
  assert.equal(sheet.json.values.A4.value, 2);
  const csv = await get('/api/fianotes/export?id=' + sheet.json.note.id + '&fmt=csv');
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.buf.toString(), /=SUM\(A1:A2\)/);
  const pdf = await get('/api/fianotes/export?id=' + id + '&fmt=pdf');
  assert.match(pdf.type, /application\/pdf/);
  assert.equal(pdf.buf.slice(0, 5).toString(), '%PDF-');
  const html = await get('/api/fianotes/export?id=' + link.json.note.id + '&fmt=html');
  assert.match(html.buf.toString(), /Print this page|Save as PDF/);
  assert.doesNotMatch(html.buf.toString(), /<img/);

  const md = await post('/api/fianotes/import', { fmt: 'md', name: 'Clinic.md', data: '---\ntitle: Placement notes\ntags: [study, speech]\nperson: Bea\nfolder: Study\n---\n\n# Placement notes\n\nFriday clinic.\n' });
  assert.equal(md.json.note.title, 'Placement notes');
  assert.ok(md.json.note.tags.includes('speech'));
  assert.equal(md.json.note.person, 'Bea');
  const csvIn = await post('/api/fianotes/import', { fmt: 'csv', name: 'Costs.csv', data: 'Item,Cost\nMilk,2\nBread,3.5\nTotal,=SUM(B2:B3)\n' });
  assert.equal(csvIn.json.note.kind, 'sheet');
  assert.equal(csvIn.json.values.B4.value, 5.5);
  const docx = zipStore({ 'word/document.xml': Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>From Word</w:t></w:r></w:p></w:body></w:document>') });
  const doc = await post('/api/fianotes/import', { fmt: 'docx', name: 'Letter.docx', data: docx.toString('base64') });
  assert.match(doc.json.note.body, /From Word/);

  const cards = await post('/api/fianotes/cards', { op: 'fromNote', id: made.json.note.id });
  assert.equal(cards.json.added, 0); // no Q/A in that note
  const speech = await post('/api/fianotes/note', { kind: 'note', title: 'Pairs', body: 'sip :: ship\n\nQ: Where?\nA: Clinic.\n' });
  const madeCards = await post('/api/fianotes/cards', { op: 'fromNote', id: speech.json.note.id });
  assert.equal(madeCards.json.added, 2);
  const again = await post('/api/fianotes/cards', { op: 'fromNote', id: speech.json.note.id });
  assert.equal(again.json.added, 0);
  const due = await get('/api/fianotes/cards');
  assert.ok(due.json.counts.due >= 2);
  const graded = await post('/api/fianotes/cards', { op: 'grade', id: due.json.due[0].id, q: 5 });
  assert.equal(graded.status, 200);
  assert.ok(graded.json.card.due > new Date().toLocaleDateString('en-CA'));

  const board = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'notes.example.json'), 'utf8'));
  const notion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'notion-pull.example.json'), 'utf8'));
  const mig = await post('/api/fianotes/migrate', {
    board: true, notes: board.notes, notion,
    app: { recipes: { r1: { id: 'r1', name: 'Soup', kcal: 300, p: 10, c: 20, f: 5, ing: { bread: 1 } } }, people: { Bea: { goal: 'Eat lunch', kcal: 2100, p: 100, c: 200, f: 60, budget: 150 } } }
  });
  assert.equal(mig.status, 200);
  assert.equal(mig.json.board.added, 2);
  assert.ok(mig.json.notion.added >= 6);
  assert.ok(mig.json.app.added >= 1);
  const againMig = await post('/api/fianotes/migrate', { board: true, notes: board.notes, notion });
  assert.equal(againMig.json.board.added, 0);
  assert.equal(againMig.json.notion.added, 0);
  const idx = await get('/api/fianotes');
  assert.ok(idx.json.notes.some(n => n.title === 'Guest Wi-Fi'));
  assert.ok(idx.json.notes.some(n => /Out till 6/.test(n.title)));
  assert.ok(idx.json.notes.some(n => n.title === 'Tuna rice bowl'));
  const wifi = idx.json.notes.find(n => n.title === 'Guest Wi-Fi');
  const full = await get('/api/fianotes/note?id=' + wifi.id);
  assert.match(full.json.note.body, /password card/);

  const ai = await post('/api/fianotes/ai', { op: 'flashcards', id: speech.json.note.id });
  assert.equal(ai.json.via, 'local');
  assert.ok(ai.json.cards.length >= 2);

  const denied = await post('/api/fianotes/note', { title: 'nope' }, {});
  assert.equal(denied.status, 403);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /\/api\/fianotes/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), /fianotesui\.js/);
});
