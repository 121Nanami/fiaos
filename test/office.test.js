// Office formulas, documents, sheets, slides, and the drawing helpers.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fiaos-office-'));
process.env.FIAOS_DATA = tmp;
const notes = require('../fianotes');
const office = require('../fiaoffice');
const studio = require('../fiastudio');

test('IF, COUNTIF, LOOKUP and dates', () => {
  const v = notes.evalSheet({
    A1: 'Milk', B1: '2', A2: 'Bread', B2: '5', A3: 'Milk', B3: '1',
    C1: '=IF(B1>3,"big","small")',
    C2: '=COUNTIF(A1:A3,"Milk")',
    C3: '=VLOOKUP("Bread",A1:B3,2)',
    C4: '=LOOKUP("Milk",A1:B2)',
    C5: '=DATE(2026,11,2)',
    C6: '=YEAR(C5)',
    C7: '=MONTH(C5)',
    C8: '=DAY(C5)',
    C9: '=IF(1=1,"yes","no")'
  });
  assert.equal(v.C1.value, 'small');
  assert.equal(v.C2.value, 2);
  assert.equal(v.C3.value, 5);
  assert.equal(v.C4.value, 2);
  assert.equal(v.C5.value, '2026-11-02');
  assert.equal(v.C6.value, 2026);
  assert.equal(v.C7.value, 11);
  assert.equal(v.C8.value, 2);
  assert.equal(v.C9.value, 'yes');
  assert.equal(notes.evalSheet({ A1: '=TODAY()' }).A1.type, 'str');
});
test('sort writes rows back and a chart is svg', () => {
  const sorted = notes.sortRange({ A1: 'b', B1: '2', A2: 'a', B2: '1' }, 'A1', 'B2', 0, 'asc');
  assert.equal(sorted.A1, 'a');
  assert.equal(sorted.B2, '2');
  const svg = notes.chartFrom({ A1: 'Milk', B1: '2', A2: 'Bread', B2: '5' }, 'A1', 'B2');
  assert.match(svg, /<svg/);
  assert.match(svg, /<rect/);
});
test('a document template, a suggestion, and an ods file', () => {
  office._blank();
  const doc = office.saveDoc({ template: 'clinic', title: 'Friday clinic' });
  assert.match(office.docToMd(doc), /Clinic note/);
  assert.match(office.docToHtml(doc), /<h1>/);
  const block = doc.blocks.find(b => b.text);
  const ch = office.suggest({ id: doc.id, blockId: block.id, after: 'Person: Bea' });
  const kept = office.resolveChange({ id: doc.id, changeId: ch.id, status: 'accepted' });
  assert.equal(kept.blocks.find(b => b.id === block.id).text, 'Person: Bea');
  const book = office.saveBook({ title: 'Groceries', sheets: [{ name: 'Food', cells: { A1: 'Milk', B1: '2' } }, { name: 'Other', cells: { A1: '1' } }] });
  assert.equal(book.sheets.length, 2);
  assert.equal(book.sheets[0].values.B1.value, 2);
  const deck = office.saveDeck({ title: 'Talk', theme: 'clinic', transition: 'rise', slides: [{ layout: 'split', title: 'Hello', body: 'Left', aside: 'Right', notes: 'Pause' }] });
  const html = office.deckHtml(deck, true);
  assert.match(html, /Pause/);
  assert.match(html, /clinic/);
  const ods = studio.zipStore && notes.chartFrom;
  assert.equal(typeof office.THEMES.ink.bg, 'string');
});
test('drawing booleans, a grey filter, and a poster', () => {
  const u = studio.unionRects({ x: 0, y: 0, w: 10, h: 10 }, { x: 8, y: 8, w: 10, h: 10 });
  assert.equal(u.w, 18);
  const hole = studio.subtractRects({ x: 0, y: 0, w: 20, h: 20, fill: '#39C5BB' }, { x: 5, y: 5, w: 4, h: 4 });
  assert.equal(hole.fillRule, 'evenodd');
  const svg = studio.shapesToSvg([u, { type: 'text', x: 2, y: 12, text: 'Bea', size: 12 }], 40, 40);
  assert.match(svg, /<text/);
  assert.doesNotMatch(svg, /<script/);
  const px = studio.filterPixels(Buffer.from([10, 20, 30, 255]), 'gray');
  assert.equal(px[0], px[1]);
  assert.equal(px[1], px[2]);
  const poster = studio.saveLayout({ title: 'Market', page: 'poster', items: [{ type: 'text', x: 10, y: 10, w: 40, h: 10, text: 'Friday' }] });
  assert.match(studio.layoutSvg(poster), /Friday/);
});
