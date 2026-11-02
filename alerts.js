// fiaOS storm & fire alerts (server). Official public feeds only, no keys:
//  - Public bureau warnings RSS  https://www.bom.gov.au/fwo/IDZ00056.warnings_qld.xml  (every 10 min)
//  - Public fire-danger ratings, 4 days  https://www.bom.gov.au/fwo/IDQ13016.xml  -> "Demo District" (hourly)
//  - QFD current bushfire warnings  https://publiccontent-gis-psba-qld-gov-au.s3.amazonaws.com/content/Feeds/BushfireCurrentIncidents/bushfireAlert.json (every 10 min)
// Only the fictional Demo Harbour area is returned. severe:true = the app may play the one storm ding.
// GET /api/alerts -> {items:[{id,kind,title,detail,link,severe,issued}], fire:{district,today,tomorrow,issued}, checkedAt, errors}
// Fetched lazily (one request in flight, cached), so many screens polling never multiplies the load. LAN-only.
'use strict';
const HOME = { name: 'Demo Harbour', lat: +(process.env.FIAOS_LAT || -35), lon: +(process.env.FIAOS_LON || 149) };
const FIRE_DISTRICT = process.env.FIAOS_FIRE_DISTRICT || 'Demo District', NEAR_KM = 20;
const URLS = { bom: 'https://www.bom.gov.au/fwo/IDZ00056.warnings_qld.xml', fdr: 'https://www.bom.gov.au/fwo/IDQ13016.xml',
  qfd: 'https://publiccontent-gis-psba-qld-gov-au.s3.amazonaws.com/content/Feeds/BushfireCurrentIncidents/bushfireAlert.json' };
const TTL = { bom: 10 * 60e3, fdr: 60 * 60e3, qfd: 10 * 60e3 }, UA = { 'User-Agent': 'fiaOS/0.3 (personal household dashboard)' };
// local area words used in BOM warning titles (council areas, forecast/fire districts, nearby rivers)
const LOCAL = /\b(Demo Harbour|Demo Shire|Demo District|Demo Coast|Demo Plains|Demo River|Demo Creek|Demo Ridge|Demo Bend)\b/i;
const IGNORE = /Marine|Coastal Hazard|Hazardous Surf|Coastal Waters|Gale|Strong Wind Warning|Tide|Wind Warning Summary|Road Weather|Sheep Graziers/i;
const SEVERE = /Severe Thunderstorm|Severe Weather|Tropical Cyclone|Fire Weather Warning|Emergency/i;
const HIGH = ['High', 'Extreme', 'Catastrophic'];
const C = {}, inflight = {};
const stamp = () => new Date().toLocaleString('en-AU', { hour12: false });
const dec = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i')); return m ? dec(m[1]).replace(/\s+/g, ' ').trim() : '' };
async function get(k, parse) {
  const c = C[k]; if (c && Date.now() - c.at < TTL[k]) return c;
  if (inflight[k]) return inflight[k];
  inflight[k] = (async () => {
    try { const ac = new AbortController(), to = setTimeout(() => ac.abort(), 20e3);
      const r = await fetch(URLS[k], { headers: UA, signal: ac.signal }).finally(() => clearTimeout(to));
      if (!r.ok) throw new Error(`HTTP ${r.status}`); C[k] = { at: Date.now(), data: parse(await r.text()), error: null } }
    catch (e) { C[k] = { at: Date.now() - TTL[k] + 2 * 60e3, data: c?.data ?? null, error: `${k}: ${e.name === 'AbortError' ? 'timed out' : e.message}` }; console.log(`${stamp()} alerts ${C[k].error}`) } // retry in 2 min, keep last good copy
    finally { inflight[k] = null }
    return C[k];
  })();
  return inflight[k];
}
function parseBom(x) {
  return (x.match(/<item>[\s\S]*?<\/item>/gi) || []).map(it => { const raw = tag(it, 'title'), m = raw.match(/^(\d{1,2}\/\d{1,2}:\d{2})\s*\w*\s+(.*)$/);
    return { title: (m ? m[2] : raw).trim(), link: tag(it, 'link').replace(/^http:/, 'https:'), issued: new Date(tag(it, 'pubDate')).toISOString(), guid: tag(it, 'guid') } });
}
function parseFdr(x) {
  const issued = tag(x, 'issue-time-local'), a = x.match(new RegExp(`<area[^>]*description="${FIRE_DISTRICT}"[^>]*type="fire-district"[^>]*>([\\s\\S]*?)</area>`, 'i'));
  if (!a) return { issued, days: [] };
  const days = (a[1].match(/<forecast-period[\s\S]*?<\/forecast-period>/gi) || []).map(p => ({ date: (p.match(/start-time-local="(\d{4}-\d{2}-\d{2})/) || [])[1], rating: tag(p, 'text'), fbi: +((p.match(/fire_behaviour_index">(\d+)/) || [])[1] || 0) }));
  return { issued, days };
}
const km = (a, b, c, d) => { const R = 6371, r = x => x * Math.PI / 180, dl = r(c - a), dn = r(d - b), h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) };
function parseQfd(t) { const j = JSON.parse(t); return (j.features || []).map(f => f.properties || {}).filter(p => p.Latitude != null && p.Longitude != null)
  .map(p => ({ id: p.UniqueID || String(p.OBJECTID), level: p.WarningLevel || '', title: p.WarningTitle || 'Bushfire', area: p.WarningArea || p.Locality || '', status: p.CurrentStatus || '', text: p.CallToAction || p.Header || '', km: km(HOME.lat, HOME.lon, +p.Latitude, +p.Longitude), issued: p.PublishDateLocal_ISO || p.ItemDateTimeLocal_ISO || '' })) }
async function alerts() {
  const [b, f, q] = await Promise.all([get('bom', parseBom), get('fdr', parseFdr), get('qfd', parseQfd)]);
  const items = [], today = new Date().toLocaleDateString('en-CA'), tmr = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA') })();
  for (const w of b.data || []) { if (!LOCAL.test(w.title) || IGNORE.test(w.title) || /^(Cancellation|Final)\b/i.test(w.title)) continue;
    items.push({ id: 'bom:' + (w.guid || w.link) + '@' + w.issued, kind: 'bom', title: w.title.replace(/\s*\.\s*$/, ''), detail: 'Bureau of Meteorology', link: w.link, severe: SEVERE.test(w.title), issued: w.issued }) }
  const days = f.data?.days || [], fT = days.find(d => d.date === today) || null, fM = days.find(d => d.date === tmr) || null;
  if (fT && HIGH.includes(fT.rating)) items.push({ id: `fire:${today}:${fT.rating}`, kind: 'fire', title: `Fire danger today: ${fT.rating}`, detail: `${FIRE_DISTRICT} fire district (AFDRS)`, link: 'https://www.bom.gov.au/qld/forecasts/fire-danger-ratings.shtml', severe: fT.rating !== 'High', issued: f.data.issued });
  for (const x of q.data || []) { if (x.km > NEAR_KM || /^(Safe|Out|Patrolled)/i.test(x.status)) continue;
    items.push({ id: 'qfd:' + x.id + ':' + x.level, kind: 'bushfire', title: `${x.level || 'Bushfire'}: ${x.area || x.title}`.replace(/\b([A-Z]{2,})\b/g, s => s[0] + s.slice(1).toLowerCase()), detail: `QFD · about ${Math.round(x.km)} km away${x.status ? ' · ' + x.status.toLowerCase() : ''}`, text: x.text.slice(0, 300), link: 'https://www.fire.qld.gov.au/current-incidents', severe: /Watch and Act|Emergency/i.test(x.level), issued: x.issued }) }
  items.sort((a, z) => (z.severe - a.severe) || String(z.issued).localeCompare(String(a.issued)));
  return { home: HOME.name, items, fire: { district: FIRE_DISTRICT, today: fT, tomorrow: fM, issued: f.data?.issued || null }, counts: { bomQld: (b.data || []).length, qfdQld: (q.data || []).length },
    checkedAt: new Date(Math.min(b.at, f.at, q.at)).toISOString(), errors: [b.error, f.error, q.error].filter(Boolean), sources: URLS };
}
async function handle(req, res, u) {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)) };
  if (!/^(::1|127\.|::ffff:127\.|192\.168\.|::ffff:192\.168\.)/.test(req.socket.remoteAddress || '')) return send(403, { error: 'local only' });
  try { const r = await alerts();
    if (u.searchParams.get('test') === '1') r.items.unshift({ id: 'test:' + new Date().toISOString().slice(0, 13), kind: 'bom', title: 'TEST · Severe Thunderstorm Warning for parts of Demo Shire Council Area', detail: 'Sample only (?test=1) — not a real warning', link: 'https://www.bom.gov.au/qld/warnings/', severe: true, issued: new Date().toISOString(), test: true });
    return send(200, r) } catch (e) { return send(502, { error: e.message }) }
}
module.exports = { handle, alerts, _parse: { parseBom, parseFdr, parseQfd }, LOCAL, SEVERE };
