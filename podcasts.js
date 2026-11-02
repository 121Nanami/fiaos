// fiaOS podcasts (server). GET /api/podcasts?person=Bea -> latest episodes from that person's feeds (data/podcast-feeds.json).
// Public RSS only, no keys. Feeds cached 30 min (memory + data/podcasts-cache.json for offline). Apple Podcasts episode links come from
// the iTunes lookup API (matched by episode GUID, then title). Times shown in UTC.
// Notion: rows go into "🎙️ MrBallen episodes" on the person's home page (created once, latest ~20 kept). LAN-only like /api/acct/*.
'use strict';
const fs = require('fs'), path = require('path');
const DATA = process.env.FIAOS_DATA || path.join(__dirname, 'data');
const CONF = path.join(DATA, 'podcast-feeds.json'), CACHE = path.join(DATA, 'podcasts-cache.json'), STATE = path.join(DATA, 'podcasts.json');
const TTL = 30 * 60e3, KEEP = 20, NEW_DAYS = 7, UA = { 'User-Agent': 'fiaOS/0.2 (personal dashboard; podcast reader)' };
const DEFAULT_CONF = { Bea: { notionTitle: '🎙️ MrBallen episodes', feeds: [
  { show: 'MrBallen Podcast', title: 'MrBallen Podcast: Strange, Dark & Mysterious Stories', feed: 'https://feeds.simplecast.com/dloY8UYJ', appleId: 1608813794 },
  { show: "MrBallen's Medical Mysteries", title: "MrBallen's Medical Mysteries", feed: 'https://rss.art19.com/mrballens-medical-mysteries', appleId: 1709741912 } ] } };
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } };
const wr = (f, o) => { try { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1), { mode: 0o600 }); fs.renameSync(f + '.tmp', f) } catch (e) { console.log('podcasts: save', e.message) } };
function conf() { let c = rd(CONF, null); if (!c) { c = DEFAULT_CONF; wr(CONF, c) } return c }
const person = s => { const c = conf(), k = Object.keys(c).find(p => p.toLowerCase() === String(s || '').toLowerCase()); return k ? [k, c[k]] : [null, null] };

// ---- tiny RSS parsing (no deps) ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const dec = s => String(s || '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
const cdata = s => String(s || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i')); return m ? cdata(m[1]).trim() : '' };
const attr = (x, t, a) => { const m = x.match(new RegExp(`<${t}\\s[^>]*\\b${a}="([^"]*)"`, 'i')); return m ? dec(m[1]) : '' };
const strip = h => dec(String(h || '').replace(/<br\s*\/?>|<\/p>|<\/li>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const snip = (s, n = 220) => s.length > n ? s.slice(0, s.lastIndexOf(' ', n) > 120 ? s.lastIndexOf(' ', n) : n).replace(/[\s,.;:–-]+$/, '') + '…' : s;
function dur(s) { s = String(s || '').trim(); if (!s) return null; const p = s.split(':').map(Number); if (p.some(isNaN)) return null;
  const sec = p.reduce((a, v) => a * 60 + v, 0); return sec > 0 ? sec : null }
const durLabel = sec => { if (!sec) return ''; const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return h ? `${h} h ${m} min` : `${m} min` };
const utcStamp = d => ({ iso: new Date(d.getTime() + 0).toISOString().replace('.000Z', '+00:00'),
  label: d.toLocaleString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) });

async function apple(id) { // guid/title -> episode trackViewUrl (AU store)
  if (!id) return {}; try { const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=podcastEpisode&limit=60&country=AU`, { headers: UA });
    if (!r.ok) return {}; const j = await r.json(), m = {};
    for (const e of j.results || []) if (e.kind === 'podcast-episode' && e.trackViewUrl) { const u = e.trackViewUrl.replace(/[?&]uo=\d+/, ''); if (e.episodeGuid) m['g:' + e.episodeGuid] = u; m['t:' + String(e.trackName).toLowerCase().trim()] = u }
    return m } catch { return {} } }
async function loadFeed(f) {
  const [r, am] = await Promise.all([fetch(f.feed, { headers: UA, redirect: 'follow' }), apple(f.appleId)]);
  if (!r.ok) throw new Error(`${f.show}: feed ${r.status}`);
  const x = await r.text(), now = Date.now();
  return x.split(/<item[\s>]/i).slice(1, 41).map(it => { it = it.split(/<\/item>/i)[0];
    const t = strip(tag(it, 'title')), guid = strip(tag(it, 'guid')), pd = new Date(tag(it, 'pubDate'));
    if (!t || isNaN(pd) || pd.getTime() > now + 5 * 60e3) return null; // skip scheduled-but-unreleased
    const sec = dur(tag(it, 'itunes:duration')), link = strip(tag(it, 'link')), enc = attr(it, 'enclosure', 'url');
    const appleUrl = am['g:' + guid] || am['t:' + t.toLowerCase()] || '';
    const generic = !link || /^https?:\/\/[^/]+\/?$/.test(link); // e.g. a bare show homepage isn't an episode page
    return { show: f.show, title: t, guid: guid || t, released: pd.toISOString(), releasedUtc: utcStamp(pd).iso, dateLabel: utcStamp(pd).label, durationSec: sec, duration: durLabel(sec),
      snippet: snip(strip(tag(it, 'description') || tag(it, 'itunes:summary'))), listen: appleUrl || (!generic && link) || enc || link,
      listenVia: appleUrl ? 'Apple Podcasts' : !generic && link ? 'episode page' : enc ? 'audio file' : 'web' } }).filter(Boolean) }

const mem = {};
async function get(p, force) {
  const [who, c] = person(p); if (!who) throw Object.assign(new Error('no podcast feeds set up for ' + p), { code: 404 });
  const m = mem[who]; if (!force && m && Date.now() - new Date(m.fetchedAt) < TTL) return m;
  const res = await Promise.allSettled(c.feeds.map(loadFeed)), eps = [], errors = [];
  res.forEach((r, i) => r.status === 'fulfilled' ? eps.push(...r.value) : errors.push(`${c.feeds[i].show}: ${r.reason.message}`));
  if (!eps.length) { const old = m || rd(CACHE, {})[who]; if (old) return { ...old, stale: true, errors }; throw new Error(errors.join('; ') || 'no episodes') }
  eps.sort((a, b) => b.released.localeCompare(a.released));
  const out = { person: who, fetchedAt: new Date().toISOString(), feeds: c.feeds.map(f => ({ show: f.show, title: f.title, feed: f.feed })), episodes: eps.slice(0, 25), errors };
  mem[who] = out; const all = rd(CACHE, {}); all[who] = out; wr(CACHE, all); return out }

// ---- Notion: one database per person, filled by the server ----
let notion = null; const N = () => notion || (notion = require('./notion'));
let syncing = null;
async function ensureDb(who, c, st) {
  const { nf } = N(), homes = N().state().homes || {}, home = homes[who]; if (!home) throw new Error(`no Notion home page for ${who}`);
  st[who] ??= {};
  if (st[who].db) try { const d = await nf(`/databases/${st[who].db}`); if (!d.archived && !d.in_trash) return st[who].db } catch (e) { if (e.status !== 404) throw e }
  const t = c.notionTitle || '🎙️ Podcast episodes', name = t.replace(/^\S+\s/, '');
  const db = await nf('/databases', 'POST', { parent: { type: 'page_id', page_id: home }, is_inline: true, icon: { type: 'emoji', emoji: '🎙️' }, title: [{ type: 'text', text: { content: name } }],
    properties: { Title: { title: {} }, Show: { select: { options: c.feeds.map((f, i) => ({ name: f.show.replace(/,/g, ' '), color: ['purple', 'brown', 'yellow', 'gray'][i % 4] })) } },
      Released: { date: {} }, Link: { url: {} }, 'New?': { checkbox: {} } } });
  st[who] = { db: db.id, url: db.url, rows: {} };
  // short heading + link near the top (after the first block), since the API always puts new databases at the end of the page
  try { const kids = await N().children(home), first = kids[0]?.id;
    await nf(`/blocks/${home}/children`, 'PATCH', { ...(first ? { after: first } : {}), children: [
      { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: t } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'New MrBallen episodes land here by themselves (fiaOS checks every 30 minutes). “New?” means out in the last 7 days. Tap a Link to listen.' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: '↳ Open the list: ' } }, { type: 'mention', mention: { database: { id: db.id } } }, { type: 'text', text: { content: ' (it sits at the bottom of this page).' } }] } }] });
    st[who].heading = true } catch (e) { console.log('podcasts: heading', e.message) }
  wr(STATE, st); return db.id }
async function notionSync(who) {
  if (!process.env.NOTION_TOKEN) return { skipped: 'NOTION_TOKEN not set' };
  if (syncing) return syncing;
  syncing = (async () => { const st = rd(STATE, {}), [, c] = person(who), d = await get(who), { nf } = N();
    const db = await ensureDb(who, c, st), rows = st[who].rows ||= {}, keep = d.episodes.slice(0, KEEP), keepIds = new Set(keep.map(e => e.guid));
    let added = 0, updated = 0, removed = 0;
    for (const e of keep) { const isNew = Date.now() - new Date(e.released) < NEW_DAYS * 864e5, r = rows[e.guid];
      const props = { Title: { title: [{ type: 'text', text: { content: e.title.slice(0, 1900) } }] }, Show: { select: { name: e.show.replace(/,/g, ' ') } },
        Released: { date: { start: e.releasedUtc } }, Link: { url: e.listen || null }, 'New?': { checkbox: isNew } };
      if (!r) { const pg = await nf('/pages', 'POST', { parent: { database_id: db }, properties: props }); rows[e.guid] = { id: pg.id, isNew, link: e.listen }; added++ }
      else if (r.isNew !== isNew || r.link !== e.listen) { try { await nf(`/pages/${r.id}`, 'PATCH', { properties: props }); r.isNew = isNew; r.link = e.listen; updated++ } catch (x) { if (x.status === 404) delete rows[e.guid]; else throw x } } }
    for (const [g, r] of Object.entries(rows)) if (!keepIds.has(g)) { try { await nf(`/pages/${r.id}`, 'PATCH', { archived: true }) } catch { } delete rows[g]; removed++ }
    st[who].lastSync = new Date().toISOString(); wr(STATE, st);
    if (added || updated || removed) console.log(`${new Date().toLocaleString('en-AU', { hour12: false })} podcasts notion ${who}: +${added} ~${updated} -${removed}`);
    return { db: st[who].url, added, updated, removed } })();
  try { return await syncing } finally { syncing = null } }
async function tick() { for (const p of Object.keys(conf())) try { await get(p, true); await notionSync(p) } catch (e) { console.log('podcasts:', p, e.message) } }
function start() { setTimeout(tick, 20e3); setInterval(tick, TTL) }

async function handle(req, res, u, send) {
  const ip = req.socket.remoteAddress || ''; if (!/^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(ip)) return send(res, 403, { error: 'local only' });
  try { const d = await get(u.searchParams.get('person') || ''), st = rd(STATE, {})[d.person] || {};
    return send(res, 200, { ...d, now: new Date().toISOString(), notion: st.url ? { url: st.url, lastSync: st.lastSync || null } : null }) }
  catch (e) { return send(res, e.code || 502, { error: e.message }) } }
module.exports = { handle, start, get, notionSync, tick };
