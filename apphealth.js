// fiaOS Apple Health (browser side). Data arrives from each person's iPhone Shortcut at /api/health/ingest (server keeps
// 90 days); this file only reads /api/health/data and /api/health/setup. Calm: no motion, no sound.
// Feeds: Health card (Stage + Workouts), household summary, the workout suggestion (recovery / short sleep / evening
// walk), one morning-brief line, and Settings → Apple Health (personal link + QR + build steps).
(()=>{
const CK='fiaos.health';let HD=null,SETUP=null,SETMSG='',busy=false;
try{HD=JSON.parse(localStorage.getItem(CK)||'null')}catch{HD=null}
const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
async function load(){if(busy||!PROXY.ok)return;busy=true;
 try{const r=await fetch('/api/health/data?days=14&t='+Date.now(),{cache:'no-store'});if(!r.ok)return;const j=await r.json(),was=JSON.stringify(HD);
  HD=j;localStorage.setItem(CK,JSON.stringify(j));if(was!==JSON.stringify(j)&&quiet()&&['Stage','Workouts','Settings'].includes(view.tab))render()}
 catch{}finally{busy=false}}
const day=(p,d)=>(HD?.people?.[p]?.days||[]).find(x=>x.date===d)||null;
const has=v=>v!=null&&v!=='';
const k=n=>n>=10000?(n/1000).toFixed(0)+'k':n>=1000?(n/1000).toFixed(1)+'k':String(n);
const nf=n=>Math.round(n).toLocaleString('en-AU');
const ago=iso=>{if(!iso)return'never';const d=new Date(iso),t=today();const dd=d.toLocaleDateString('en-CA');const hm=d.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
 return dd===t?`today ${hm}`:dd===addDays(t,-1)?`yesterday ${hm}`:`${fmtD(dd)} ${hm}`};
window.healthDay=day;

// ---- workout suggestion: base (intake, exams) -> Apple Health -> weather (app.js workoutSuggestion) ----
const LOTS_MIN=45,LOTS_KCAL=650,LOW_SLEEP=6,LOW_STEPS=5000;
function adjust(p,w){const h=day(p,today());if(!h)return w;
 const hr=new Date().getHours(),logged=S.workouts.filter(x=>x.person===p&&x.date===today()).reduce((a,x)=>a+(+x.mins||0),0);
 const ex=Math.max(+h.exerciseMin||0,logged),kc=+h.activeKcal||0,sl=h.sleepHours,st=h.steps,front=[];
 const lots=ex>=LOTS_MIN||kc>=LOTS_KCAL,lowSleep=has(sl)&&sl<LOW_SLEEP,lowSteps=hr>=17&&has(st)&&st<LOW_STEPS;
 if(lots){w.type=lowSteps?'Recovery walk + stretch':'Recovery · stretch & mobility';w.intensity='Low';w.mins=20;
  front.push(ex>=LOTS_MIN?`already ${ex} min of exercise today — time to recover`:`${nf(kc)} active kcal burned today — time to recover`)}
 else if(lowSteps){w.type='Brisk walk';w.intensity=lowSleep||w.intensity==='Low'?'Low':'Moderate';w.mins=30;
  front.push(`only ${nf(st)} steps so far this evening — a walk would help`)}
 if(!lots&&lowSleep){const before=w.intensity;
  if(before==='High'){w.intensity='Moderate';w.type=w.type.replace(/Cardio \/ HIIT/,'Steady cardio')}
  else if(before==='Moderate'&&!lowSteps){w.intensity='Low';if(!/walk|mobility|yoga|stretch/i.test(w.type))w.type='Light '+w.type.charAt(0).toLowerCase()+w.type.slice(1)}
  if(!lowSteps)w.mins=Math.max(15,Math.round(w.mins*.75));front.push(`only ${sl} h sleep last night — taking it easier`)}
 w.why=[...front,...w.why];w.health=true;return w}
const _bw=baseWorkout;baseWorkout=function(p){const w=_bw(p);try{return adjust(p,w)}catch(e){console.warn('health',e);return w}};

// ---- UI pieces ----
function spark(p,wd=150,ht=36){const pts=[];for(let i=6;i>=0;i--){const d=addDays(today(),-i),h=day(p,d);pts.push({d,v:h&&has(h.steps)?+h.steps:null})}
 const vals=pts.map(x=>x.v).filter(v=>v!=null);if(!vals.length)return'<span class="mute hsp-none">no steps yet this week</span>';
 const mx=Math.max(8000,...vals),pad=4,X=i=>pad+i*(wd-2*pad)/6,Y=v=>ht-pad-(v/mx)*(ht-2*pad);
 const segs=[];let cur=[];pts.forEach((x,i)=>{if(x.v==null){if(cur.length)segs.push(cur);cur=[]}else cur.push(`${X(i).toFixed(1)},${Y(x.v).toFixed(1)}`)});if(cur.length)segs.push(cur);
 const goal=Y(8000).toFixed(1),title=pts.map(x=>`${fmtD(x.d)}: ${x.v==null?'—':nf(x.v)}`).join('\n');
 return`<svg class="hsp" viewBox="0 0 ${wd} ${ht}" width="${wd}" height="${ht}" role="img" aria-label="Steps, last 7 days"><title>${esc(title)}</title>
 <line x1="${pad}" x2="${wd-pad}" y1="${goal}" y2="${goal}" stroke="#86CECB" stroke-opacity=".25" stroke-dasharray="3 3"/>
 ${segs.map(s=>s.length>1?`<polyline points="${s.join(' ')}" fill="none" stroke="#39C5BB" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`:'').join('')}
 ${pts.map((x,i)=>x.v==null?'':`<circle cx="${X(i).toFixed(1)}" cy="${Y(x.v).toFixed(1)}" r="${i===6?3:2}" fill="${i===6?'#E12885':'#86CECB'}"/>`).join('')}</svg>`}
const stat=(v,l,u='')=>`<div class="hst"><b>${has(v)?v:'—'}${has(v)&&u?`<small> ${u}</small>`:''}</b><span>${l}</span></div>`;
function healthCard(p){const h=day(p,today()),last=HD?.people?.[p]?.last;
 if(!HD&&!PROXY.ok)return'';
 if(!last)return card(`❤️ ${p} · Health`,`<p class="mute">No Apple Health data yet. Set up ${p}'s iPhone Shortcut in Settings → Apple Health (via Shortcuts).</p>`,'health');
 return card(`❤️ ${p} · Health`,`<div class="hrow">${stat(h&&has(h.steps)?nf(h.steps):null,'steps today')}${stat(h?.activeKcal,'active',h&&has(h.activeKcal)?'kcal':'')}${stat(h?.exerciseMin,'exercise',h&&has(h.exerciseMin)?'min':'')}${stat(h?.sleepHours,'sleep last night',h&&has(h.sleepHours)?'h':'')}${h&&has(h.restingHR)?stat(h.restingHR,'resting HR','bpm'):''}</div>
 <div class="hfoot">${spark(p)}<small class="mute">steps · last 7 days<br>updated ${ago(last)}</small></div>`,'health')}
function healthSummary(){if(!HD&&!PROXY.ok)return'';const any=PEOPLE.some(p=>HD?.people?.[p]?.last);
 if(!any)return card('❤️ Health',`<p class="mute">No Apple Health data yet. Each person can set up their iPhone Shortcut in Settings → Apple Health (via Shortcuts).</p>`,'health');
 return card('❤️ Health · everyone',`<table class="hsum"><tr><th></th><th>Steps</th><th>Active</th><th>Exercise</th><th>Sleep</th><th>7 days</th></tr>${PEOPLE.map(p=>{const h=day(p,today()),L=HD?.people?.[p]?.last;
  return`<tr><td>${typeof ptag==='function'?ptag(p):p}</td>${L?`<td>${h&&has(h.steps)?nf(h.steps):'—'}</td><td>${h&&has(h.activeKcal)?h.activeKcal+' kcal':'—'}</td><td>${h&&has(h.exerciseMin)?h.exerciseMin+' min':'—'}</td><td>${h&&has(h.sleepHours)?h.sleepHours+' h':'—'}</td><td>${spark(p,96,24)}</td>`:'<td colspan="5" class="mute">not set up yet</td>'}</tr>`}).join('')}</table>`,'wide health')}
const healthFor=()=>view.person==='Household'?healthSummary():healthCard(view.person);
// morning brief: one line. Sleep = last night (today's record), steps = yesterday.
window.healthBriefLine=p=>{const t=day(p,today()),y=day(p,addDays(today(),-1)),a=[];
 if(t&&has(t.sleepHours))a.push(`😴 Slept ${t.sleepHours} h`);if(y&&has(y.steps))a.push(`👟 ${nf(y.steps)} steps yesterday`);
 return a.length?`<div class="bbin bhl">${a.join(' · ')}</div>`:''};
window.healthBriefHH=()=>{const a=PEOPLE.map(p=>{const t=day(p,today()),y=day(p,addDays(today(),-1)),x=[];if(t&&has(t.sleepHours))x.push(`${t.sleepHours} h`);if(y&&has(y.steps))x.push(`${k(y.steps)} steps`);return x.length?`${p} ${x.join(' / ')}`:''}).filter(Boolean);
 return a.length?`<div class="bbin bhl">😴 Sleep · steps yesterday: ${a.join(' · ')}</div>`:''};

// ---- Settings: Apple Health (via Shortcuts) ----
const STEPS=[
 ['Build the shortcut (on the person\'s own iPhone)',[
  'Open <b>Shortcuts</b>, go to the <b>Shortcuts</b> tab and tap <b>+</b>. Tap the name at the top, choose <b>Rename</b> and call it <b>fiaOS Health</b>.',
  '<b>Steps:</b> tap <b>Search Actions</b>, add <b>Find Health Samples</b>. Tap <b>Type</b> → <b>Steps</b>. In the <b>Start Date</b> row tap <b>is in the last</b> → <b>is today</b>. Tap <b>Group By</b> → <b>Day</b>.',
  'Add <b>Calculate Statistics</b>, tap <b>Average</b> → <b>Sum</b>. Then add <b>Set Variable</b> and name it <b>Steps</b>.',
  '<b>Active energy:</b> add <b>Find Health Samples</b> again: <b>Type</b> → <b>Active Energy</b>, <b>Start Date is today</b>, <b>Group By</b> → <b>Day</b>. Add <b>Calculate Statistics</b> → <b>Sum</b>, then <b>Set Variable</b> named <b>Kcal</b>.',
  '<b>Exercise:</b> the same again with <b>Type</b> → <b>Exercise Minutes</b>, <b>Start Date is today</b>, <b>Group By</b> → <b>Day</b>, <b>Calculate Statistics</b> → <b>Sum</b>, <b>Set Variable</b> named <b>Exercise</b>.',
  '<b>Sleep (last night):</b> add <b>Find Health Samples</b>: <b>Type</b> → <b>Sleep Analysis</b>. Set <b>Start Date</b> → <b>is in the last</b> <b>24</b> <b>hours</b>. Tap <b>Add Filter</b> → <b>Value</b> <b>is not</b> <b>In Bed</b>, and <b>Add Filter</b> again → <b>Value</b> <b>is not</b> <b>Awake</b>. Leave <b>Group By</b> as <b>None</b>.',
  'Add <b>Get Details of Health Samples</b> and tap <b>Detail</b> → <b>Duration</b>. Add <b>Calculate Statistics</b> → <b>Sum</b>, then <b>Set Variable</b> named <b>Sleep</b>. (fiaOS works out whether it\'s seconds, minutes or hours.)',
  '<i>Optional</i>, resting heart rate: <b>Find Health Samples</b>, <b>Type</b> → <b>Resting Heart Rate</b>, <b>Start Date is today</b>, <b>Sort by</b> → <b>Start Date</b>, <b>Order</b> → <b>Latest First</b>, turn on <b>Limit</b> and set it to <b>1</b>. Then <b>Set Variable</b> named <b>RestingHR</b>.',
  'Add <b>Get Contents of URL</b>. Tap <b>URL</b> and paste this person\'s link from above (scan the QR code with the iPhone Camera, then tap <b>Copy link</b>).',
  'Tap the <b>›</b> arrow on that action to show more. Set <b>Method</b> → <b>POST</b> and <b>Request Body</b> → <b>JSON</b>.',
  'Tap <b>Add new field</b> → <b>Number</b> four times (five with resting HR) and fill in Key / Value: <code>steps</code> → <b>Steps</b>, <code>activeKcal</code> → <b>Kcal</b>, <code>exerciseMin</code> → <b>Exercise</b>, <code>sleepHours</code> → <b>Sleep</b>, <code>restingHR</code> → <b>RestingHR</b>. To pick a variable, tap the Value box and choose it from the bar above the keyboard. If the Health app shows energy in <b>kJ</b>, use the key <code>activeKJ</code> instead of <code>activeKcal</code>. If a Number field won\'t take a variable, use a <b>Text</b> field instead; fiaOS reads both.',
  'Tap <b>▶</b> to test. Allow access to Health (turn on Steps, Active Energy, Exercise Minutes, Sleep and Resting Heart Rate) and allow it to connect to devices on your local network. The result should say <b>✅ Saved …</b>, and “Last data” on this card updates.']],
 ['Make it run by itself',[
  'In Shortcuts, open the <b>Automation</b> tab and tap <b>+</b> (or <b>New Automation</b>).',
  'Choose <b>Time of Day</b>. Set the time to <b>9:00 pm</b>, <b>Repeat</b> → <b>Daily</b>, and choose <b>Run Immediately</b>. Tap <b>Next</b>.',
  'Pick <b>fiaOS Health</b>. Done.',
  '<i>Optional:</i> add another one at <b>7:00 am</b> so last night\'s sleep is in the morning brief.']],
 ['Good to know',[
  'The iPhone has to be on the home Wi-Fi, because fiaOS only listens at home.',
  'iOS locks Health data while the iPhone is locked, so a 9 pm run on a locked phone can\'t read anything and fiaOS gets nothing. If “Last data” stays old, add an automation with <b>App</b> → an app you open every evening → <b>Is Opened</b> → <b>Run Immediately</b> → <b>fiaOS Health</b>. Sending twice in a day is fine, because the newest numbers replace the older ones.',
  'If fiaOS shows more steps than the Health app (iPhone and Watch both counting), tap <b>Add Filter</b> on the Steps action → <b>Source</b> <b>is</b> → choose the Apple Watch.',
  'Each link belongs to one person. Keep it private, and don\'t share a shortcut that has the link in it.']]];
window.HEALTH_STEPS=STEPS;
const stepsHtml=()=>STEPS.map(([t,l])=>`<h4>${t}</h4><ol>${l.map(x=>`<li>${x}</li>`).join('')}</ol>`).join('');
async function loadSetup(){if(!PROXY.ok)return;try{const r=await fetch('/api/health/setup',{cache:'no-store',headers:{'X-FiaOS':'1'}});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);SETUP=j;SETMSG=''}catch(e){SETMSG='⚠ '+e.message}if(view.tab==='Settings'&&quiet())render()}
window.healthCopy=(id,btn)=>{const t=document.getElementById(id);if(!t)return;const done=()=>{btn.textContent='Copied ✓';setTimeout(()=>btn.textContent='Copy',2000)};
 if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t.value).then(done,()=>{t.select();document.execCommand('copy');done()});else{t.removeAttribute('readonly');t.select();t.setSelectionRange(0,9999);try{document.execCommand('copy');done()}catch{}t.setAttribute('readonly','')}};
const qr=t=>{try{const q=qrcode(0,'M');q.addData(t);q.make();return q.createSvgTag({cellSize:6,margin:4,scalable:true})}catch{return''}};
function setupCard(){
 if(!PROXY.ok)return card('❤️ Apple Health (via Shortcuts)','<p class="mute">Needs the fiaOS server.</p>','wide');
 if(!SETUP){if(!SETMSG)loadSetup();return card('❤️ Apple Health (via Shortcuts)',`<p class="mute">${SETMSG?esc(SETMSG):'Loading…'}</p>`,'wide')}
 return card('❤️ Apple Health (via Shortcuts)',`<p>Each person's iPhone sends today's steps, active energy, exercise minutes and last night's sleep to fiaOS with a small Shortcut. Scan their QR code with the iPhone Camera to open their personal link, tap <b>Copy link</b>, and paste it into the Shortcut.</p>
 <div class="hsetup">${PEOPLE.map(p=>{const s=SETUP.people[p]||{},last=HD?.people?.[p]?.last||s.last;return`<div class="hperson"><h4>${p}</h4>
  <div class="hqr" aria-label="QR code of ${p}'s Health link">${qr(s.url||'')}</div>
  <textarea id="hurl-${p}" class="hurl" rows="3" readonly onclick="this.select()">${esc(s.url||'')}</textarea>
  <div class="row"><button class="sm" onclick="healthCopy('hurl-${p}',this)">Copy</button></div>
  <small class="mute">Last data: ${last?ago(last):'none yet'}</small></div>`}).join('')}</div>
 <p class="ex">Each link has a private code in it that identifies the person, so keep it to their own phone. Only works on the home Wi-Fi.</p>
 <details class="hhow"><summary>How to build the Shortcut on an iPhone (step by step)</summary>${stepsHtml()}</details>`,'wide')}

// ---- wire into views ----
const _St=VIEWS.Stage;VIEWS.Stage=()=>{const h=_St(),c=healthFor();if(!c)return h;const b=h.indexOf('class="card wide brief"');
 if(b<0)return c+h;const e=h.indexOf('</section>',b)+10;return h.slice(0,e)+c+h.slice(e)};
const _Wo=VIEWS.Workouts;VIEWS.Workouts=()=>healthFor()+_Wo();
const _Set=VIEWS.Settings;VIEWS.Settings=()=>{const h=_Set(),e=h.indexOf('</section>');return e<0?setupCard()+h:h.slice(0,e+10)+setupCard()+h.slice(e+10)};
(async()=>{try{await PROXY_READY}catch{}load()})();
setInterval(load,10*60e3);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')load()});
render();
})();
