// fiaOS ⇄ Notion sync (browser side). The server holds the token; this file only talks to /api/notion/*.
// Design: every synced item keeps its Notion page id (nid), the Notion edit time it last saw (ned) and a hash of its
// fields at last sync (_h). Local edit = hash changed -> pushed (local wins). Notion edit = edit time changed -> pulled.
// Order per sync: archive local deletions -> pull + merge -> push local changes. Full sync on start + every 15 min;
// a quiet push ~5 s after any local edit. Seed/example items are never sent to Notion. No sound, no motion.
// Notion is a second way in: a row added in any fiaOS database is created here through the same ACTIONS the app uses
// (addExpense, logFood, addShopping, ...), so weekly spend, intake -> workout suggestions, bills in the agenda/brief and
// the Woolworths list all react. Free-text rows in "fiaOS Inbox" are turned into actions by the server (Grok) and queued
// in /api/notion/pending; each device applies them once on its next sync (checked every 5 min).
(()=>{
const SLOTS=['Breakfast','Lunch','Dinner'];
let NS=null,BUSY=false,MSG='',WIKI=null,LAST=null;window.NOTION=()=>({NS,WIKI,LAST,MSG});
const N=()=>(S.notion??={known:{},mp:{},last:null,journal:''});
const FREQS=['weekly','fortnightly','monthly','quarterly','once'],WIN={expenses:90,food:30,workouts:90};
const PP=p=>PEOPLE.includes(p)?p:'Ada';
const logDays=h=>Object.keys(h.log||{}).filter(d=>h.log[d]).sort().reverse().slice(0,60);
const ldate=iso=>iso?new Date(iso).toLocaleDateString('en-CA'):today();
const H=o=>JSON.stringify(o);
const F={ // fields that sync, per kind
 recipe:r=>H([r.name,+r.kcal||0,+r.p||0,+r.c||0,+r.f||0,r.ing||{},r.tags||[]]),
 asg:a=>H([a.title,a.person,a.course||'',a.due||'',+a.pct||0]),
 exam:e=>H([e.subject,e.person,e.course||'',e.date||'']),
 chore:c=>H([c.name,c.person,c.day||'',!!c.done]),
 expense:e=>H([e.desc||'',e.person,e.cat||'',+e.amount||0,e.date||'']),
 bill:b=>H([b.name,+b.amount||0,b.freq||'',b.due||'']),
 food:x=>H([x.name,x.person,+x.kcal||0,+x.p||0,+x.c||0,+x.f||0,x.date||'']),
 workout:w=>H([w.type,w.person,+w.mins||0,w.intensity||'',w.date||'']),
 extra:e=>H([e.item,+e.qty||1,e.price??null]),
 habit:h=>H([h.name,h.person,logDays(h),!!(h.log||{})[today()]])};
// list-type kinds added for "Notion as a second way in": Notion database -> local array, ACTIONS used for new rows
const L={
 expenses:{k:'expense',arr:'expenses',act:'addExpense',
  toLocal:r=>({desc:r.desc||'Expense',person:PP(r.person),cat:r.cat||'Other',amount:+r.amount||0,date:r.date||today()}),
  out:e=>({desc:e.desc,person:e.person,cat:e.cat,amount:+e.amount||0,date:e.date}),need:r=>!r.date||!PEOPLE.includes(r.person)||!r.cat},
 bills:{k:'bill',arr:'bills',act:'addBill',
  toLocal:r=>({name:r.name||'Bill',amount:+r.amount||0,freq:FREQS.includes(r.freq)?r.freq:'monthly',due:r.due||today()}),
  out:b=>({name:b.name,amount:+b.amount||0,freq:b.freq,due:b.due}),need:r=>!r.due||!r.freq},
 food:{k:'food',arr:'foodLog',act:'logFood',
  toLocal:r=>({name:r.name||'Food',person:PP(r.person),kcal:+r.kcal||0,p:+r.p||0,c:+r.c||0,f:+r.f||0,date:r.date||today()}),
  out:x=>({name:x.name,person:x.person,kcal:+x.kcal||0,p:+x.p||0,c:+x.c||0,f:+x.f||0,date:x.date}),need:r=>!r.date||!PEOPLE.includes(r.person)},
 workouts:{k:'workout',arr:'workouts',act:'addWorkout',
  toLocal:r=>({type:r.type||'Workout',person:PP(r.person),mins:+r.mins||0,intensity:['Low','Moderate','High'].includes(r.intensity)?r.intensity:'Moderate',date:r.date||today()}),
  out:w=>({type:w.type,person:w.person,mins:+w.mins||0,intensity:w.intensity,date:w.date}),need:r=>!r.date||!PEOPLE.includes(r.person)||!r.intensity},
 shopping:{k:'extra',arr:'extras',act:'addShopping',
  toLocal:r=>({item:r.item||'Item',qty:+r.qty||1,price:r.price!=null&&r.price>0?+r.price:null}),
  out:e=>({item:e.item,qty:+e.qty||1,price:e.price??null}),need:r=>r.qty==null},
 habits:{k:'habit',arr:'habits',act:'addHabit',
  toLocal:r=>{const log={},t=today();String(r.log||'').split(/[^\d-]+/).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d!==t).forEach(d=>log[d]=true);if(r.done)log[ldate(r.edited)]=true;return{name:r.name||'Habit',person:PP(r.person),log}},
  out:h=>{const d=logDays(h);return{name:h.name,person:h.person,done:!!(h.log||{})[today()],days:Object.values(h.log||{}).filter(Boolean).length,log:d.join(', ')}},
  need:r=>!PEOPLE.includes(r.person)}};
const FP=p=>{const t=S.people[p]||{};return H([+t.kcal||0,+t.p||0,+t.c||0,+t.f||0,+t.budget||0,t.goal||''])};
const dirty=(x,k)=>!x.ex&&(!x.nid||F[k](x)!==x._h);
const old=(x,kind)=>WIN[kind]&&x.date&&daysUntil(x.date)< -WIN[kind];
const dirtyL=(x,kind)=>dirty(x,L[kind].k)&&!(!x.nid&&old(x,kind)); // old history is not back-filled into Notion
const mark=(x,k,row)=>{x.nid=row.nid;x.ned=row.edited;x._h=F[k](x)};
const mpKey=(p,d,s)=>`${p}|${d}|${s}`;

// first link: tag the built-in example data so it is never pushed to Notion
function tagExamples(){if(N().tagged)return;let ex;try{ex=seed()}catch{ex=null}
 if(ex){const rn=new Set(Object.values(ex.recipes).map(r=>r.name)),an=new Set(ex.assignments.map(a=>a.title)),en=new Set(ex.exams.map(e=>e.subject)),cn=new Set(ex.chores.map(c=>c.name+'|'+c.person));
  Object.values(S.recipes).forEach(r=>{if(!r.nid&&rn.has(r.name))r.ex=true});
  S.assignments.forEach(a=>{if(!a.nid&&an.has(a.title))a.ex=true});S.exams.forEach(e=>{if(!e.nid&&en.has(e.subject))e.ex=true});
  S.chores.forEach(c=>{if(!c.nid&&cn.has(c.name+'|'+c.person))c.ex=true})}
 N().tagged=true}
function tagExamples2(){if(N().tagged2)return;let ex;try{ex=seed()}catch{ex=null}
 if(ex){const key={expenses:e=>[e.person,e.desc,+e.amount],bills:b=>[b.name,+b.amount,b.freq],foodLog:x=>[x.person,x.name,+x.kcal],workouts:w=>[w.person,w.type,+w.mins],habits:h=>[h.person,h.name],extras:e=>[e.item,+e.qty]};
  for(const[a,f]of Object.entries(key)){const set=new Set((ex[a]||[]).map(x=>JSON.stringify(f(x))));(S[a]||[]).forEach(x=>{if(!x.nid&&set.has(JSON.stringify(f(x))))x.ex=true})}}
 N().tagged2=true}

const post=(u,b)=>api(u,b);
const ids=()=>S.extras.forEach(e=>e.id??=uid()); // shopping extras had no id before Notion sync
async function status(){try{NS=await api('/api/notion/status')}catch(e){NS={connected:false,error:e.message}}return NS}

// ---- deletions (items we synced before that are gone locally) ----
function localNids(){const o={recipes:Object.values(S.recipes).map(r=>r.nid).filter(Boolean),uni:[...S.assignments,...S.exams].map(x=>x.nid).filter(Boolean),chores:S.chores.map(c=>c.nid).filter(Boolean)};
 for(const[kind,K]of Object.entries(KL))o[kind]=(S[K.arr]||[]).map(x=>x.nid).filter(Boolean);return o}
const KL=L;const DELK=()=>['recipes','uni','chores',...Object.keys(KL)]; // shopping "deletions" (item bought / order placed) tick Bought in Notion instead of archiving
async function archiveDeleted(){const L=localNids(),K=N().known;
 for(const k of DELK()){const gone=(K[k]||[]).filter(n=>!L[k].includes(n));if(gone.length){await post('/api/notion/push',{kind:k,archive:gone});K[k]=(K[k]||[]).filter(n=>!gone.includes(n))}}}

// ---- pull + merge ----
// "changed in Notion" = the row's content differs from what we last synced (_h). (last_edited_time is minute-rounded, so not used for this.)
function upd(x,k,v,row){if(dirty(x,k))return;const nh=F[k]({...x,...v});x.ned=row.edited;if(nh===x._h)return;Object.assign(x,v);x._h=F[k](x)}
function mergeList(list,rows,k,toLocal,make){const seen=new Set();
 for(const row of rows){seen.add(row.nid);const x=list().find(i=>i.nid===row.nid);
  if(x)upd(x,k,toLocal(row),row);else{const n=make(toLocal(row));mark(n,k,row)}}
 return seen}
function merge(d){
 // recipes
 const seenR=new Set();
 for(const row of d.recipes){seenR.add(row.nid);let id=Object.keys(S.recipes).find(k=>S.recipes[k].nid===row.nid);const v={name:row.name||'Untitled recipe',kcal:row.kcal,p:row.p,c:row.c,f:row.f,ing:row.ing,tags:row.tags};
  Object.keys(row.ing||{}).forEach(i=>S.products[i]??=5);
  if(id)upd(S.recipes[id],'recipe',v,row);else{id='n_'+row.nid.replace(/-/g,'');S.recipes[id]={...v};mark(S.recipes[id],'recipe',row)}}
 for(const [id,r] of Object.entries(S.recipes))if(r.nid&&!seenR.has(r.nid))delete S.recipes[id];
 // uni (assignments + exams share one database; Type decides which list)
 const seenU=new Set();
 for(const row of d.uni){seenU.add(row.nid);const isEx=row.type==='Exam',person=PEOPLE.includes(row.person)?row.person:'Ada';
  let a=S.assignments.find(x=>x.nid===row.nid),e=S.exams.find(x=>x.nid===row.nid);
  if((a&&isEx)||(e&&!isEx)){if((a&&dirty(a,'asg'))||(e&&dirty(e,'exam')))continue;S.assignments=S.assignments.filter(x=>x!==a);S.exams=S.exams.filter(x=>x!==e);a=e=null}
  if(isEx){const v={subject:row.title||'Exam',person,course:row.course,date:row.due};
   if(e)upd(e,'exam',v,row);else{ACTIONS.addExam(v);mark(S.exams[S.exams.length-1],'exam',row)}}
  else{const v={title:row.title||'Assignment',person,course:row.course,due:row.due,pct:+row.pct||0};
   if(a)upd(a,'asg',v,row);else{ACTIONS.addAssignment(v);mark(S.assignments[S.assignments.length-1],'asg',row)}}}
 S.assignments=S.assignments.filter(x=>!x.nid||seenU.has(x.nid));S.exams=S.exams.filter(x=>!x.nid||seenU.has(x.nid));
 // chores
 const seenC=mergeList(()=>S.chores,d.chores,'chore',r=>({name:r.name||'To-do',person:[...PEOPLE,'Everyone'].includes(r.person)?r.person:'Everyone',day:r.day||'Any',done:r.done}),v=>{ACTIONS.addChore(v);return S.chores[S.chores.length-1]});
 S.chores=S.chores.filter(x=>!x.nid||seenC.has(x.nid));
 // meal plan (after recipes so relations resolve); several rows for one slot -> newest wins
 const best={};for(const row of d.meals){const s=SLOTS.indexOf(row.slot);if(!PEOPLE.includes(row.person)||!DAYS.includes(row.day)||s<0)continue;const k=mpKey(row.person,row.day,s);if(!best[k]||best[k].edited<row.edited)best[k]=row}
 for(const [k,row] of Object.entries(best)){const [p,day,s]=k.split('|'),M=N().mp[k],cur=(S.mealPlan[p]?.[day]||[])[s]??'';
  const rid=row.recipe?Object.keys(S.recipes).find(i=>S.recipes[i].nid===row.recipe):'';if(row.recipe&&!rid)continue;
  if(M&&M.nid===row.nid){if(cur!==M.h)continue;if(rid===M.h)continue}  // changed locally (local wins) / unchanged in Notion
  else if(M&&cur!==M.h&&row.edited<=M.ned)continue;
  S.mealPlan[p]??={};S.mealPlan[p][day]??=[];S.mealPlan[p][day][s]=rid;N().mp[k]={nid:row.nid,ned:row.edited,h:rid}}
 // new kinds: rows added in Notion go through the app's ACTIONS so every linked view reacts
 for(const[kind,K]of Object.entries(KL)){if(!d[kind])continue;const seen=new Set(),win=(d.windows||{})[kind];
  for(const row of d[kind]){seen.add(row.nid);const v=K.toLocal(row),x=S[K.arr].find(i=>i.nid===row.nid);
   if(x){upd(x,K.k,v,row);if(kind==='habits'&&!dirty(x,'habit')&&(row.log!==K.out(x).log||row.done!==K.out(x).done))x._h=''}
   else{ACTIONS[K.act]({...v});const n=S[K.arr][S[K.arr].length-1];if(kind==='shopping'){n.id??=uid();n.price=v.price}if(kind==='habits')n.log=v.log;
    mark(n,K.k,row);if(K.need(row)||(kind==='habits'&&row.log!==K.out(n).log))n._h=''}} // fill blanks fiaOS defaulted (date, person...) back into Notion
  S[K.arr]=S[K.arr].filter(x=>!x.nid||seen.has(x.nid)||(win&&x.date&&x.date<win))}
 S.extras.forEach(e=>{if(e.price>0)S.products[e.item]=+e.price});
 // people & targets: one row per person; a Notion edit updates targets via ACTIONS.updateTargets
 const PT=N().pt??={};
 for(const p of PEOPLE){const row=(d.people||[]).filter(r=>r.name.toLowerCase()===p.toLowerCase()).sort((a,b)=>b.edited.localeCompare(a.edited))[0],M=PT[p];
  if(!row){delete PT[p];continue}if(M&&M.nid===row.nid&&FP(p)!==M.h)continue; // local edit wins
  const v={};['kcal','p','c','f','budget'].forEach(k=>{if(row[k]!=null)v[k]=+row[k]});if(row.goal)v.goal=row.goal;
  const nh=H([...['kcal','p','c','f','budget'].map(k=>v[k]??+S.people[p][k]??0),v.goal??S.people[p].goal??'']);
  if(!M||M.nid!==row.nid||nh!==M.h)ACTIONS.updateTargets({person:p,...v});
  PT[p]={nid:row.nid,h:['kcal','p','c','f','budget'].some(k=>row[k]==null)?'':FP(p)}}
 WIKI=d.wiki||[]}

// ---- pending actions from the Notion Inbox (server-side Grok). Each entry is applied once per device. ----
const LK={addExpense:'expenses',addBill:'bills',logFood:'food',addWorkout:'workouts',addShopping:'shopping',addHabit:'habits'};
function applyAct(a,first){const{type,nid,...v}=a;if(!ACTIONS[type])return 0;
 if(LK[type]&&nid){const K=KL[LK[type]];if(S[K.arr].some(x=>x.nid===nid))return 0;ACTIONS[type]({...v});const n=S[K.arr][S[K.arr].length-1];if(type==='addShopping'){n.id??=uid();n.price=v.price??null}n.nid=nid;n.ned='';n._h=F[K.k](n);return 1}
 if(type==='addChore'&&nid){if(S.chores.some(x=>x.nid===nid))return 0;ACTIONS.addChore(v);const n=S.chores[S.chores.length-1];n.nid=nid;n._h=F.chore(n);return 1}
 if(type==='addAssignment'&&nid){if(S.assignments.some(x=>x.nid===nid))return 0;ACTIONS.addAssignment(v);const n=S.assignments[S.assignments.length-1];n.nid=nid;n._h=F.asg(n);return 1}
 if(type==='addExam'&&nid){if(S.exams.some(x=>x.nid===nid))return 0;ACTIONS.addExam(v);const n=S.exams[S.exams.length-1];n.nid=nid;n._h=F.exam(n);return 1}
 if(type==='addRecipe'&&nid){const id='n_'+nid.replace(/-/g,'');if(S.recipes[id])return 0;ACTIONS.addRecipe({...v,id});S.recipes[id].nid=nid;S.recipes[id]._h=F.recipe(S.recipes[id]);return 1}
 if(type==='setMeal'){const rid=Object.keys(S.recipes).find(k=>S.recipes[k].nid===v.recipe)||v.recipe;if(!S.recipes[rid])return 0;ACTIONS.setMeal({...v,recipe:rid});if(nid)N().mp[mpKey(v.person,v.day,v.slot)]={nid,ned:'',h:rid};return 1}
 if(type==='updateTargets'){ACTIONS.updateTargets(v);if(nid&&N().pt?.[v.person]?.nid===nid)N().pt[v.person].h=FP(v.person);return 1}
 if(!nid&&first){ACTIONS[type](v);return 1}return 0}
async function applyPending(){let j;try{j=await api('/api/notion/pending')}catch{return 0}
 const done=new Set(N().pq||[]);let n=0;
 for(const e of j.items||[]){if(done.has(e.qid))continue;let first=false;
  if(e.actions.some(a=>!a.nid&&!['setMeal','updateTargets'].includes(a.type)))try{first=(await api('/api/notion/pending/claim',{qid:e.qid})).first}catch{}
  for(const a of e.actions)try{n+=applyAct(a,first)}catch(err){console.warn('pending',err)}
  done.add(e.qid)}
 N().pq=[...done].slice(-300);if(n)INBOXMSG=`📥 ${n} item${n>1?'s':''} added from the Notion inbox`;return n}
let INBOXMSG='';

// ---- push local changes ----
async function pushAll(){const out={n:0,errors:[]};
 const go=async(kind,ups,apply)=>{if(!ups.length)return;const r=await post('/api/notion/push',{kind,upserts:ups});(r.results||[]).forEach(x=>x.lid&&apply(x));out.n+=(r.results||[]).length;out.errors.push(...(r.errors||[]))};
 const R=Object.entries(S.recipes).filter(([,r])=>dirty(r,'recipe'));
 await go('recipes',R.map(([id,r])=>({lid:id,nid:r.nid,name:r.name,kcal:r.kcal,p:r.p,c:r.c,f:r.f,ing:r.ing,tags:r.tags||[]})),x=>{const r=S.recipes[x.lid];if(r){r.nid=x.nid;r.ned=x.edited;r._h=SENT[x.lid]}});
 const MP=[];for(const p of PEOPLE)for(const d of DAYS)for(let s=0;s<3;s++){const k=mpKey(p,d,s),rid=(S.mealPlan[p]?.[d]||[])[s]??'',M=N().mp[k],rn=rid?S.recipes[rid]?.nid:'';
  if(M&&M.h===rid)continue;if(rid&&!rn&&!M)continue;if(!rid&&!M)continue;MP.push({lid:k,nid:M?.nid,person:p,day:d,slot:SLOTS[s],recipe:rn||'',_rid:rid})}
 const mpSent=Object.fromEntries(MP.map(m=>[m.lid,m._rid]));
 await go('meals',MP.map(({_rid,...m})=>m),x=>{N().mp[x.lid]={nid:x.nid,ned:x.edited,h:mpSent[x.lid]}});
 const U=[...S.assignments.filter(a=>dirty(a,'asg')).map(a=>({lid:'a:'+a.id,nid:a.nid,type:'Assignment',title:a.title,person:a.person,course:a.course||'',due:a.due,pct:+a.pct||0,_h:F.asg(a)})),
  ...S.exams.filter(e=>dirty(e,'exam')).map(e=>({lid:'e:'+e.id,nid:e.nid,type:'Exam',title:e.subject,person:e.person,course:e.course||'',due:e.date,pct:null,_h:F.exam(e)}))];
 await go('uni',U.map(({_h,...u})=>u),x=>{const [t,id]=[x.lid.slice(0,1),x.lid.slice(2)],it=(t==='a'?S.assignments:S.exams).find(i=>i.id===id);if(it){it.nid=x.nid;it.ned=x.edited;it._h=SENT[x.lid]}});
 const C=S.chores.filter(c=>dirty(c,'chore'));
 await go('chores',C.map(c=>({lid:c.id,nid:c.nid,name:c.name,person:c.person,day:c.day,done:!!c.done})),x=>{const c=S.chores.find(i=>i.id===x.lid);if(c){c.nid=x.nid;c.ned=x.edited;c._h=SENT[x.lid]}});
 for(const[kind,K]of Object.entries(KL)){const D=(S[K.arr]||[]).filter(x=>dirtyL(x,kind));
  await go(kind,D.map(x=>({lid:x.id,nid:x.nid,...K.out(x)})),r=>{const x=S[K.arr].find(i=>i.id===r.lid);if(x){x.nid=r.nid;x.ned=r.edited;x._h=SENT[kind+':'+r.lid]}})}
 const PT=N().pt??={},TP=PEOPLE.filter(p=>!PT[p]||PT[p].h!==FP(p));
 await go('people',TP.map(p=>{const t=S.people[p];return{lid:p,nid:PT[p]?.nid,name:p,kcal:t.kcal,p:t.p,c:t.c,f:t.f,budget:t.budget,goal:t.goal||''}}),r=>{PT[r.lid]={nid:r.nid,h:SENT['people:'+r.lid]}});
 return out}
let SENT={};// hash of what was actually sent, per lid (so edits made during a push are not lost)
function snapshot(){SENT={};Object.entries(S.recipes).forEach(([id,r])=>SENT[id]=F.recipe(r));S.assignments.forEach(a=>SENT['a:'+a.id]=F.asg(a));S.exams.forEach(e=>SENT['e:'+e.id]=F.exam(e));S.chores.forEach(c=>SENT[c.id]=F.chore(c));
 for(const[kind,K]of Object.entries(KL))(S[K.arr]||[]).forEach(x=>SENT[kind+':'+x.id]=F[K.k](x));PEOPLE.forEach(p=>SENT['people:'+p]=FP(p))}

function anyDirty(){if(!N().last)return false;const L=localNids(),K=N().known;ids();
 return Object.values(S.recipes).some(r=>dirty(r,'recipe'))||S.assignments.some(a=>dirty(a,'asg'))||S.exams.some(e=>dirty(e,'exam'))||S.chores.some(c=>dirty(c,'chore'))
  ||Object.entries(KL).some(([kind,Kd])=>(S[Kd.arr]||[]).some(x=>dirtyL(x,kind)))||PEOPLE.some(p=>!N().pt?.[p]||N().pt[p].h!==FP(p))
  ||DELK().some(k=>(K[k]||[]).some(n=>!(L[k]||[]).includes(n)))
  ||PEOPLE.some(p=>DAYS.some(d=>[0,1,2].some(s=>{const M=N().mp[mpKey(p,d,s)],rid=(S.mealPlan[p]?.[d]||[])[s]??'';return M?M.h!==rid:!!(rid&&S.recipes[rid]?.nid)})))}

const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
async function sync({pull=true}={}){if(BUSY||!PROXY.ok)return;BUSY=true;MSG=pull?'Syncing…':'Saving to Notion…';
 try{if(!NS?.connected)await status();if(!NS?.connected){MSG='';return}
  tagExamples();tagExamples2();ids();if(pull)await applyPending();await archiveDeleted();
  if(pull){const d=await api('/api/notion/pull');merge(d)}ids();
  snapshot();const p=await pushAll();
  const L=localNids();N().known=L;N().last=new Date().toISOString();LAST=N().last;MSG=p.errors.length?'⚠ '+p.errors[0]:'';
  localStorage.setItem(KEY,JSON.stringify(S));
  if(pull)journal();
 }catch(e){MSG='⚠ '+e.message}finally{BUSY=false;if(quiet()&&(view.tab==='Settings'||view.tab==='Stage'||pull))_render()}}
window.notionSync=()=>sync({pull:true});

// ---- journal: once a day, each person's morning brief as plain text (server dedupes by Date + Person) ----
function briefText(p){const keep=view.person;try{view.person=p;const d=document.createElement('div');d.innerHTML=briefCard();
  d.querySelectorAll('br').forEach(b=>b.replaceWith('\n'));d.querySelectorAll('li,tr,h3,p,div').forEach(e=>e.append('\n'));d.querySelectorAll('td').forEach(e=>e.append('  '));
  return d.textContent.replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{2,}/g,'\n').trim()}finally{view.person=keep}}
let jTimer=null;
function journal(){const t=today();if(N().journal===t||new Date().getHours()<5||jTimer||typeof briefCard!=='function')return;
 jTimer=setTimeout(async()=>{jTimer=null;if(N().journal===t)return;
  try{await api('/api/notion/journal',{date:t,entries:PEOPLE.map(p=>({person:p,text:briefText(p)}))});N().journal=t;localStorage.setItem(KEY,JSON.stringify(S))}catch(e){MSG='⚠ Journal: '+e.message}},W?5000:90000)}

// ---- UI ----
const tm=s=>s?new Date(s).toLocaleString('en-AU',{weekday:'short',hour:'numeric',minute:'2-digit'}):'never';
function notionCard(){const n=NS;
 if(!n)return card('📓 Notion','<p class="mute">Checking…</p>');
 if(!n.connected)return card('📓 Notion',`<p>Not connected. ${esc(n.error||'')}</p><p class="ex">Add NOTION_TOKEN to the fiaOS server's .env and share the "FiaOS · Home" page with the fiaOS integration.</p>`);
 const L={recipes:'Recipes',meals:'Meal Plan',uni:'Uni',chores:'Chores & To-dos',expenses:'Expenses',bills:'Bills',food:'Food Log',workouts:'Workouts',shopping:'Shopping Extras',habits:'Habits',people:'People & Targets',health:'Health',reviews:'Weekly Reviews',wiki:'Household Wiki',journal:'Journal'};
 return card('📓 Notion',`<p>✅ Connected to <b>${esc(n.workspace||'Notion')}</b></p>
  <table class="nhomes">${PEOPLE.map(p=>{const h=n.homes?.[p]||{};return`<tr><td><b>${p}</b></td><td>${h.shared?`<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title||'Home page')} ↗</a>`:`<span class="mute">${h.id?esc(h.note||'not shared yet'):'not shared yet'}</span>`}</td>
   <td><input id="nh-${p}" placeholder="Notion page link or id" value="${esc(h.id||'')}" style="max-width:220px"> <button class="sm" onclick="notionHome('${p}')">Save</button></td></tr>`}).join('')}</table>
  <p class="ex">Each person's home page (their "Open my Notion" link). Found automatically when a page with their name is shared with the fiaOS integration; paste a link to change it, or clear the box and Save to search again.</p>
  <p>Last sync: ${tm(LAST||N().last)}${MSG?` · <span class="${/^⚠/.test(MSG)?'warn':'mute'}">${esc(MSG)}</span>`:''}</p>
  <div class="row"><button onclick="notionSync()" ${BUSY?'disabled':''}>Sync now</button> <a href="${esc(n.rootUrl)}" target="_blank" rel="noopener">Open fiaOS Data ↗</a></div>
  <p class="ex">${Object.entries(L).map(([k,t])=>n.urls?.[k]?`<a href="${esc(n.urls[k])}" target="_blank" rel="noopener">${t}</a>`:t).join(' · ')}<br>
  Recipes, meal plan, uni, chores, expenses, bills, food log, workouts, shopping extras, habits and targets sync both ways every 15 min (and a few seconds after you edit). Anything added in Notion counts here exactly as if you'd added it in fiaOS. Each person's morning brief is saved to Journal once a day. Example data stays out of Notion.</p>
  <p>📥 <b>${n.urls?.inbox?`<a href="${esc(n.urls.inbox)}" target="_blank" rel="noopener">fiaOS Inbox</a>`:'fiaOS Inbox'}</b> · type a note in Notion like “Bea spent $12 on lunch” or “add milk” and fiaOS files it within about 5 minutes${n.inboxGrok?'':' <span class="mute">(Grok isn\'t connected on the server, so only simple notes are understood)</span>'}.
  ${n.lastInbox?`<span class="mute">Last checked ${tm(n.lastInbox.at)}${n.lastInbox.flagged?` · ${n.lastInbox.flagged} need a look`:''}.</span>`:''}${INBOXMSG?` <span class="mute">${esc(INBOXMSG)}</span>`:''} <button class="sm" onclick="notionInbox()" ${BUSY?'disabled':''}>Check inbox now</button></p>`)}
window.notionInbox=async()=>{MSG='Checking the inbox…';_render();try{await api('/api/notion/inbox/run',{});await status()}catch(e){MSG='⚠ '+e.message}MSG='';await sync({pull:true});_render()};
window.notionHome=async p=>{try{const r=await api('/api/notion/home',{person:p,page:$('#nh-'+p).value});NS.homes=r.homes;MSG=''}catch(e){MSG='⚠ '+e.message}_render()};
function myNotion(){if(!NS?.connected)return'';const H=NS.homes||{},P=who();
 const links=P.map(p=>H[p]?.shared?`<a class="tag" href="${esc(H[p].url)}" target="_blank" rel="noopener">📓 ${P.length>1?esc(p)+"'s Notion":'Open my Notion'} ↗</a>`:(P.length===1?`<span class="mute">📓 ${esc(p)}'s Notion page isn't shared with fiaOS yet</span>`:'')).join(' ');
 return links.trim()?`<div class="mynotion">${links}</div>`:''}
function wikiCard(){if(!NS?.connected||!WIKI)return myNotion()?card('📓 Notion',myNotion(),'wide'):'';
 const rows=WIKI.map(w=>`<li><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.title)}</a>${w.category?` <small class="mute">· ${esc(w.category)}</small>`:''}</li>`).join('');
 return card('📖 Household wiki',`${myNotion()}${rows?`<ul class="wlist">${rows}</ul>`:'<p class="mute">No pages yet.</p>'}<p class="ex">Read-only here · add or edit pages in <a href="${esc(NS.urls?.wiki||NS.rootUrl)}" target="_blank" rel="noopener">Notion ↗</a></p>`,'wide')}
const _Set=VIEWS.Settings;VIEWS.Settings=()=>notionCard()+_Set();
const _St=VIEWS.Stage;VIEWS.Stage=()=>_St()+wikiCard();
// quiet push after local edits: every save() ends in render(), so watch renders (debounced, cheap hash check)
const _render=render;let deb=null;
render=function(){_render.apply(this,arguments);if(!N().last||BUSY)return;clearTimeout(deb);deb=setTimeout(()=>{if(anyDirty())sync({pull:false})},5000)};
(async()=>{try{await PROXY_READY}catch{}await status();if(NS?.connected){LAST=N().last;sync({pull:true})}else if(view.tab==='Settings')_render()})();
setInterval(()=>sync({pull:true}),15*60e3);
// Inbox items: a cheap local check every 5 min; a full sync only when something new is waiting
setInterval(async()=>{if(!NS?.connected||BUSY)return;try{const j=await api('/api/notion/pending'),done=new Set(N().pq||[]);if((j.items||[]).some(e=>!done.has(e.qid)))sync({pull:true})}catch{}},5*60e3);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&NS?.connected&&Date.now()-new Date(N().last||0)>5*60e3)sync({pull:true})});
})();
