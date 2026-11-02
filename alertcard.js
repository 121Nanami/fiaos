// fiaOS storm & fire alerts (client). Server: alerts.js (BOM warnings RSS, BOM fire danger ratings, QFD bushfire warnings).
// A calm strip at the top of every screen ONLY while something is active for the fictional Demo Harbour; nothing otherwise.
// The existing storm ding (fx.js) plays once per severe warning (severe thunderstorm / severe weather / fire weather warning /
// Extreme+ fire danger / Watch and Act+ bushfire within 20 km), never 9 pm – 7 am. No new sounds, no flashing.
// Checks every 10 min (server caches the feeds). Add #alerttest to the address to see a sample warning.
(()=>{
let AL=null;window.ALERTS=()=>AL;
const test=()=>/alerttest/.test(location.hash);
const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
async function load(){if(!PROXY.ok)return;try{const r=await fetch('/api/alerts?t='+Date.now()+(test()?'&test=1':''),{cache:'no-store'});if(!r.ok)return;const j=await r.json(),was=JSON.stringify(AL?.items),fw=JSON.stringify(AL?.fire);AL=j;
 ding();if((was!==JSON.stringify(j.items)||(view.tab==='Settings'&&fw!==JSON.stringify(j.fire)))&&quiet())render()}catch{}}
function ding(){const hr=new Date().getHours();if(hr<7||hr>=21)return;S.settings.alertDings??=[];const L=S.settings.alertDings;
 const n=(AL?.items||[]).find(i=>i.severe&&!L.includes(i.id));if(!n)return;L.push(n.id);S.settings.alertDings=L.slice(-60);localStorage.setItem(KEY,JSON.stringify(S));window.fxChime?.()}
const ICON={bom:'⛈',fire:'🔥',bushfire:'🔥'};
const t=s=>s?new Date(s).toLocaleString('en-AU',{weekday:'short',hour:'numeric',minute:'2-digit'}):'';
function bar(){const I=AL?.items||[];if(!I.length)return'';
 return`<div id="alertbar" class="${I.some(i=>i.severe)?'sev':''}" role="status">${I.slice(0,3).map(i=>`<div class="al"><span class="ai">${ICON[i.kind]||'⚠️'}</span><div><b>${esc(i.title)}</b><small>${esc(i.detail)}${i.issued?' · '+t(i.issued):''}</small></div><a href="${esc(i.link)}" target="_blank" rel="noopener">Details</a></div>`).join('')}${I.length>3?`<small class="more">+${I.length-3} more · Settings → Alerts</small>`:''}</div>`}
// strip goes first in <main> on every tab (re-added after each render; cheap)
const _r=window.render;window.render=function(){_r.apply(this,arguments);const h=bar();if(!h)return;const m=document.getElementById('main');if(m&&!document.getElementById('alertbar'))m.insertAdjacentHTML('afterbegin',h)};
render=window.render;
// brief: one line per active alert (up to 2)
(window.briefTop??=[]).push(()=>{const I=AL?.items||[];return I.slice(0,2).map(i=>`<div class="bbin balert">${ICON[i.kind]||'⚠️'} ${esc(i.title)}</div>`).join('')});
// Settings → Alerts (status + today's fire danger)
function alertsCard(){if(!AL)return card('⚠️ Storm & fire alerts','<p class="mute">Checking BOM and QFD…</p>');const f=AL.fire||{};
 return card('⚠️ Storm & fire alerts',`<p>${AL.items.length?`<b>${AL.items.length} active</b> for ${esc(AL.home)}`:`Nothing active for ${esc(AL.home)}.`}</p>
 <p>Fire danger (${esc(f.district||'')} district): today <b>${esc(f.today?.rating||'—')}</b> · tomorrow <b>${esc(f.tomorrow?.rating||'—')}</b></p>
 <p class="ex">Checked ${t(AL.checkedAt)} · BOM warnings and fire danger ratings (AFDRS) and QFD bushfire warnings within 20 km. A strip appears at the top only while something is active; the storm ding plays once for severe ones (not 9 pm–7 am).${(AL.errors||[]).length?` <span class="warn">${esc(AL.errors.join('; '))}</span>`:''}</p>`)}
window.alertsCard=alertsCard;
const _Set=VIEWS.Settings;VIEWS.Settings=()=>alertsCard()+_Set();
(async()=>{try{await PROXY_READY}catch{}setTimeout(load,1200)})();setInterval(load,10*60e3);
addEventListener('hashchange',load);
})();
