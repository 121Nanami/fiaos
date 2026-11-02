// fiaOS ⇄ NotebookLM via Google Drive (client). Settings → 📓 NotebookLM card (status, Drive folder per student, Sync now, how-to)
// and a small "Open NotebookLM" card at the top of Study for Ada and Bea (not Cam). Server: notebooklm.js (/api/nlm/*).
// Also hands the server this device's uni items (so ones not in Notion yet still reach the docs). Calm: no sound, no motion.
(()=>{
const WHO=['Ada','Bea'];let NL=null,MSG='',BUSY=false;
const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
const on=t=>['Settings','Study'].includes(view.tab);
const local=()=>/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const when=s=>s?new Date(s).toLocaleString('en-AU',{weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'never';
const req=async(u,b)=>{const r=await fetch(u,b?{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-FiaOS':'1'},body:JSON.stringify(b)}:{cache:'no-store'});const j=await r.json().catch(()=>({error:'bad response'}));if(!r.ok)throw new Error(j.error||r.status);return j};
let LOADING=false;async function load(){if(!PROXY.ok||LOADING)return;LOADING=true;const prev=JSON.stringify(NL);try{NL=await req('/api/nlm/status');if(!BUSY)MSG=''}catch(e){MSG='⚠ '+e.message}LOADING=false;if(on()&&quiet()&&(JSON.stringify(NL)!==prev||MSG))render()} // redraw only on change
async function pushLocal(){if(!PROXY.ok)return;const people={};for(const p of WHO)people[p]={assignments:S.assignments.filter(a=>a.person===p&&!a.ex).map(a=>({nid:a.nid||'',title:a.title,course:a.course,due:a.due,pct:a.pct})),exams:S.exams.filter(e=>e.person===p&&!e.ex).map(e=>({nid:e.nid||'',subject:e.subject,course:e.course||'',date:e.date}))};
 try{await req('/api/nlm/local',{people})}catch{}}
async function syncNow(p){if(BUSY)return;BUSY=true;MSG='Syncing… (can take a minute)';render();
 try{await pushLocal();const j=await req('/api/nlm/sync',p?{person:p}:{});NL=j.status;
  MSG=Object.entries(j.result).map(([k,v])=>v.error?`${k}: ⚠ ${v.error}`:`${k}: ${v.changed.length?'updated '+v.changed.join(', '):'already up to date'}`).join(' · ')}
 catch(e){MSG='⚠ '+e.message}BUSY=false;render()}
window.nlmSync=syncNow;window.nlmLoad=load;
const STEPS=[
 'On a computer or the iPad, open <a href="https://notebooklm.google.com/" target="_blank" rel="noopener">notebooklm.google.com</a> and sign in with the same Google account shown above.',
 'Open the notebook (<b>Demo Science</b> for Ada, <b>Demo Letters</b> for Bea; make it with <b>+ Create new</b> if it isn\'t there yet).',
 'Tap <b>+ Add</b> (Add source) → <b>Google Drive</b>, open the person\'s folder (<b>fiaOS NotebookLM</b> → their notebook folder) and tick the docs: <b>Study plan &amp; deadlines</b>, <b>Notes from Notion</b> (and <b>Flashcard &amp; quiz log</b> once it appears). Tap <b>Insert</b>.',
 'fiaOS updates these same docs every 6 hours (or when you tap <b>Sync now</b>). NotebookLM doesn\'t refresh by itself: open a source in the Sources list and tap <b>Click to sync with Google Drive</b> (the ↻ sync icon) to pull the newest version.',
 'Don\'t edit the docs themselves. fiaOS replaces them at each sync, so change things in fiaOS or Notion instead. Leave the docs where they are (moving or renaming is fine, deleting isn\'t).'];
function personBox(p){const s=NL.people[p];if(!s)return'';
 const docs=s.docs.length?`<ul>${s.docs.map(d=>`<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a> <small class="mute">updated ${when(d.updated)}</small></li>`).join('')}</ul>`:'<p class="mute">No docs yet. They\'re made at the first sync.</p>';
 const fiaNote=p==='Bea'&&s.via&&s.via!=='Bea'?`<p class="ex">These docs are in ${s.account?esc(s.account)+'\'s':'the household'} Google Drive. To use them in Bea's own NotebookLM, share the <b>${esc(s.folderName)}</b> folder with Bea's Google account from Drive, or connect Bea's own Google in Accounts with <b>Drive</b> ticked (her folder is then made in her Drive).</p>`:'';
 return`<div class="hperson"><h4>${p} · ${esc(s.notebook)}</h4>
  <p>${s.drive?`✅ Drive: ${esc(s.account||'')}`:'— no Google Drive access yet'}${s.last?` · last sync ${when(s.last)}`:''}</p>
  ${s.folder?`<p><a class="tag" href="${esc(s.folder)}" target="_blank" rel="noopener">📁 ${esc(s.folderName)} ↗</a></p>`:''}${docs}
  ${s.error?`<p class="warn"><small>⚠ ${esc(s.error)}</small></p>`:''}${fiaNote}
  <p><small class="mute">Notion pages read: ${esc(s.pages.join(', ')||'(found at the first sync)')} · ${esc(s.lms)}: not connected yet</small></p></div>`}
function nlmCard(){
 if(!PROXY.ok)return card('📓 NotebookLM','<p class="mute">Needs the fiaOS server.</p>','wide');
 if(!NL){if(!MSG)load();return card('📓 NotebookLM',`<p class="mute">${MSG?esc(MSG):'Loading…'}</p>`,'wide')}
 const anyDrive=WHO.some(p=>NL.people[p]?.drive),ada=ACC?.people?.Ada?.google;
 const grant=anyDrive?'':`<div class="card" style="margin:8px 0"><p><b>One-time step: give fiaOS Google Drive access.</b> fiaOS can only see and change the files it makes itself (Google's <i>drive.file</i> permission), nothing else in your Drive.</p>
  ${local()?(ada?`<p><button onclick="gAddDrive('Ada')">Give fiaOS Drive access (Ada)</button></p><p><small class="mute">Opens Google in a new tab. Pick <b>${esc(ada.email||'Ada\'s account')}</b>, tap <b>Continue</b> and allow Google Drive. If the Google page keeps bouncing between screens, open the same link in Google Chrome instead: <code>http://localhost:8090/oauth/google/start?person=Ada&amp;add=drive</code></small></p>`:`<p>Connect Ada's Google in <b>Accounts</b> below with <b>Drive (NotebookLM docs)</b> ticked.</p>`)
   :`<p class="ex">Do this on the Mac: open <b>http://localhost:8090</b> → Settings → 📓 NotebookLM → <b>Give fiaOS Drive access</b>. Google sends you back to the Mac itself, so it won't finish on the iPad.</p>`}</div>`;
 return card('📓 NotebookLM (via Google Drive)',`<p>NotebookLM has no public connection for personal or Workspace accounts, so fiaOS keeps a few Google Docs per student in Drive (study plan &amp; deadlines, notes from Notion, flashcard &amp; quiz log). Add them to the notebook once as sources and they stay linked.</p>
 ${grant}<div class="hsetup">${WHO.map(personBox).join('')}</div>
 <div class="row"><button onclick="nlmSync()" ${BUSY||!anyDrive?'disabled':''}>${BUSY?'Syncing…':'↻ Sync now'}</button> <small class="mute">Auto-sync every ${NL.everyHours||6} h${NL.lastRun?' · last run '+when(NL.lastRun):''}</small></div>
 ${MSG?`<p><small>${esc(MSG)}</small></p>`:''}
 <details class="hhow"><summary>How to add the docs to NotebookLM</summary><ol>${STEPS.map(x=>`<li>${x}</li>`).join('')}</ol></details>`,'wide')}
const BOOK={Ada:'Demo Science',Bea:'Demo Letters'};
function studyCard(){const ps=who().filter(p=>WHO.includes(p));if(!ps.length)return'';
 return card('📓 NotebookLM',ps.map(p=>{const s=NL?.people?.[p],nb=S.settings.nlmBook?.[p];
  return`<p><b>${p}</b> · ${BOOK[p]} <a class="tag" href="${esc(nb||'https://notebooklm.google.com/')}" target="_blank" rel="noopener">Open NotebookLM ↗</a>${s?.folder?` <a class="tag" href="${esc(s.folder)}" target="_blank" rel="noopener">📁 Drive docs</a>`:''}
  <br><small class="mute">${s?.last?'Docs synced '+when(s.last)+' · in NotebookLM tap a source → sync to refresh':'Set up in Settings → 📓 NotebookLM'}</small>
  ${nb?'':`<br><input placeholder="paste the ${BOOK[p]} notebook link (optional)" onchange="(S.settings.nlmBook??={})['${p}']=this.value.trim();save()">`}</p>`}).join(''))}
window.nlmCard=nlmCard;
const _Set=VIEWS.Settings;VIEWS.Settings=()=>{const h=_Set(),e=h.indexOf('</section>');return e<0?nlmCard()+h:h.slice(0,e+10)+nlmCard()+h.slice(e+10)};
const _Stu=VIEWS.Study;VIEWS.Study=()=>studyCard()+_Stu();
(async()=>{try{await PROXY_READY}catch{}setTimeout(()=>{load();pushLocal()},2500)})();
setInterval(load,10*60e3);setInterval(pushLocal,60*60e3);
let lastVis=0;document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&on()&&Date.now()-lastVis>=30e3){lastVis=Date.now();load()}});
})();
