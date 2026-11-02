// fiaOS accounts UI: Settings > Accounts, inbox cards, connected calendars in the Setlist, NotebookLM study card.
// The browser never sees tokens or passwords after submit: everything goes through /api/acct/* on the local server.
let ACC=null,MAIL={},GCAL={},NLM={},ACCMSG='',DEV=null;
const note=m=>{ACCMSG=m;(window.toast||(()=>{}))(m);render()};
const api=async(u,b)=>{const r=await fetch(u,b?{method:'POST',headers:{'Content-Type':'application/json','X-FiaOS':'1'},body:JSON.stringify(b)}:{});const j=await r.json().catch(()=>({error:'bad response'}));if(!r.ok)throw new Error(j.error||r.status);return j};
const qrSvg=(text,cell=5)=>{try{const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:cell,margin:2,scalable:true})}catch{return''}};
S.settings.nlm??={};S.mailSeen??=[];S.settings.mailOn??=true;
async function accRefresh(full){
 if(!PROXY.ok)return;
 const prev=JSON.stringify(ACC);
 try{ACC=await api('/api/acct/status')}catch(e){ACC=null;return}
 if(full)for(const p of PEOPLE){const s=ACC.people[p];
  api('/api/acct/mail?person='+p).then(j=>{MAIL[p]=j;render()}).catch(e=>{MAIL[p]={errors:[e.message],items:[],unread:0}});
  api('/api/acct/calendar?person='+p).then(j=>{GCAL[p]=j;mergeCal(p);render()}).catch(()=>{});
  if(s.notebooklm)api('/api/acct/notebooklm?person='+p).then(j=>{NLM[p]=j;render()}).catch(e=>{NLM[p]={error:e.message,notebooks:[]}});}
 if(full&&ACC.shared?.calendar&&S.settings.calEveryone)calAllRefresh();
 if(full||JSON.stringify(ACC)!==prev)render(); // only redraw when something actually changed
}
// shared household calendar: "everyone's events" view (?person=All)
function calAllRefresh(){api('/api/acct/calendar?person=All').then(j=>{GCAL.All=j;render()}).catch(()=>{})}
function calEveryone(on){S.settings.calEveryone=on;save();if(on&&!GCAL.All)calAllRefresh()}
function mergeCal(p){let n=0;(GCAL[p]?.events||[]).forEach(e=>{const k=kindOf(e.title),tag=e.source+':'+e.id,d=String(e.start).slice(0,10),wp=e.person||p;
 if(!PEOPLE.includes(wp))return; // [All]/#all events stay calendar-only (no exam/assignment per person)
 if(k==='exam'&&!S.exams.some(x=>x.src===tag)){S.exams.push({id:uid(),person:wp,subject:e.title,date:d,src:tag});n++}
 if(k==='assignment'&&!S.assignments.some(x=>x.src===tag)){S.assignments.push({id:uid(),person:wp,title:e.title,course:'(calendar)',due:d,pct:0,src:tag});n++}});
 if(n)localStorage.setItem(KEY,JSON.stringify(S))}
// small calm name tag in the person's avatar colour (same as the avatars in fx.js); "All" = everyone
const PTAG={Ada:'#86CECB',Bea:'#39C5BB',Cam:'#c98aa8',All:'#b7c3cf'};
const ptag=p=>{const c=PTAG[p]||'#86CECB';return`<span class="ptag" style="--pc:${c};background:${c}26;border-color:${c}80">${esc(p==='All'?'All':p)}</span>`};
// Setlist: add connected-calendar events (each person's view = their tags + All; toggle shows everyone's)
const _agenda=agenda;agenda=function(){const a=_agenda(),seen=new Set();
 const every=S.settings.calEveryone&&GCAL.All,lists=every?[GCAL.All]:who().map(p=>GCAL[p]);
 lists.forEach(L=>(L?.events||[]).forEach(e=>{const d=String(e.start).slice(0,10),k=e.source+':'+e.id;if(seen.has(k))return;seen.add(k);
  if(kindOf(e.title)==='event'&&daysUntil(d)>=0&&daysUntil(d)<=14)a.push({date:d,person:e.person||'',who:ptag(e.person||L.person),txt:`${e.source==='google'?'📆':'🗓'} ${esc(e.title)}${e.allDay?'':' · '+new Date(e.start).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}`})}));
 return a.sort((x,y)=>x.date.localeCompare(y.date))};
function calToggle(){if(!ACC?.shared?.calendar)return'';return`<p class="caltog"><label><input type=checkbox ${S.settings.calEveryone?'checked':''} onchange="calEveryone(this.checked)"> Show everyone's calendar events</label> <small>Shared calendar · tags: ${[...PEOPLE,'All'].map(ptag).join(' ')}</small></p>`}
// ---------- connect actions ----------
// Sign-in watcher: ONE at a time, checks 30 s apart (max 10 min), plus an instant check when the Google result tab reports back
// (postMessage from /oauth/google/callback) or when this window regains focus (still at most once per 30 s). Never reloads the page.
let WATCH=null;
function stopWatch(){if(WATCH){clearInterval(WATCH.iv);WATCH=null}}
function watchAcct(done,ok,fail){stopWatch();let n=0;const w={last:Date.now()};
 w.check=async()=>{if(WATCH!==w)return;w.last=Date.now();await accRefresh();if(WATCH!==w)return;if(done()){stopWatch();ok()}else if(++n>=20){stopWatch();fail?.()}};
 w.iv=setInterval(w.check,30e3);WATCH=w}
window.addEventListener('message',e=>{if(typeof e.data!=='string'||!e.data.startsWith('fiaos:google-'))return;if(WATCH)WATCH.check();else accRefresh(true)});
window.addEventListener('focus',()=>{if(WATCH&&Date.now()-WATCH.last>=30e3)WATCH.check()});
// Google sign-in opens in a normal tab via the server route (a plain link, so no popup blocker and no window juggling).
// It only works on the Mac itself: Google returns to http://127.0.0.1:8090/oauth/google/callback.
const gStartUrl=(p,add)=>`/oauth/google/start?person=${encodeURIComponent(p)}${add.length?'&add='+add.join(','):''}`;
function gConnect(p){const add=[];if($('#gw-'+p)?.checked)add.push('calendarWrite');if($('#gm-'+p)?.checked)add.push('gmail');if($('#gn-'+p)?.checked)add.push('notebooklm');if($('#gd-'+p)?.checked)add.push('drive');
 window.open(gStartUrl(p,add),'_blank');note('Finish signing in on the Google tab, then come back here.');
 watchAcct(()=>!!ACC?.people[p]?.google,()=>{note(p+' Google connected ✓');accRefresh(true)})}
// already connected: ask Google once more for the same access + Drive (drive.file = only files fiaOS creates).
function gAddDrive(p){window.open(gStartUrl(p,['drive']),'_blank');note('Approve Google Drive access on the Google tab, then come back here.');
 watchAcct(()=>!!ACC?.people[p]?.google?.drive,()=>{note(p+': Google Drive access added ✓');window.nlmLoad?.()})}
window.gAddDrive=gAddDrive;
async function msConnect(p){try{const j=await api('/api/acct/ms/start',{person:p});DEV={p,...j};render();
 watchAcct(()=>{const s=ACC?.people[p];return !!s?.microsoft||(s?.microsoftPending&&s.microsoftPending.status!=='waiting')},
  ()=>{const s=ACC?.people[p];if(s?.microsoft){DEV=null;note(p+' Microsoft connected ✓');accRefresh(true)}else{DEV={...DEV,...s.microsoftPending};render()}})}catch(e){note('Microsoft: '+e.message)}}
async function imapSave(p){const v=id=>$(`#${id}-${p}`).value;try{const j=await api('/api/acct/imap',{person:p,label:v('il')||'Email',host:v('ih'),port:+v('ip')||993,user:v('iu'),pass:v('iw')});note(`${p} email connected ✓ (${j.unread} unread)`);view.imap=null;accRefresh(true)}catch(e){note('IMAP: '+e.message)}}
async function disc(p,provider){if(!confirm(`Disconnect ${provider} for ${p}? Stored tokens are deleted from this device.`))return;await api('/api/acct/disconnect',{person:p,provider}).catch(()=>{});delete MAIL[p];delete GCAL[p];accRefresh(true)}
// ---------- Settings > Accounts ----------
function accountsCard(){
 if(!PROXY.ok)return card('👤 Accounts','<p>Accounts need the fiaOS server (<code>npm start</code> or the kiosk service). Opened as a file, only the ICS link works.</p>','wide');
 if(!ACC)return card('👤 Accounts','<p>Loading…</p>','wide');
 const c=ACC.configured,ok=b=>b?'✅':'—';
 const row=p=>{const s=ACC.people[p];return`<tr><td><b>${p}</b></td>
  <td>${s.google?`✅ ${esc(s.google.email||'')}<br><small>${['calendar','gmail','calendarWrite','drive','notebooklm'].filter(k=>s.google[k]).map(k=>({calendar:'Calendar (read)',gmail:'Gmail (read)',calendarWrite:'adds study blocks',drive:'Drive (NotebookLM docs)',notebooklm:'NotebookLM Ent.'}[k])).join(' · ')}</small><br>${s.google.drive?'':`<button onclick="gAddDrive('${p}')">➕ Drive access</button> `}<button onclick="disc('${p}','google')">Disconnect</button>`
   :'<small>Mail and the calendar are local. <button type="button" class="sm" onclick="view.tab=\'House\';if(window.HOUSE)HOUSE.mode=\'mail\';render()">Open Mail</button></small>'}</td>
  <td><small>Outlook sign-in is not used. The same mailbox is in House → Mail.</small></td>
  <td><small>IMAP is saved in House → Mail and copied onto this machine.</small></td>
  <td>${s.notebooklm?`✅ ${s.notebooklm==='enterprise'?'Enterprise API':'notebooklm-py (unofficial)'}`:'<small>not connected</small>'}</td></tr>`};
 const dev=DEV?`<div class="card" style="text-align:center"><h3>Connect ${DEV.p}'s Microsoft account</h3>${DEV.status==='error'||DEV.status==='expired'?`<p>❌ ${esc(DEV.error||'Code expired')}</p>${DEV.hint?`<p class="tag warn">${esc(DEV.hint)}</p>`:''}`:`<p>On your phone open <b>${esc(DEV.verification_uri)}</b> and enter</p><p style="font-size:2.4em;letter-spacing:.15em;color:var(--teal,#39C5BB)"><b>${esc(DEV.user_code)}</b></p><div style="width:180px;margin:auto;background:#fff;border-radius:12px;padding:6px">${qrSvg(DEV.verification_uri)}</div><p><small>Waiting for approval… (school accounts may need IT approval)</small></p>`}<button onclick="DEV=null;render()">Close</button></div>`:'';
 return card('👤 Accounts (per profile · tokens stay on this device)',`${dev}${ACC.mock?'<p class="tag warn">MOCK MODE (FIAOS_MOCK=1): fake accounts & data for testing</p>':''}
  <p>Mail and the calendar stay on this machine (House → Mail). Google and Microsoft sign-in are not used for them.</p>
  <table><tr><th>Profile</th><th>Mail & calendar</th><th>Was Microsoft</th><th>IMAP</th><th>NotebookLM</th></tr>${PEOPLE.map(row).join('')}</table>
  <p><small>Server config: Google ${ok(c.google)} · Microsoft ${ok(c.microsoft)} · NotebookLM Enterprise ${ok(c.notebooklmEnterprise)} · notebooklm-py ${ok(c.notebooklmCli)}. Setup steps: <code>ACCOUNTS-SETUP.md</code>. ${esc(ACCMSG)}</small></p>
  <p><label><input type=checkbox ${S.settings.mailOn?'checked':''} onchange="S.settings.mailOn=this.checked;save()"> Show inbox cards on Stage</label></p>`,'wide')}
// ---------- Inbox (Stage) + suggestions (Study/Money) ----------
const detected=(kinds)=>who().flatMap(p=>(MAIL[p]?.items||[]).filter(i=>i.detect&&kinds.includes(i.detect.kind)&&!S.mailSeen.includes(i.id)).map(i=>({...i,p})));
function inboxCard(){if(!S.settings.mailOn)return'';const ps=who().filter(p=>MAIL[p]);if(!ps.length)return'';
 return card('✉ Inbox',ps.map(p=>{const m=MAIL[p];return`<div><b>${p}</b> · ${m.unread} unread <small>${(m.sources||[]).join(' + ')}</small>${(m.errors||[]).map(e=>`<br><small class="tag warn">${esc(e)}</small>`).join('')}
  <ul>${m.items.slice(0,4).map(i=>`<li>${i.unread?'<b>':''}${esc(i.subject||'(no subject)')}${i.unread?'</b>':''} <small>— ${esc((i.from||'').replace(/<.*>/,''))}</small>${i.detect?` <span class="tag">${i.detect.kind}${i.detect.amount?' '+aud(i.detect.amount):''}${i.detect.date?' · '+fmtD(i.detect.date):''}</span>`:''}</li>`).join('')}</ul></div>`}).join(''))}
function suggestCard(kinds,title){const d=detected(kinds);if(!d.length)return'';
 return card(title,`<table>${d.slice(0,6).map(i=>`<tr><td>${i.p}</td><td>${esc(i.subject)}</td><td>${i.detect.amount?aud(i.detect.amount):''} ${i.detect.date?fmtD(i.detect.date):''}</td><td><button onclick="acceptMail('${i.p}','${i.id}')">Add</button> <button onclick="S.mailSeen.push('${i.id}');save()">Ignore</button></td></tr>`).join('')}</table><small>Detected from email subjects/previews — check before adding.</small>`)}
function acceptMail(p,id){const i=(MAIL[p]?.items||[]).find(x=>x.id===id);if(!i)return;const d=i.detect;S.mailSeen.push(id);
 if(d.kind==='receipt')S.expenses.push({id:uid(),person:p,date:today(),cat:/woolworths|coles|aldi/i.test(i.from+i.subject)?'Groceries':'Shopping',amount:+(d.amount||0),desc:i.subject.slice(0,60)+' (email)',src:'mail:'+id});
 else if(d.kind==='bill')S.bills.push({id:uid(),name:i.subject.slice(0,40),amount:+(d.amount||0),freq:'once',due:d.date||addDays(today(),14),src:'mail:'+id});
 else if(d.kind==='exam')S.exams.push({id:uid(),person:p,subject:i.subject.slice(0,60),date:d.date||addDays(today(),14),src:'mail:'+id});
 else S.assignments.push({id:uid(),person:p,title:i.subject.slice(0,60),course:'(email)',due:d.date||addDays(today(),7),pct:0,src:'mail:'+id});
 save()}
// ---------- NotebookLM (Study) ----------
const subjOf=s=>(String(s).match(/\b[A-Z]{4}\d{4}\b/)||[String(s).split(/\s+/)[0]])[0];
function studyPack(p,subj){const A=S.assignments.filter(a=>a.person===p&&subjOf(a.course+' '+a.title)===subj),E=S.exams.filter(e=>e.person===p&&subjOf(e.subject)===subj),B=studyBlocks().filter(b=>b.person===p&&subjOf(b.title.replace('Study: ',''))===subj);
 return`# ${subj} — study pack for ${p}\n_Generated by fiaOS on ${fmtD(today())}. Upload this as a NotebookLM source._\n\n## Exams\n${E.map(e=>`- **${e.subject}** — ${fmtD(e.date)} (${daysUntil(e.date)} days)`).join('\n')||'- none recorded'}\n\n## Assignments\n${A.map(a=>`- **${a.title}** (${a.course}) — due ${fmtD(a.due)}, ${a.pct}% done`).join('\n')||'- none recorded'}\n\n## Planned study blocks\n${B.map(b=>`- ${fmtD(b.date)}: ${b.hrs} h`).join('\n')||'- none yet'}\n\n## Ask NotebookLM\n- Make a revision timetable from the dates above.\n- Quiz me on the key topics for ${subj}.\n- Summarise what I should prioritise this week.\n`}
function dlPack(p,s){const b=new Blob([studyPack(p,s)],{type:'text/markdown'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`${s}-${p}-study-pack.md`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}
async function nlmCreate(p,s){note('Creating notebook…');try{const j=await api('/api/acct/notebooklm/create',{person:p,title:`${s} (fiaOS)`,text:studyPack(p,s)});(S.settings.nlm[p]??={})[s]=j.url;save();note(`Notebook created via ${j.mode==='enterprise'?'Enterprise API':'notebooklm-py'} ✓`)}catch(e){note('NotebookLM: '+e.message)}}
function notebookCard(){return who().filter(p=>p!=='Cam').map(p=>{const subs=[...new Set([...S.assignments.filter(a=>a.person===p).map(a=>subjOf(a.course+' '+a.title)),...S.exams.filter(e=>e.person===p).map(e=>subjOf(e.subject))])];if(!subs.length)return'';
 const mode=ACC?.people?.[p]?.notebooklm,links=S.settings.nlm[p]||{};
 return card(`📓 NotebookLM · ${p}`,`<p><small>${mode==='enterprise'?'Connected: NotebookLM Enterprise API (official)':mode==='community'?'Connected: notebooklm-py on '+p+'\'s own account (unofficial, may break)':'Not connected — download a study pack and upload it at notebooklm.google.com, or scan the QR.'}</small></p>
  <table>${subs.map(s=>`<tr><td><b>${esc(s)}</b></td><td>${links[s]?`<a href="${esc(links[s])}" target="_blank">Open</a>`:`<input placeholder="paste notebook link" onchange="(S.settings.nlm['${p}']??={})['${s}']=this.value;save()">`}</td>
  <td><button onclick="dlPack('${p}','${s}')">Study pack</button>${mode?` <button onclick="nlmCreate('${p}','${s}')">Create notebook</button>`:''} <button onclick="view.qr=view.qr==='${p+s}'?null:'${p+s}';render()">QR</button></td></tr>${view.qr===p+s?`<tr><td colspan=3><div style="width:160px;background:#fff;border-radius:12px;padding:6px">${qrSvg(links[s]||'https://notebooklm.google.com/')}</div><small>${links[s]?'Opens this notebook':'Opens NotebookLM'} on your phone</small></td></tr>`:''}`).join('')}</table>
  ${(NLM[p]?.notebooks||[]).length?`<small>Your notebooks: ${NLM[p].notebooks.slice(0,6).map(n=>`<a href="${esc(n.url)}" target="_blank">${esc(n.title)}</a>`).join(' · ')}</small>`:''}`)}).join('')}
// ---------- hook views ----------
const _Vs={Stage:VIEWS.Stage,Study:VIEWS.Study,Money:VIEWS.Money,Settings:VIEWS.Settings};
VIEWS.Stage=()=>{const h=_Vs.Stage();return inboxCard()+h};
VIEWS.Study=()=>_Vs.Study()+suggestCard(['due','exam'],'✉ From email: due dates')+notebookCard();
VIEWS.Money=()=>_Vs.Money()+suggestCard(['bill','receipt'],'✉ From email: bills & receipts');
VIEWS.Settings=()=>accountsCard()+_Vs.Settings();
setTimeout(()=>accRefresh(true),1500);setInterval(()=>accRefresh(true),15*60e3);
