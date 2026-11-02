// Writes original SVG icons and the in-browser App Library page. No brand marks.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../..');
const iconDir = path.join(__dirname, 'icons');
const lines = fs.readFileSync(path.join(__dirname, 'apps.list'), 'utf8').trim().split('\n').filter(Boolean);
const apps = lines.map(line => {
  const [id, name, blurb, href, category] = line.split('|');
  return { id, name, blurb, href, category };
});
const g = {
  library: '<rect x="16" y="16" width="14" height="14" rx="3" fill="#39C5BB"/><rect x="34" y="16" width="14" height="14" rx="3" fill="#E12885"/><rect x="16" y="34" width="14" height="14" rx="3" fill="#86CECB"/><rect x="34" y="34" width="14" height="14" rx="3" fill="#F4D35E"/>',
  stage: '<circle cx="32" cy="32" r="14" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M26 24 l14 8-14 8z" fill="#E12885"/>',
  meals: '<path d="M18 30h28c0 10-6 16-14 16s-14-6-14-16z" fill="#39C5BB"/><path d="M24 22c2 4 4 4 8 0" fill="none" stroke="#E12885" stroke-width="2"/>',
  woolies: '<path d="M22 26h20l-2 16H24z" fill="none" stroke="#39C5BB" stroke-width="3"/><circle cx="26" cy="46" r="2" fill="#E12885"/><circle cx="38" cy="46" r="2" fill="#E12885"/>',
  workouts: '<rect x="18" y="28" width="8" height="12" rx="2" fill="#39C5BB"/><rect x="38" y="24" width="8" height="16" rx="2" fill="#E12885"/>',
  study: '<path d="M16 22h14v22H16zM34 22h14v22H34z" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M30 22v22" stroke="#E12885" stroke-width="2"/>',
  money: '<circle cx="32" cy="32" r="14" fill="none" stroke="#F4D35E" stroke-width="3"/><path d="M32 22v20M26 28h8a4 4 0 010 8h-6" fill="none" stroke="#39C5BB" stroke-width="2"/>',
  habits: '<path d="M18 34 l8 8 20-20" fill="none" stroke="#39C5BB" stroke-width="4" stroke-linecap="round"/>',
  week: '<g fill="#39C5BB">' + [0, 1, 2, 3, 4, 5, 6].map(i => `<circle cx="${16 + i * 5.5}" cy="32" r="2"/>`).join('') + '</g>',
  planner: '<rect x="16" y="18" width="32" height="28" rx="3" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M16 26h32" stroke="#E12885" stroke-width="2"/>',
  notes: '<path d="M20 16h18l10 10v22H20z" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M38 16v10h10" fill="none" stroke="#E12885" stroke-width="2"/>',
  mail: '<rect x="14" y="20" width="36" height="24" rx="3" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M16 22l16 12 16-12" fill="none" stroke="#E12885" stroke-width="2"/>',
  calendar: '<rect x="16" y="18" width="32" height="28" rx="3" fill="none" stroke="#39C5BB" stroke-width="3"/><circle cx="26" cy="34" r="2" fill="#E12885"/><circle cx="38" cy="34" r="2" fill="#86CECB"/>',
  media: '<circle cx="32" cy="32" r="14" fill="none" stroke="#39C5BB" stroke-width="3"/><circle cx="32" cy="32" r="4" fill="#E12885"/>',
  search: '<circle cx="28" cy="28" r="10" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M36 36l10 10" stroke="#E12885" stroke-width="3" stroke-linecap="round"/>',
  desk: '<rect x="14" y="16" width="36" height="24" rx="2" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M24 46h16M32 40v6" stroke="#E12885" stroke-width="3"/>',
  facet: '<path d="M32 14l14 8v16l-14 8-14-8V22z" fill="none" stroke="#39C5BB" stroke-width="3"/>',
  docs: '<path d="M20 16h24v32H20z" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M26 26h12M26 32h12M26 38h8" stroke="#E12885" stroke-width="2"/>',
  sheets: '<rect x="16" y="16" width="32" height="32" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M16 28h32M16 38h32M28 16v32" stroke="#E12885" stroke-width="2"/>',
  slides: '<rect x="18" y="22" width="28" height="18" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M22 18h24M26 46h12" stroke="#E12885" stroke-width="2"/>',
  paint: '<path d="M18 42c8-16 20-16 28-4" fill="none" stroke="#39C5BB" stroke-width="4" stroke-linecap="round"/><circle cx="44" cy="22" r="4" fill="#E12885"/>',
  draw: '<path d="M18 44 L32 16 L46 44 Z" fill="none" stroke="#39C5BB" stroke-width="3"/><circle cx="32" cy="36" r="3" fill="#E12885"/>',
  clip: '<rect x="16" y="22" width="32" height="20" rx="2" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M24 22v20M32 22v20M40 22v20" stroke="#E12885" stroke-width="2"/>',
  photo: '<circle cx="32" cy="32" r="10" fill="none" stroke="#39C5BB" stroke-width="3"/><circle cx="32" cy="32" r="4" fill="#E12885"/><rect x="18" y="18" width="28" height="28" rx="4" fill="none" stroke="#86CECB" stroke-width="2"/>',
  layout: '<rect x="18" y="14" width="28" height="36" fill="none" stroke="#39C5BB" stroke-width="3"/><rect x="22" y="18" width="12" height="8" fill="#E12885"/>',
  assets: '<rect x="16" y="20" width="32" height="24" rx="2" fill="none" stroke="#39C5BB" stroke-width="3"/><circle cx="26" cy="30" r="3" fill="#E12885"/><path d="M20 40l8-8 6 6 4-4 8 8" fill="none" stroke="#86CECB" stroke-width="2"/>',
  settings: '<circle cx="32" cy="32" r="6" fill="none" stroke="#39C5BB" stroke-width="3"/><path d="M32 14v6M32 44v6M14 32h6M44 32h6" stroke="#E12885" stroke-width="3" stroke-linecap="round"/>'
};
fs.mkdirSync(iconDir, { recursive: true });
for (const app of apps) {
  const inner = g[app.id];
  if (!inner) throw new Error('missing glyph ' + app.id);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${app.name}">\n  <rect width="64" height="64" rx="14" fill="#141820"/>\n  <rect x="2" y="2" width="60" height="60" rx="13" fill="none" stroke="#39C5BB" stroke-width="2"/>\n  ${inner}\n</svg>\n`;
  fs.writeFileSync(path.join(iconDir, 'fiaos-' + app.id + '.svg'), svg);
}
const tiles = apps.map(app => {
  const svg = fs.readFileSync(path.join(iconDir, 'fiaos-' + app.id + '.svg'), 'utf8').replace('<svg ', '<svg class="ico" ');
  return `<a class="tile" href="${app.href}"><span class="mark">${svg}</span><b>${app.name}</b><small>${app.blurb}</small></a>`;
}).join('\n');
const page = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FiaOS App Library</title>
<style>
:root{--t:#39C5BB;--p:#E12885;--bg:#070a14}
*{box-sizing:border-box}body{margin:0;font:18px system-ui,sans-serif;color:#e8fbfa;background:radial-gradient(ellipse at 50% 120%,#39c5bb33,transparent 60%),var(--bg)}
header{padding:20px 24px 0}h1{margin:0;color:var(--t);font-size:28px}h1 span{color:var(--p)}p.lead{color:#9fb3bd;max-width:42rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;padding:8px 24px 32px}
a.tile{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:16px;background:#101826;color:inherit;text-decoration:none;border:1px solid #39c5bb44;min-height:148px}
a.tile:focus{outline:2px solid var(--p);outline-offset:2px}a.tile small{color:#9fb3bd}
.mark{width:56px;height:56px}.ico{width:56px;height:56px}
</style></head><body>
<header><h1>Fia<span>OS</span> App Library</h1><p class="lead">Open an app in this window. On EllenOS, the desktop entries open each one in its own window.</p></header>
<main class="grid">${tiles}</main>
</body></html>
`;
fs.writeFileSync(path.join(root, 'apps.html'), page);
console.log('icons', apps.length, 'apps.html');
