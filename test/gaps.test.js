// Layers, photo flatten, clip plans, path booleans, formula sort, charts, slides, ODT images.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fiaos-gaps-'));
process.env.FIAOS_DATA = tmp;
const notes = require('../fianotes');
const office = require('../fiaoffice');
const studio = require('../fiastudio');
const pathbool = require('../pathbool');
const png = require('../png');

test('sort keeps formulas and shifts relative refs', () => {
  const sorted = notes.sortRange({ A1: 'b', B1: '=A1', A2: 'a', B2: '=A2', C1: '=B1' }, 'A1', 'B2', 0, 'asc');
  assert.equal(sorted.A1, 'a');
  assert.equal(sorted.B1, '=A1');
  assert.equal(sorted.A2, 'b');
  assert.equal(sorted.B2, '=A2');
  assert.equal(sorted.C1, '=B2');
  const abs = notes.sortRange({ A1: 'b', B1: '=$A$2', A2: 'a', B2: '=A2' }, 'A1', 'B2', 0, 'asc');
  assert.equal(abs.B2, '=$A$2');
  assert.equal(abs.B1, '=A1');
});

test('line, pie and scatter charts are svg', () => {
  const cells = { A1: 'Milk', B1: '2', A2: 'Bread', B2: '5' };
  assert.match(notes.chartFrom(cells, 'A1', 'B2', 'line'), /<polyline/);
  assert.match(notes.chartFrom(cells, 'A1', 'B2', 'scatter'), /<circle/);
  assert.match(notes.chartFrom(cells, 'A1', 'B2', 'pie'), /<path/);
  assert.match(notes.chartFrom({ A1: 'Only', B1: '3' }, 'A1', 'B1', 'pie'), /<circle/);
});

test('boolean ops on rectangles and an arbitrary path', () => {
  const a = { type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#39C5BB' };
  const b = { type: 'rect', x: 5, y: 0, w: 10, h: 10, fill: '#E12885' };
  const union = pathbool.booleanShapes('union', a, b);
  const inter = pathbool.booleanShapes('intersect', a, b);
  const sub = pathbool.booleanShapes('subtract', a, b);
  assert.ok(Math.abs(union.area - 150) < 12, 'union ' + union.area);
  assert.ok(Math.abs(inter.area - 50) < 12, 'intersect ' + inter.area);
  assert.ok(Math.abs(sub.area - 50) < 12, 'subtract ' + sub.area);
  assert.match(union.d, /^M /);
  const far = pathbool.booleanShapes('intersect', a, { type: 'rect', x: 40, y: 40, w: 4, h: 4 });
  assert.ok((far.area || 0) < 5);
  const ell = pathbool.booleanShapes('union', { type: 'ellipse', x: 0, y: 0, w: 20, h: 10 }, a);
  assert.ok(ell.area > 100);
  const L = { type: 'path', d: 'M 0 0 H 10 V 4 H 4 V 10 H 0 Z' };
  const hit = pathbool.booleanShapes('intersect', L, { type: 'rect', x: 0, y: 0, w: 10, h: 4 });
  assert.ok(hit.area > 20, 'path intersect ' + hit.area);
  assert.match(hit.d, /M /);
});

test('png round-trip and a cropped flatten', () => {
  const rgba = Buffer.alloc(2 * 2 * 4, 0);
  rgba[0] = 10; rgba[1] = 20; rgba[2] = 30; rgba[3] = 255;
  rgba[4] = 200; rgba[5] = 10; rgba[6] = 10; rgba[7] = 255;
  const buf = png.encodePNG(rgba, 2, 2);
  const back = png.decodePNG(buf);
  assert.equal(back.w, 2);
  assert.equal(back.h, 2);
  assert.equal(back.rgba[0], 10);
  assert.equal(back.rgba[4], 200);
  const flat = png.flattenPhoto(back.rgba, 2, 2, { exposure: 0, contrast: 0, saturate: 0, crop: { x: 0, y: 0, w: 0.5, h: 1 } });
  assert.equal(flat.w, 1);
  assert.equal(flat.h, 2);
  assert.ok(Math.abs(flat.rgba[0] - flat.rgba[1]) < 3);
});

test('photo batch writes a flattened png and skips non-png', () => {
  const buf = png.encodePNG(Buffer.alloc(4 * 4 * 4, 180), 4, 4);
  const asset = studio.saveAsset({ mime: 'image/png', name: 'swatch.png', data: buf.toString('base64') });
  const photo = studio.savePhoto({ title: 'Swatch', assetId: asset.id, exposure: 0.2, contrast: 0.1, saturate: 1, crop: { x: 0, y: 0, w: 1, h: 1 } });
  studio.savePhoto({ title: 'Skip', assetId: studio.saveAsset({ mime: 'image/svg+xml', name: 'mark.svg', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' }).id });
  const out = studio.batchPhotos();
  const hit = out.exported.find(e => e.id === photo.id);
  assert.ok(hit, JSON.stringify(out));
  assert.equal(hit.w, 4);
  const media = require('../fiamedia');
  assert.ok(fs.existsSync(path.join(media.DIR, hit.file)));
  assert.ok(out.skipped.some(s => /PNG/.test(s.error)));
});

test('clip plan lists every span and a concat step', () => {
  const plan = studio.clipPlan('talk.webm', [{ start: 1, end: 3, label: 'a' }, { start: 8, end: 9 }, { start: 4, end: 4 }]);
  assert.equal(plan.cuts.length, 2);
  assert.equal(plan.spans.length, 2);
  assert.match(plan.cuts[0].args.join(' '), /-ss 1/);
  assert.match(plan.cuts[1].args.join(' '), /-to 9/);
  assert.ok(plan.cuts.every(c => c.args.includes('copy')));
  assert.ok(plan.concat.includes('concat'));
  assert.match(plan.list, /part0\.webm/);
  assert.match(plan.list, /part1\.webm/);
});

test('odt export embeds a library picture', () => {
  const buf = png.encodePNG(Buffer.alloc(2 * 2 * 4, 255), 2, 2);
  const asset = studio.saveAsset({ mime: 'image/png', name: 'dot.png', data: buf.toString('base64') });
  office._blank();
  const doc = office.saveDoc({
    title: 'With a picture',
    blocks: [{ type: 'image', assetId: asset.id, alt: 'Dot' }, { type: 'p', text: 'Bring the cards' }]
  });
  const html = office.docToHtml(doc);
  assert.match(html, /<img /);
  assert.match(html, new RegExp(asset.id));
  const odt = office.odtFromDoc(doc);
  const files = notes.unzip(odt);
  const xml = files['content.xml'].toString('utf8');
  assert.match(xml, /draw:image/);
  assert.match(xml, /Bring the cards/);
  assert.ok(Object.keys(files).some(name => name.startsWith('Pictures/') && name.endsWith('.png')));
  assert.equal(files['mimetype'].toString(), 'application/vnd.oasis.opendocument.text');
});

test('slide html can autoplay with the extra transitions', () => {
  office._blank();
  const deck = office.saveDeck({ title: 'Play', theme: 'paper', transition: 'wipe', seconds: 3, slides: [{ title: 'A', body: 'One' }, { title: 'B', body: 'Two' }] });
  assert.equal(deck.transition, 'wipe');
  assert.equal(deck.seconds, 3);
  const html = office.deckHtml(deck, false, true);
  assert.match(html, /setInterval/);
  assert.match(html, /3000/);
  assert.match(html, /@keyframes wipe/);
  assert.match(html, /@keyframes zoom/);
  assert.match(html, /@keyframes flip/);
  assert.match(html, /ArrowRight/);
});

test('a paint project keeps layers and a flattened sheet', () => {
  const png = 'data:image/png;base64,' + Buffer.from(pngMod()).toString('base64');
  function pngMod() { return require('../png').encodePNG(Buffer.alloc(8, 255), 1, 2); }
  const row = studio.savePaint({
    title: 'Stack',
    png,
    layers: [
      { name: 'Paper', png, opacity: 1, blend: 'source-over', visible: true },
      { name: 'Ink', png, opacity: 0.4, blend: 'multiply', visible: false }
    ]
  });
  assert.equal(row.layers.length, 2);
  assert.equal(row.layers[1].blend, 'multiply');
  assert.equal(row.layers[1].opacity, 0.4);
  assert.equal(row.layers[1].visible, false);
  assert.equal('png' in row.layers[0], false);
});
