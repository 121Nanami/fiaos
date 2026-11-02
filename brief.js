// fiaOS Morning brief — one calm card at the top of Stage. No fetching of its own:
// reuses W (Open-Meteo, refreshed every 30 min by app.js) and GCAL (refreshed every 15 min by accounts.js).
(()=>{
const SLOTS=['Breakfast','Lunch','Dinner'];
const dayKey=()=>DAYS[(new Date().getDay()+6)%7];
function greet(){const h=new Date().getHours();return h<5?'Hello':h<12?'Good morning':h<17?'Good afternoon':'Good evening'}
const tm=s=>new Date(s).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
// ---- weather (today only) ----
function briefWeather(){
 if(!W)return'<small>Weather loading…</small>';if(W.error||!W.daily)return'<small>Weather unavailable right now.</small>';
 const d=W.daily,t=d.time?.[0],c=W.current||{},hi=Math.round(d.temperature_2m_max[0]),lo=Math.round(d.temperature_2m_min[0]),rp=d.precipitation_probability_max?.[0]??0;
 let storm=null;const h=W.hourly||{};(h.time||[]).some((x,i)=>{if(!String(x).startsWith(t))return false;const code=h.weather_code?.[i],cape=h.cape?.[i]||0;
  if([95,96,99].includes(code)||cape>=1500){if(new Date(x).getTime()>=Date.now()-36e5){storm=x;return true}}return false});
 return`<div class="bw"><b>${Math.round(c.temperature_2m??hi)}°</b> <span>${WMO[c.weather_code]||''}</span></div>
 <div>High ${hi}° · Low ${lo}° · ${rp}% chance of rain</div>
 ${storm?`<div class="bstorm">⛈ Storms possible from about ${tm(storm)}. Maybe plan indoor things for later.</div>`:''}
 <small>${esc(S.settings.loc?.name||'')}</small>`}
// ---- calendar (today) ----
function calToday(p){
 const L=GCAL[p];if(!L)return null;const seen=new Set();
 return(L.events||[]).filter(e=>String(e.start).slice(0,10)===today()&&kindOf(e.title||'')==='event'&&!seen.has(e.id)&&seen.add(e.id))
  .sort((a,b)=>String(a.start).localeCompare(String(b.start)))}
function calNote(p){
 if(!PROXY.ok)return'Calendar needs the fiaOS server running.';
 if(!GCAL[p])return'Calendar loading…';
 return''}
function calHtml(p){const ev=calToday(p),n=calNote(p);
 if(!ev)return`<li class="mute">${n||'Calendar loading…'}</li>`;
 const err=(GCAL[p].errors||[]).length?`<li class="mute">Some calendars couldn't be read.</li>`:'';
 return(ev.length?ev.map(e=>`<li>${e.allDay?'<span class="bt">All day</span>':`<span class="bt">${tm(e.start)}</span>`}${esc(e.title)}${e.person==='All'?' '+ptag('All'):''}</li>`).join(''):'<li class="mute">Nothing on the calendar today.</li>')+err}
// ---- study ----
const dueSoon=p=>[...S.assignments.filter(a=>a.person===p&&a.pct<100&&daysUntil(a.due)>=0&&daysUntil(a.due)<=3).map(a=>({d:a.due,t:`📝 ${esc(a.title)}${a.course?' <small>'+esc(a.course)+'</small>':''}`,x:`${a.pct}% done`})),
 ...S.exams.filter(e=>e.person===p&&daysUntil(e.date)>=0&&daysUntil(e.date)<=3).map(e=>({d:e.date,t:`🎓 ${esc(e.subject)}`,x:'exam'}))].sort((a,b)=>a.d.localeCompare(b.d));
const when=d=>{const n=daysUntil(d);return n===0?'today':n===1?'tomorrow':fmtD(d)};
const blocksToday=p=>studyBlocks().filter(b=>b.person===p&&b.date===today());
function studyHtml(p){const a=dueSoon(p),b=blocksToday(p);
 return(a.map(x=>`<li>${x.t} <span class="bt">due ${when(x.d)}</span> <small>${x.x}</small></li>`).join('')+b.map(x=>`<li>📚 ${esc(x.title)} <span class="bt">${x.hrs}h today</span></li>`).join(''))||'<li class="mute">Nothing due in the next 3 days.</li>'}
// ---- bills ----
const billsSoon=()=>S.bills.filter(b=>daysUntil(b.due)>=0&&daysUntil(b.due)<=3).sort((a,b)=>a.due.localeCompare(b.due));
function billsHtml(){const b=billsSoon();return b.length?b.map(x=>`<li>💳 ${esc(x.name)} ${aud(x.amount)} <span class="bt">due ${when(x.due)}</span> <small>${aud(x.amount/H())} each</small></li>`).join(''):'<li class="mute">No bills due in the next 3 days.</li>'}
// ---- meals / workout ----
const meals=p=>(S.mealPlan[p]?.[dayKey()]||[]).map((r,i)=>S.recipes[r]&&{slot:SLOTS[i]||'Meal',name:S.recipes[r].name}).filter(Boolean);
function mealsHtml(p){const m=meals(p);return m.length?m.map(x=>`<li><span class="bt">${x.slot}</span>${esc(x.name)}</li>`).join(''):'<li class="mute">No meals planned for today.</li>'}
function wk(p){try{return workoutSuggestion(p)}catch{return baseWorkout(p)}}
const wkLine=p=>{const w=wk(p);return`${esc(w.type)} · ${w.mins} min · ${w.intensity.toLowerCase()}`};
const sec=(t,b)=>`<div class="bsec"><h4>${t}</h4><ul>${b}</ul></div>`;
// ---- bins (fictional demo schedule: Monday general, recycling every 14 days) ----
S.settings.bins??={day:'Monday',recycleAnchor:'2026-01-05',greenAnchor:'',src:'Demo Shire collection — Demo Lane, Demo Harbour (example only)'};
const WD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const ymd=d=>d.toLocaleDateString('en-CA');
const dnum=s=>{const[y,m,d]=String(s).split('-').map(Number);return Date.UTC(y,m-1,d)/864e5};
const fortnightOn=(anchor,s)=>!!anchor&&/^\d{4}-\d{2}-\d{2}$/.test(anchor)&&(((Math.round(dnum(s)-dnum(anchor))%14)+14)%14===0);
function binsOn(s){const B=S.settings.bins;if(!B||!B.day)return null;const wd=WD[new Date(dnum(s)*864e5).getUTCDay()];if(wd!==B.day)return null;
 const L=['general'];if(fortnightOn(B.recycleAnchor,s))L.push('recycling');if(fortnightOn(B.greenAnchor,s))L.push('green waste');return L}
function nextBins(from=new Date()){const d=new Date(from);for(let i=0;i<15;i++){const s=ymd(d),b=binsOn(s);if(b)return{date:s,bins:b};d.setDate(d.getDate()+1)}return null}
const binTxt=b=>b.length>1?b.slice(0,-1).join(', ')+' + '+b[b.length-1]:b[0];
// evening before (from 5pm) and morning of (until noon) only
function binState(now=new Date()){const h=now.getHours();
 if(h>=17){const t=new Date(now);t.setDate(t.getDate()+1);const b=binsOn(ymd(t));if(b)return`🗑 Bins out tonight: ${binTxt(b)}`}
 if(h<12){const b=binsOn(ymd(now));if(b)return`🗑 Bin day today: ${binTxt(b)} <small>(kerbside before 6am)</small>`}
 return''}
const binLine=()=>{const t=binState();return t?`<div class="bbin">${t}</div>`:''};
// ---- packages: one quiet line only when something is out for delivery / arriving today / ready to collect ----
const PKW={'out for delivery':'out for delivery','arriving today':'arriving today','awaiting collection':'ready to collect'};
function pkgLine(){const L=(window.pkgLive?.()||[]);if(!L.length)return'';
 const t=L.slice(0,2).map(p=>`${esc(p.retailer||p.carrier)} ${PKW[p.status]}`).join(' · ')+(L.length>2?` · +${L.length-2} more`:'');
 return`<div class="bbin bpkg">📦 ${t}</div>`}
window.binsOn=binsOn;window.nextBins=nextBins;window.binState=binState;
window.saveBins=()=>{S.settings.bins={...S.settings.bins,day:$('#bday').value,recycleAnchor:$('#brec').value,greenAnchor:$('#bgrn').value};save()};
function binsCard(){const B=S.settings.bins,n=nextBins();
 return card('🗑 Bin day',`<p>Next collection: ${n?`<b>${fmtD(n.date)}</b> — ${binTxt(n.bins)}`:'not set'}</p>
 <label>Collection day<select id="bday">${opts(WD,B.day)}</select></label>
 <label>A recycling (yellow lid) day<input id="brec" type="date" value="${esc(B.recycleAnchor||'')}"></label>
 <label>A green-waste day (leave blank if no green bin)<input id="bgrn" type="date" value="${esc(B.greenAnchor||'')}"></label>
 <button onclick="saveBins()">Save</button><p class="ex">${esc(B.src||'')}. Recycling and green waste repeat every 14 days from the date given.</p>`)}
const _Set=VIEWS.Settings;VIEWS.Settings=()=>binsCard()+_Set();
// ---- card ----
function briefCard(){
 const P=who(),hh=view.person==='Household',date=new Date().toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'});
 const head=`<div class="bhead"><div><div class="bg">${greet()}, ${hh?'everyone':esc(P[0])}</div><div class="bd">${date}</div></div><div class="bwx">${briefWeather()}</div></div>`;
 let body;
 if(!hh){const p=P[0],w=wk(p);
  body=`<div class="bgrid">${sec('📆 Today',calHtml(p))}${sec('📚 Study',studyHtml(p))}${sec('🍱 Meals',mealsHtml(p))}${sec('💳 Bills',billsHtml())}</div>
  ${window.healthBriefLine?.(p)||''}${window.f1BriefLine?.(p)||''}${window.podBriefLine?.(p)||''}${(window.briefExtras||[]).map(f=>{try{return f(p)||''}catch{return''}}).join('')}<div class="bwk"><b>Move:</b> ${wkLine(p)} <small>${esc(w.why[0]||'')}</small></div>`}
 else{
  const allEv=[],seen=new Set();P.forEach(p=>(calToday(p)||[]).forEach(e=>{if(e.person==='All'&&!seen.has(e.id)){seen.add(e.id);allEv.push(e)}}));
  body=`<table class="bhh">${P.map(p=>{const ev=(calToday(p)||[]).filter(e=>e.person!=='All'),n=calNote(p),d=dueSoon(p),b=blocksToday(p),m=meals(p);
   return`<tr><td>${ptag(p)}</td><td>${ev.length?ev.slice(0,2).map(e=>`${e.allDay?'':tm(e.start)+' '}${esc(e.title)}`).join(', ')+(ev.length>2?` +${ev.length-2}`:''):`<span class="mute">${GCAL[p]?'No events':esc(n||'—')}</span>`}</td>
   <td>${d.length?`${d[0].t} <small>${when(d[0].d)}</small>${d.length>1?` <small>+${d.length-1}</small>`:''}`:b.length?`📚 ${b.length} study block${b.length>1?'s':''}`:'<span class="mute">Nothing due</span>'}</td>
   <td><small>${m.map(x=>esc(x.name)).join(' · ')||'—'}</small></td><td><small>${wkLine(p)}</small></td></tr>`}).join('')}</table>${window.healthBriefHH?.()||''}${(window.briefExtras||[]).map(f=>{try{return f('Household')||''}catch{return''}}).join('')}
  <div class="bgrid">${allEv.length?sec('📆 Everyone today',allEv.map(e=>`<li>${e.allDay?'<span class="bt">All day</span>':`<span class="bt">${tm(e.start)}</span>`}${esc(e.title)}</li>`).join('')):''}${sec('💳 Bills (next 3 days)',billsHtml())}</div>`}
 return`<section class="card wide brief">${head}${(window.briefTop||[]).map(f=>{try{return f(hh?'Household':P[0])||''}catch{return''}}).join('')}${binLine()}${pkgLine()}${body}</section>`}
window.briefCard=briefCard;
const _St=VIEWS.Stage;VIEWS.Stage=()=>briefCard()+_St();
// keep greeting/date fresh on an untouched screen: check every 15 min, re-render only when it actually changes
let k=greet()+today()+binState();setInterval(()=>{const n=greet()+today()+binState();if(n===k)return;k=n;
 if(view.tab==='Stage'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||''))render()},15*60e3);
render();
})();
