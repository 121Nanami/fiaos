// fiaOS podcasts (client) — Bea only. A quiet Mimikyu-styled "🎙️ MrBallen" card on Stage, with a "New episode" badge for episodes
// released since Bea last opened/dismissed the card (localStorage), plus one brief line when there's a new episode from the last 24 h.
// Data from /api/podcasts (server caches 30 min); refreshed every 30 min. No sound, no motion.
(()=>{
const ME='Bea',KEY='fiaos.podcasts.seen.'+ME,H=36e5;let P=null;
const idle=()=>view.person===ME&&view.tab==='Stage'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
const seen=()=>{const v=localStorage.getItem(KEY);if(v)return new Date(v).getTime();const t=Date.now()-3*864e5;localStorage.setItem(KEY,new Date(t).toISOString());return t};
const markSeen=()=>{localStorage.setItem(KEY,new Date().toISOString())};
const isNew=e=>new Date(e.released).getTime()>seen();
async function podRefresh(){if(!PROXY.ok)return;try{const r=await fetch('/api/podcasts?person='+ME+'&t='+Date.now(),{cache:'no-store'});if(r.ok){P=await r.json();if(idle())render()}}catch{}}
const safe=u=>/^https:\/\//.test(u||'')?u:'#';
window.podSeen=()=>{markSeen();render()};
window.podOpen=()=>{markSeen();setTimeout(()=>{if(idle())render()},400)}; // tapping Listen counts as opening it
function podCard(){if(view.person!==ME||!P?.episodes?.length)return'';
 const L=P.episodes.slice(0,4),n=P.episodes.filter(isNew).length;
 const row=(e,i)=>`<li class="${isNew(e)?'new':''}">${isNew(e)?'<span class="pnew">New episode</span> ':''}<b>${esc(e.title)}</b>
  <small>${esc(e.show)} · ${esc(e.dateLabel)}${e.duration?' · '+esc(e.duration):''}</small>
  ${i===0&&e.snippet?`<p class="psnip">${esc(e.snippet)}</p>`:''}
  <a class="plisten" href="${esc(safe(e.listen))}" target="_blank" rel="noopener" onclick="podOpen()">▶ Listen${e.listenVia==='Apple Podcasts'?' on Apple Podcasts':''}</a></li>`;
 return card('🎙️ MrBallen',`<ul class="pods">${L.map(row).join('')}</ul>
 <p class="ex">${n?`<button class="pdis" onclick="podSeen()">Mark ${n>1?'all ':''}seen</button> `:''}UTC · checks every 30 min${P.stale?' · offline copy':''}${P.notion?.url?` · <a href="${esc(safe(P.notion.url))}" target="_blank" rel="noopener">Notion list</a>`:''}</p>`,'pod')}
window.podBriefLine=p=>{if(p!==ME||!P?.episodes)return'';const e=P.episodes.find(x=>Date.now()-new Date(x.released)<24*H&&isNew(x));if(!e)return'';
 return`<div class="bbin bpod">🎙️ New MrBallen: <a href="${esc(safe(e.listen))}" target="_blank" rel="noopener" onclick="podOpen()">${esc(e.title)}</a> <small>${esc(e.dateLabel)}</small></div>`};
window.podCard=podCard;
const _St=VIEWS.Stage;VIEWS.Stage=()=>{const h=_St(),c=podCard();if(!c)return h;const b=h.indexOf('class="card wide brief"');
 if(b<0)return c+h;const e=h.indexOf('</section>',b)+10;return h.slice(0,e)+c+h.slice(e)};
(async()=>{try{await PROXY_READY}catch{}setTimeout(podRefresh,2000)})();setInterval(podRefresh,30*60e3);
})();
