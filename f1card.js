// fiaOS F1 (client) — Cam only. A quiet "Next F1 race" card on Stage listing every session, counting down to the NEXT session,
// plus a brief line on race weekends naming the next session(s) for that day/night. Times from /api/f1 (server caches 12 h), UTC.
// Data refresh every 6 h; the countdown text re-renders at most every 15 min. No sound, no motion.
(()=>{
let F1=null;const ME='Cam',H=36e5;
const idle=()=>view.person===ME&&view.tab==='Stage'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
async function f1Refresh(){if(!PROXY.ok)return;try{const r=await fetch('/api/f1?t='+Date.now(),{cache:'no-store'});if(r.ok){F1=await r.json();if(idle())render()}}catch{}}
const SHORT={'Practice 1':'FP1','Practice 2':'FP2','Practice 3':'FP3','Sprint Qualifying':'Sprint Quali','Sprint':'Sprint','Qualifying':'Quali','Race':'Race'};
const ms=x=>x.utc?new Date(x.utc).getTime():NaN;
const live=x=>{const t=ms(x),n=Date.now();return n>=t&&n<t+(x.name==='Race'?2:1)*H};
const nextSess=()=>(F1?.next?.sessions||[]).find(x=>x.utc&&ms(x)+(x.name==='Race'?2:1)*H>Date.now())||null;
const until=x=>{const h=(ms(x)-Date.now())/H;if(isNaN(h))return'';if(h<=0)return'on now';const m=Math.round(h*60);
 return m<60?`in ${m} min`:h<48?`in ${Math.floor(h)} h ${Math.round((h%1)*60)} min`:`in ${Math.round(h/24)} days`};
function f1Card(){if(view.person!==ME||!F1?.next)return'';const n=F1.next,ns=nextSess();
 const rows=(n.sessions||[]).map(x=>{const past=x.utc&&ms(x)+(x.name==='Race'?2:1)*H<=Date.now(),cur=ns&&x.name===ns.name;
  return`<li class="${past?'past':''}${cur?' cur':''}"><span class="bt">${SHORT[x.name]||esc(x.name)}</span>${cur||x.name==='Race'?'<b>':''}${esc(x.label||'TBC')}${cur||x.name==='Race'?'</b>':''}${cur?' <small>◀ next</small>':''}${past?' <small>done</small>':''}</li>`}).join('');
 return card('🏎️ Next F1 race',`<p class="f1n"><b>R${n.round} · ${esc(n.name)}</b> <small>${esc(n.place)}</small></p>
 ${ns?`<p class="f1next">Next up: <b>${esc(ns.name)}</b> · ${live(ns)?'on now':until(ns)}</p>`:''}<ul class="f1s">${rows}</ul>
 <p class="ex">UTC · ${esc(F1.source||'')}${F1.stale?' · offline copy':''}</p>`,'f1')}
// brief line: race weekend = from 24 h before the first session until 12 h after the race.
// Names the sessions still to come in the next ~24 h ("today/tonight"), else the next one.
const bd=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:'UTC'});
window.f1BriefLine=p=>{if(p!==ME||!F1?.next?.sessions?.length)return'';const S=F1.next.sessions.filter(x=>x.utc),now=Date.now();if(!S.length)return'';
 const first=ms(S[0]),last=ms(S[S.length-1]);if(now<first-24*H||now>last+12*H)return'';
 const up=S.filter(x=>ms(x)+(x.name==='Race'?2:1)*H>now);const n=F1.next;
 if(!up.length)return`<div class="bbin bf1">🏎️ ${esc(n.name)} is done for this weekend</div>`;
 const soon=up.filter(x=>ms(x)<now+24*H),L=(soon.length?soon:up.slice(0,1));
 const t=x=>`${SHORT[x.name]} ${live(x)?'on now':new Date(x.utc).toLocaleString('en-AU',{timeZone:'UTC',...(bd(ms(x))===bd(now)?{}:{weekday:'short'}),hour:'numeric',minute:'2-digit'})}`;
 return`<div class="bbin bf1">🏎️ ${esc(n.name)}: ${L.map(t).join(' · ')}</div>`};
window.f1Card=f1Card;
const _St=VIEWS.Stage;VIEWS.Stage=()=>{const h=_St(),c=f1Card();if(!c)return h;const b=h.indexOf('class="card wide brief"');
 if(b<0)return c+h;const e=h.indexOf('</section>',b)+10;return h.slice(0,e)+c+h.slice(e)};
(async()=>{try{await PROXY_READY}catch{}setTimeout(f1Refresh,1500)})();setInterval(f1Refresh,6*H);
setInterval(()=>{if(F1?.next&&idle())render()},15*60e3); // keep the countdown honest on an untouched screen
})();
