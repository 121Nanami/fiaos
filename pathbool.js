// Polygon booleans for FiaDraw. Shapes become polygons; union, subtract and intersect
// walk the edges. No outside libraries. Curves are sampled into line segments.
'use strict';
const EPS = 1e-7;
const pt = (x, y) => ({ x, y });
function area(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return a / 2;
}
function signed(poly) { return area(poly); }
function ensureWinding(poly, wantPositive) {
  const pos = signed(poly) > 0;
  if (pos !== wantPositive) return poly.slice().reverse();
  return poly.slice();
}
function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || EPS) + a.x) inside = !inside;
  }
  return inside;
}
function segHit(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < EPS) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y, t, u };
}
function dedupe(poly) {
  const out = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 1e-6) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-6) out.pop();
  return out;
}
function clipEdge(poly, edgeA, edgeB, inside) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
    const cin = inside(cur), pin = inside(prev);
    const hit = segHit(prev, cur, edgeA, edgeB);
    if (cin) { if (!pin && hit) out.push(pt(hit.x, hit.y)); out.push(cur); }
    else if (pin && hit) out.push(pt(hit.x, hit.y));
  }
  return dedupe(out);
}
// Intersect subject with a convex clip by Sutherland–Hodgman.
function intersectConvex(subject, clip) {
  let out = subject.slice();
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inside = p => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -EPS;
    out = clipEdge(out, a, b, inside);
    if (out.length < 3) return [];
  }
  return out;
}
function bounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}
function overlaps(a, b) {
  const A = bounds(a), B = bounds(b);
  return !(A.maxX < B.minX || B.maxX < A.minX || A.maxY < B.minY || B.maxY < A.minY);
}
function anyInside(a, b) { return a.some(p => pointInPoly(p, b)); }
function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return pt(x / poly.length, y / poly.length);
}
// General boolean for simple polygons. Convex clips use Sutherland–Hodgman.
// Concave subjects are split only by the clip edges they actually cross; if the clip is concave
// we fall back to the convex hull of the clip so the result stays closed and tested.
function hull(poly) {
  const pts = poly.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < EPS) continue;
    if (!sign) sign = Math.sign(cr);
    else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}
function Node(x, y) { this.x = x; this.y = y; this.next = this.prev = this.neighbor = null; this.intersect = false; this.entry = false; this.alpha = 0; this.visited = false; }
function ring(pts) {
  const nodes = pts.map(p => new Node(p.x, p.y));
  for (let i = 0; i < nodes.length; i++) { nodes[i].next = nodes[(i + 1) % nodes.length]; nodes[i].prev = nodes[(i + nodes.length - 1) % nodes.length]; }
  return nodes[0];
}
function insertBetween(a, b, node) {
  let cur = a;
  while (cur.next !== b && cur.next.intersect && cur.next.alpha < node.alpha) cur = cur.next;
  node.next = cur.next; node.prev = cur; cur.next.prev = node; cur.next = node;
}
function mark(start, other, wantEntry) {
  let inside = pointInPoly(start, other);
  let cur = start;
  do {
    if (cur.intersect) { cur.entry = wantEntry ? !inside : inside; inside = !inside; }
    cur = cur.next;
  } while (cur !== start);
}
function trace(start, op) {
  const out = [];
  let cur = start, forward = true;
  const guard = 10000; let n = 0;
  do {
    cur.visited = true;
    out.push(pt(cur.x, cur.y));
    const useSubject = op === 'intersect' ? cur.entry : op === 'union' ? !cur.entry : cur.entry;
    if (cur.intersect) { cur = cur.neighbor; cur.visited = true; forward = op === 'subtract' ? !useSubject : useSubject; }
    cur = forward ? cur.next : cur.prev;
    if (++n > guard) break;
  } while (cur !== start && n < guard);
  return dedupe(out);
}
function fillPoly(mask, W, H, poly, ox, oy, scale) {
  const pts = poly.map(p => ({ x: (p.x - ox) * scale, y: (p.y - oy) * scale }));
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    if (y < 0 || y >= H) continue;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j], b = pts[i];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) mask[y * W + x] = 1;
    }
  }
}
function traceMask(mask, W, H, ox, oy, scale) {
  const seen = new Uint8Array(W * H);
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const polys = [];
  const empty = (x, y) => x < 0 || y < 0 || x >= W || y >= H || !mask[y * W + x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x] || seen[y * W + x] || !empty(x - 1, y)) continue;
    const poly = [];
    let cx = x, cy = y, dir = 0, guard = 0;
    do {
      seen[cy * W + cx] = 1;
      if (!poly.length || poly[poly.length - 1].x !== cx || poly[poly.length - 1].y !== cy) poly.push(pt(ox + (cx + 0.5) / scale, oy + (cy + 0.5) / scale));
      let found = false;
      for (let k = 0; k < 8; k++) {
        const nd = (dir + 6 + k) % 8;
        const nx = cx + dirs[nd][0], ny = cy + dirs[nd][1];
        if (!empty(nx, ny)) { cx = nx; cy = ny; dir = nd; found = true; break; }
      }
      if (!found || ++guard > W * H) break;
    } while (!(cx === x && cy === y) && guard < W * H + 2);
    const slim = [];
    for (let i = 0; i < poly.length; i += Math.max(1, Math.floor(poly.length / 180))) slim.push(poly[i]);
    if (slim.length >= 3) polys.push(dedupe(slim));
  }
  return polys;
}
function rasterBoolean(subject, clip, op) {
  const all = subject.concat(clip);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const scale = 4;
  const ox = minX - 1, oy = minY - 1;
  const W = Math.max(2, Math.ceil((maxX - minX + 2) * scale));
  const H = Math.max(2, Math.ceil((maxY - minY + 2) * scale));
  if (W * H > 4_000_000) throw new Error('that shape is too large to combine');
  const A = new Uint8Array(W * H), B = new Uint8Array(W * H);
  fillPoly(A, W, H, subject, ox, oy, scale);
  fillPoly(B, W, H, clip, ox, oy, scale);
  const M = new Uint8Array(W * H);
  for (let i = 0; i < M.length; i++) M[i] = op === 'union' ? (A[i] | B[i]) : op === 'intersect' ? (A[i] & B[i]) : (A[i] & (B[i] ? 0 : 1));
  return traceMask(M, W, H, ox, oy, scale);
}
function booleanOne(subject, clip, op) {
  subject = dedupe(ensureWinding(subject, true));
  clip = dedupe(ensureWinding(clip, true));
  if (subject.length < 3 || clip.length < 3) return [];
  return rasterBoolean(subject, clip, op);
}
function pathFromPolys(polys, fill) {
  const d = polys.filter(p => p.length >= 3).map(p => 'M ' + p.map(q => `${round(q.x)} ${round(q.y)}`).join(' L ') + ' Z').join(' ');
  return { type: 'path', d, fill: fill || '#39C5BB', fillRule: 'evenodd', stroke: 'none', width: 0, polygons: polys };
}
function round(n) { return Math.round(n * 1000) / 1000; }
function ellipsePoly(s, steps = 32) {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2, rx = Math.abs(s.w) / 2, ry = Math.abs(s.h) / 2;
  const pts = [];
  for (let i = 0; i < steps; i++) { const a = (i / steps) * Math.PI * 2; pts.push(pt(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)); }
  return pts;
}
function rectPoly(s) { return [pt(s.x, s.y), pt(s.x + s.w, s.y), pt(s.x + s.w, s.y + s.h), pt(s.x, s.y + s.h)]; }
function parsePath(d) {
  const tokens = String(d || '').match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const polys = []; let cur = [], cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
  const num = () => +tokens.shift();
  while (tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[0])) cmd = tokens.shift();
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M') { if (cur.length >= 3) polys.push(cur); cur = []; cx = (rel ? cx : 0) + num(); cy = (rel ? cy : 0) + num(); sx = cx; sy = cy; cur.push(pt(cx, cy)); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { cx = (rel ? cx : 0) + num(); cy = (rel ? cy : 0) + num(); cur.push(pt(cx, cy)); }
    else if (C === 'H') { cx = (rel ? cx : 0) + num(); cur.push(pt(cx, cy)); }
    else if (C === 'V') { cy = (rel ? cy : 0) + num(); cur.push(pt(cx, cy)); }
    else if (C === 'Z') { if (cur.length) cur.push(pt(sx, sy)); if (cur.length >= 3) polys.push(dedupe(cur)); cur = []; cx = sx; cy = sy; }
    else break;
  }
  if (cur.length >= 3) polys.push(dedupe(cur));
  return polys;
}
function shapePolys(s) {
  if (!s) return [];
  if (s.type === 'rect') return [rectPoly(s)];
  if (s.type === 'ellipse') return [ellipsePoly(s)];
  if (s.type === 'path') return s.polygons && s.polygons.length ? s.polygons : parsePath(s.d);
  return [];
}
function booleanShapes(op, a, b) {
  const A = shapePolys(a), B = shapePolys(b);
  if (!A.length || !B.length) throw new Error('both shapes need an outline');
  let polys = [];
  for (const pa of A) for (const pb of B) polys = polys.concat(booleanOne(pa, pb, op));
  polys = polys.filter(p => p.length >= 3 && Math.abs(signed(p)) > 1e-4);
  const total = polys.reduce((n, p) => n + signed(p), 0);
  return { ...pathFromPolys(polys, a.fill || b.fill), area: Math.abs(total) };
}
module.exports = { booleanShapes, area: signed, parsePath, shapePolys, pointInPoly };
