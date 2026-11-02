// fiaOS planner (client): the "Planner" tab mirrors each person's paper FiaOS Planner page by page, so every filled-in answer has one
// obvious place to go. Each section writes straight into the system that owns it (the same ACTIONS the rest of the app uses, chores.js,
// notes.js, Settings), says where the data lives (fiaOS tab · Notion database · Fia Health) and links there. Nothing is stored twice.
// Server: planner.js (section map + week/checklist ticks). Open directly with ?person=Bea&tab=Planner (Fia Health links here).
// Typed-but-unsaved form values are kept per person (DR) so a background re-render never wipes them. No timers, no motion.
(()=>{
let PM=null,PMP=null,LOADING=false,CH=null,TD=null,NB=null,MSG='';const DR={};
const CATS=['Groceries','Eating out','Transport','Fun','Bills','Uni','Health','Shopping','Other'],FREQS=['weekly','fortnightly','monthly','quarterly','once'];
const INT=['Low','Moderate','High'],DAYS9=[...DAYS,'Daily','Any'],WEEKDAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const NDB={'People & Targets':'people',Recipes:'recipes','Meal Plan':'meals',Uni:'uni',Expenses:'expenses',Bills:'bills','Food Log':'food',Workouts:'workouts','Shopping Extras':'shopping',Habits:'habits','Household Wiki':'wiki',Journal:'journal'};
const ea=s=>esc(s??'').replace(/"/g,'&quot;'),js=s=>String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
const P=()=>PEOPLE.includes(view.person)?view.person:null;
const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
if(!TABS.includes('Planner'))TABS.push('Planner');

// ---- opening a person's planner from a link: ?person=Bea&tab=Planner ----
{const q=new URLSearchParams(location.search),pp=q.get('person'),tt=q.get('tab');
 if([...PEOPLE,'Household'].includes(pp))view.person=pp;if(TABS.includes(tt))view.tab=tt}

// ---- data the planner reads from the server (chores, to-dos, board, planner ticks) ----
async function load(){const p=P();if(!PROXY.ok||!p||LOADING)return;LOADING=true;
 try{const[pl,ch,td,nb]=await Promise.all([api('/api/planner?person='+p),api('/api/chores'),api('/api/todos'),api('/api/notes')]);PM=pl;CH=ch;TD=td;NB=nb.notes}
 catch(e){MSG='⚠ '+e.message}finally{PMP=p;LOADING=false}
 if(view.tab==='Planner'&&quiet())render()}
async function call(u,b){try{const j=await api(u,b);MSG='';return j}catch(e){MSG='⚠ '+e.message;render();return null}}

// ---- draft-safe inputs ----
const D=()=>DR[P()]??={};
const inp=(id,a='')=>`<input id="pl-${id}" value="${ea(D()[id]??'')}" oninput="PL.d('${id}',this.value)" ${a}>`;
const sel=(id,arr,def)=>{const v=D()[id]??def;return`<select id="pl-${id}" onchange="PL.d('${id}',this.value)">${arr.map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select>`};
const val=(id,def='')=>String(D()[id]??def).trim();
const clr=(...ids)=>ids.forEach(i=>delete D()[i]);
const chk=(on,fn)=>`<input type="checkbox" ${on?'checked':''} onchange="${fn}">`;
const tick=k=>chk(PM?.meta?.checks?.[k],`PL.check('${k}',this.checked)`);

// ---- where each section lives ----
const go=t=>`<button class="sm" onclick="view.tab='${js(t)}';render()">${esc(t)} →</button>`;
function lives(s){const n=window.NOTION?.()?.NS,a=[];
 if(s.fiaos&&s.fiaos!=='Planner')a.push(go(s.fiaos));if(s.also)a.push(`<span class="tag">also ${esc(s.also)}</span>`);
 if(s.notion){const u=n?.urls?.[NDB[s.notion]];a.push(u?`<a class="tag" href="${ea(u)}" target="_blank" rel="noopener">Notion: ${esc(s.notion)} ↗</a>`:`<span class="tag">Notion: ${esc(s.notion)}</span>`)}
 if(s.fiahealth)a.push(`<a class="tag" href="${ea(/check-in/i.test(s.fiahealth)?PM.links.fiahealthCheckin:PM.links.fiahealth)}" target="_blank" rel="noopener">Fia Health: ${esc(s.fiahealth)} ↗</a>`);
 return a.length?`<p class="pl-lives">${a.join(' ')}</p>`:''}
function sec(id,body,cls=''){const s=PM.map.pages.flatMap(p=>p.sections).find(x=>x.id===id);if(!s)return'';
 return card(esc(s.title),`${lives(s)}${s.note?`<p class="ex">${esc(s.note)}</p>`:''}${body}`,'pl '+cls)}

// ---- section bodies (p = the planner's person) ----
const B={
 targets(p){const t=S.people[p];return`<div class="pl-g">${[['goal','Goal'],['kcal','Daily kcal'],['p','Protein g'],['c','Carbs g'],['f','Fat g'],['budget','Weekly budget AUD']].map(([k,l])=>
  `<label>${l}<input ${k==='goal'?'':'type="number" min="0"'} value="${ea(t[k]||'')}" onchange="PL.target('${k}',this.value)"></label>`).join('')}</div><small>Blank = unknown. Saved as you leave each box.</small>`},
 todos(p){const it=(TD?.items||[]).filter(x=>x.person===p);
  return`<table>${it.map(x=>`<tr><td>${chk(x.done,`PL.todo('${x.id}',this.checked)`)}</td><td class="${x.done?'mute':''}">${esc(x.name)}</td></tr>`).join('')||'<tr><td class="mute">None yet.</td></tr>'}</table>
  <div class="row">${inp('td-n','placeholder="Task"')}<button onclick="PL.addTodo()">+ Add</button></div>`},
 chores(p){const it=(CH?.items||[]).filter(x=>x.person===p);
  return`<table>${it.map(x=>`<tr><td>${chk(x.done,`PL.chore('${x.id}',this.checked)`)}</td><td>${esc(x.name)}</td><td>${esc(x.day)}</td><td>${esc(x.person)}</td></tr>`).join('')||'<tr><td class="mute">None yet.</td></tr>'}</table>
  <div class="row">${inp('ch-n','placeholder="Chore"')}${sel('ch-d',DAYS9,'Any')}${sel('ch-o',PEOPLE,p)}<button onclick="PL.addChore()">+ Add</button></div>`},
 meals(p){const R=Object.entries(S.recipes);if(!R.length)return'<p class="mute">Add a recipe first (next card), then pick meals here.</p>';
  return`<table><tr><th></th><th>Breakfast</th><th>Lunch</th><th>Dinner</th><th>kcal</th></tr>${DAYS.map(d=>`<tr><td>${d}</td>${[0,1,2].map(s=>{const cur=S.mealPlan[p][d]?.[s]||'';
   return`<td><select onchange="PL.meal('${d}',${s},this.value)"><option value="">—</option>${R.map(([k,r])=>`<option value="${ea(k)}" ${cur===k?'selected':''}>${esc(r.name)}</option>`).join('')}</select></td>`}).join('')}<td><small>${planTotals(p,d).kcal}</small></td></tr>`).join('')}</table>
  <small>Target ${S.people[p].kcal||'—'} kcal/day. The Woolworths list builds itself from every planned meal.</small>`},
 recipes(p){const mine=Object.entries(S.recipes);
  return`<div class="pl-g">${[['rc-n','Recipe name',''],['rc-k','kcal per portion','type="number" min="0"'],['rc-p','Protein g','type="number" min="0"'],['rc-c','Carbs g','type="number" min="0"'],['rc-f','Fat g','type="number" min="0"']].map(([i,l,a])=>`<label>${l}${inp(i,a)}</label>`).join('')}</div>
  <table><tr><th>Product and pack size</th><th>Fraction of pack</th><th>Price per pack AUD</th></tr>${[...Array(8).keys()].map(i=>`<tr><td>${inp('rc-i'+i,'placeholder="e.g. Rolled oats 500 g"')}</td><td>${inp('rc-q'+i,'type="number" min="0" step="0.05" placeholder="0.5"')}</td><td>${inp('rc-$'+i,'type="number" min="0" step="0.01"')}</td></tr>`).join('')}</table>
  <div class="pl-g"><label>Tags (comma-separated)${inp('rc-t','placeholder="breakfast, high protein"')}</label><label>Recipe notes${inp('rc-x')}</label></div>
  <div class="row"><button onclick="PL.addRecipe()">+ Add recipe</button></div>
  ${mine.length?`<details><summary>Recipes in fiaOS (${mine.length})</summary>${mine.map(([,r])=>`<span class="tag">${esc(r.name)} · ${r.kcal} kcal · ${Object.keys(r.ing||{}).length} items</span>`).join('')}</details>`:''}`},
 extras(p){const ex=S.extras.map((e,i)=>({...e,i})).filter(e=>(e.person||'Bea')===p),used=new Set(ex.map(e=>e.item));
  PEOPLE.forEach(q=>DAYS.forEach(d=>(S.mealPlan[q][d]||[]).forEach(r=>Object.keys(S.recipes[r]?.ing||{}).forEach(i=>used.add(i)))));
  return`<table>${ex.map(e=>`<tr><td>${esc(e.item)}</td><td>×${e.qty}</td><td>${aud(S.products[e.item])}</td><td><label>${chk(e.bought,`PL.bought(${e.i},this.checked)`)} bought</label></td></tr>`).join('')||'<tr><td class="mute">No extras.</td></tr>'}</table>
  <div class="row">${inp('xs-i','placeholder="Extra item or product"')}${inp('xs-q','type="number" min="1" step="1" placeholder="packs" style="max-width:80px"')}${inp('xs-$','type="number" min="0" step="0.01" placeholder="$ pack" style="max-width:90px"')}<button onclick="PL.addExtra()">+ Add</button></div>
  ${used.size?`<details><summary>Product prices (${used.size})</summary><table>${[...used].sort().map(k=>`<tr><td>${esc(k)}${S.products[k]===5?' <span class="tag warn">check: AUD 5 placeholder?</span>':''}</td><td><input type="number" min="0" step="0.01" value="${S.products[k]??''}" onchange="PL.price('${ea(js(k))}',this.value)" style="max-width:100px"></td></tr>`).join('')}</table></details>`:''}`},
 bills(){const bs=billShares();return`<table><tr><th>Bill</th><th>Total</th><th>Freq</th><th>Due</th><th>Each</th></tr>${bs.map(b=>`<tr><td>${esc(b.name)}</td><td>${aud(b.amount)}</td><td>${esc(b.freq)}</td><td>${b.due?fmtD(b.due):''}</td><td>${aud(b.each)}</td></tr>`).join('')}</table>
  <div class="row">${inp('bl-n','placeholder="Bill"')}${inp('bl-a','type="number" min="0" step="0.01" placeholder="Total $" style="max-width:100px"')}${sel('bl-f',FREQS,'monthly')}${inp('bl-d','type="date"')}<button onclick="PL.addBill()">+ Add</button></div>
  <small>Shared ${H()} ways (Settings → people sharing bills).</small>`},
 expenses(p){const ex=S.expenses.filter(e=>e.person===p).slice(-8).reverse();
  return`<table>${ex.map(e=>`<tr><td>${fmtD(e.date)}</td><td>${esc(e.desc||'')}</td><td>${esc(e.cat||'')}</td><td>${aud(e.amount)}</td></tr>`).join('')||'<tr><td class="mute">None yet.</td></tr>'}</table>
  <div class="row">${inp('xp-d',`type="date" max="${today()}"`)}${inp('xp-s','placeholder="Description"')}${sel('xp-c',CATS,'Other')}${inp('xp-a','type="number" min="0" step="0.01" placeholder="$" style="max-width:90px"')}<button onclick="PL.addExpense()">+ Add</button></div>
  <small>This week ${aud(weekSpend(p))} of ${aud(S.people[p].budget)}.</small>`},
 order(){const l=shoppingList(),tot=l.reduce((a,x)=>a+x.cost,0),o=S.orders.slice(-3).reverse();
  return`<p>Calculated list: ${l.length} items · ${aud(tot)}</p><div class="row">${inp('or-d',`type="date" max="${today()}"`)}${inp('or-a','type="number" min="0" step="0.01" placeholder="Actual checkout $" style="max-width:150px"')}<button onclick="PL.order()">Mark order placed</button></div>
  ${o.map(x=>`<span class="tag">${fmtD(x.date)} · calc ${aud(x.total)}${x.actual?` · paid ${aud(x.actual)}`:''}</span>`).join('')}`},
 assignments(p){const a=S.assignments.filter(x=>x.person===p).sort((x,y)=>(x.due||'').localeCompare(y.due||''));
  return`<table>${a.map(x=>`<tr><td>${esc(x.title)}<br><small>${esc(x.course||'')}</small></td><td>${x.due?fmtD(x.due):''}</td><td><input type="number" min="0" max="100" step="5" value="${+x.pct||0}" onchange="PL.pct('${x.id}',this.value)" style="max-width:70px">%</td></tr>`).join('')||'<tr><td class="mute">None yet.</td></tr>'}</table>
  <div class="row">${inp('as-t','placeholder="Assignment"')}${inp('as-c','placeholder="Course"')}${inp('as-d','type="date"')}<button onclick="PL.addAssignment()">+ Add</button></div>`},
 exams(p){const e=S.exams.filter(x=>x.person===p).sort((x,y)=>x.date.localeCompare(y.date));
  return`<table>${e.map(x=>`<tr><td>${esc(x.subject)}</td><td>${fmtD(x.date)}</td><td>${esc(x.person)}${x.src?' <small>(calendar: check date)</small>':''}</td></tr>`).join('')||'<tr><td class="mute">None yet.</td></tr>'}</table>
  <div class="row">${inp('ex-s','placeholder="Subject or exam"')}${inp('ex-d','type="date"')}${sel('ex-o',PEOPLE,p)}<button onclick="PL.addExam()">+ Add</button></div>`},
 habits(p){const mon=chores_monday(),wk=DAYS.map((d,i)=>addDays(mon,i)),hs=S.habits.filter(h=>h.person===p);
  return`<table><tr><th>Habit</th>${'MTWTFSS'.split('').map(x=>`<th>${x}</th>`).join('')}<th>Total</th></tr>${hs.map(h=>`<tr><td>${esc(h.name)}</td>${wk.map(d=>`<td>${chk(h.log?.[d],`PL.habit('${h.id}','${d}',this.checked)`)}</td>`).join('')}<td>${Object.values(h.log||{}).filter(Boolean).length}</td></tr>`).join('')}</table>
  <div class="row">${inp('hb-n','placeholder="Habit"')}<button onclick="PL.addHabit()">+ Add</button></div>`},
 notebooklm(p){const nb=S.settings.nlmBook?.[p]||'';
  return`<p>Notebook: <b>${esc(PM.map.notebook||'')}</b> ${nb?`<a class="tag" href="${ea(nb)}" target="_blank" rel="noopener">Open ↗</a>`:''}</p>
  <label>Notebook link<input value="${ea(nb)}" placeholder="https://notebooklm.google.com/notebook/…" onchange="PL.nlm(this.value)"></label>
  <p><label>${tick('nlm.drive')} Drive permission granted</label> <label>${tick('nlm.sources')} Sources added</label> <label>${tick('nlm.refresh')} Source refresh checked</label></p>`},
 food(p){const f=S.foodLog.filter(x=>x.person===p).slice(-8).reverse();
  return`<table>${f.map(x=>`<tr><td>${fmtD(x.date)}</td><td>${esc(x.name)}</td><td>${x.kcal}</td><td><small>P${x.p} C${x.c} F${x.f}</small></td></tr>`).join('')||'<tr><td class="mute">None yet.</td></tr>'}</table>
  <div class="row">${inp('fd-d',`type="date" max="${today()}"`)}${inp('fd-n','placeholder="Food and portion"')}</div>
  <div class="row">${['kcal','p','c','f'].map(k=>inp('fd-'+k,`type="number" min="0" placeholder="${k==='kcal'?'kcal':k.toUpperCase()+' g'}" style="max-width:80px"`)).join('')}<button onclick="PL.addFood()">+ Log</button></div>
  <small>Barcode or name lookup: Meals &amp; Diet → Open Food Facts. Check the portion size.</small>`},
 workouts(p){const w=S.workouts.filter(x=>x.person===p).slice(-6).reverse(),sg=workoutSuggestion(p);
  return`<p><small>Suggested today: ${esc(sg.type)} · ${sg.intensity} · ${sg.mins} min</small></p><table>${w.map(x=>`<tr><td>${fmtD(x.date)}</td><td>${esc(x.type)}</td><td>${x.mins}m</td><td>${esc(x.intensity||'')}</td></tr>`).join('')||'<tr><td class="mute">None yet.</td></tr>'}</table>
  <div class="row">${inp('wo-d',`type="date" max="${today()}"`)}${inp('wo-t','placeholder="Workout"')}${inp('wo-m','type="number" min="1" placeholder="min" style="max-width:70px"')}${sel('wo-i',INT,'Moderate')}<button onclick="PL.addWorkout()">+ Add</button></div>`},
 board(p){const live=(NB||[]).filter(n=>!n.until||new Date(n.until)>Date.now());
  return`${live.map(n=>`<div class="bubble"><b>${esc(n.who)}</b>: ${esc(n.text)} <small>${esc(n.untilLabel||'')}</small></div>`).join('')||'<p class="mute">No messages.</p>'}
  <div class="row">${inp('nb-t','maxlength="140" placeholder="Message (140 characters)"')}${inp('nb-u','placeholder="until… (blank = 24 h)" style="max-width:150px"')}<button onclick="PL.addNote()">Post as ${p}</button></div>`},
 wiki(){const w=window.NOTION?.()?.WIKI||[];return w.length?`<p>${w.slice(0,8).map(x=>`<span class="tag">${esc(x.title||x.name||'')}</span>`).join('')}</p>`:'<p class="mute">No wiki pages synced yet.</p>'},
 journal(){return`<div class="row"><a class="btn" href="${ea(PM.links.fiahealthCheckin)}" target="_blank" rel="noopener">Open my Fia Health check-in ↗</a></div>
  <small>Mood and notes in the daily check-in stay in your own encrypted vault; fiaOS never reads them.</small>`},
 prefs(){const s=S.settings,b=s.bins||{},yn=(on,fn)=>chk(on,fn);
  return`<div class="pl-g"><label>Weather town<span class="row"><input id="pl-loc" value="${ea(s.loc?.name||'')}"><button class="sm" onclick="setLocation($('#pl-loc').value)">Set</button></span></label>
  <label>People sharing bills<input type="number" min="1" max="9" value="${+s.housemates||1}" onchange="S.settings.housemates=Math.max(1,+this.value||1);save()"></label>
  <label>Home profile<select onchange="S.settings.homeProfile=this.value;save()">${opts([...PEOPLE,'Household'],s.homeProfile)}</select></label>
  <label>Display<select onchange="window.setQuality?setQuality(this.value):(S.settings.quality=this.value,save())">${opts(['Ultra','High','Lite'],s.quality)}</select></label>
  <label>Grok model<input value="${ea(s.model||'')}" onchange="S.settings.model=this.value.trim()||'grok-4';save()"></label>
  <label>Bin collection day<select onchange="PL.bins('day',this.value)">${opts(WEEKDAYS,b.day)}</select></label>
  <label>Recycling date<input type="date" value="${ea(b.recycleAnchor||'')}" onchange="PL.bins('recycleAnchor',this.value)"></label>
  <label>Green-waste date<input type="date" value="${ea(b.greenAnchor||'')}" onchange="PL.bins('greenAnchor',this.value)"></label></div>
  <p><label>${yn(s.persona,'S.settings.persona=this.checked;save()')} Helper persona</label> <label>${yn(s.autoQ,'S.settings.autoQ=this.checked;save()')} Auto quality</label>
  <label>${yn(s.night?.on,'(S.settings.night??={from:21,to:6}).on=this.checked;save()')} Night mode</label>
  <label>${yn(s.mailOn,'S.settings.mailOn=this.checked;save()')} Show email cards</label>
  <label>${yn(s.calEveryone,`window.calEveryone?calEveryone(this.checked):(S.settings.calEveryone=this.checked,save())`)} Show everyone's calendar</label></p>`},
 connections(p){const a=(typeof ACC!=='undefined'&&ACC?.people?.[p])||{},n=window.NOTION?.()?.NS,hd=window.healthDay,y=addDays(today(),-1);
  const rows=[['google','Google',a.google?`✓ ${a.google.email||''}${a.google.gmail?' · Gmail':''}${a.google.drive?' · Drive':''}`:'not connected'],
   ['microsoft','Microsoft',a.microsoft?`✓ ${a.microsoft.email||''}`:a.microsoftPending?'waiting for device code':'not connected'],
   ['imap','Other email',a.imap?`✓ ${a.imap.label||a.imap.user||''}`:'not set'],
   ['calendar','Calendar',a.google?.calendar?'✓ Google calendar':S.settings.ics?'✓ ICS feed':'not set'],
   ['notion','Notion',n?.connected?(n.homes?.[p]?.shared?'✓ home page shared':'connected · home page not shared yet'):'not connected'],
   ['health','Apple Health',hd&&(hd(p,today())||hd(p,y))?'✓ data received':'no data yet'],
   ['helper','Helper',PROXY.xai?'✓ Grok on the server':S.settings.apiKey?'✓ browser key':'not connected']];
  return`<table><tr><th>Connection</th><th>Status</th><th>Ready</th></tr>${rows.map(([k,l,st])=>`<tr><td>${l}</td><td><small>${esc(st)}</small></td><td>${tick('conn.'+k)}</td></tr>`).join('')}</table>
  <div class="row">${go('Settings')}</div>`},
 before(){return`<p>${[['person','Correct person'],['checked','Dates and amounts checked'],['shared','Shared items entered once'],['dupes','Existing imports checked for duplicates']].map(([k,l])=>`<label>${tick('before.'+k)} ${l}</label>`).join(' ')}</p>`}};
const chores_monday=()=>{const x=new Date();x.setHours(12,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x.toLocaleDateString('en-CA')};

// ---- actions ----
const need=(v,m)=>{if(!v){MSG='⚠ '+m;render();return false}return true};
const ok=m=>{MSG='✓ '+m};
const add=(acts,ids,m)=>{ok(m);clr(...ids);apply(acts)}; // acts are built before the form is cleared
window.PL={
 d:(id,v)=>{D()[id]=v},
 target:(k,v)=>apply([{type:'updateTargets',person:P(),[k]:k==='goal'?String(v).trim():Math.max(0,+v||0)}]),
 async todo(id,done){const j=await call('/api/todos/tick',{id,done});if(j)TD=j;render()},
 async addTodo(){const n=val('td-n');if(!need(n,'Type a task first.'))return;const j=await call('/api/todos/add',{name:n,person:P()});if(j){TD=j;clr('td-n');ok('To-do added')}render()},
 async chore(id,done){const j=await call('/api/chores/tick',{id,done});if(j)CH=j;render()},
 async addChore(){const n=val('ch-n');if(!need(n,'Type a chore first.'))return;const j=await call('/api/chores/edit',{op:'add',name:n,day:val('ch-d','Any'),person:val('ch-o',P())});if(j){CH=j;clr('ch-n');ok('Chore added')}render()},
 meal(d,s,r){const p=P();if(r)apply([{type:'setMeal',person:p,day:d,slot:s,recipe:r}]);else{(S.mealPlan[p][d]??=[])[s]='';save()}},
 addRecipe(){const name=val('rc-n');if(!need(name,'Give the recipe a name.'))return;const ing={},prices={};
  for(let i=0;i<8;i++){const k=val('rc-i'+i),q=+val('rc-q'+i);if(!k)continue;if(!(q>0))return need(0,`Enter the fraction of a pack for "${k}" (e.g. 0.5).`);ing[k]=(ing[k]||0)+q;if(+val('rc-$'+i)>0)prices[k]=+val('rc-$'+i)}
  const id=uid();
  ACTIONS.addRecipe({id,name,kcal:+val('rc-k')||0,p:+val('rc-p')||0,c:+val('rc-c')||0,f:+val('rc-f')||0,ing});Object.assign(S.products,prices);
  const r=S.recipes[id];r.tags=val('rc-t').split(',').map(x=>x.trim()).filter(Boolean);if(val('rc-x'))r.notes=val('rc-x');
  clr('rc-n','rc-k','rc-p','rc-c','rc-f','rc-t','rc-x',...[...Array(8).keys()].flatMap(i=>['rc-i'+i,'rc-q'+i,'rc-$'+i]));ok(`Recipe "${name}" added`);save()},
 addExtra(){const it=val('xs-i');if(!need(it,'Type the item first.'))return;add([{type:'addShopping',item:it,qty:Math.max(1,+val('xs-q')||1),price:+val('xs-$')||0,person:P()}],['xs-i','xs-q','xs-$'],'Extra added')},
 bought(i,on){if(S.extras[i]){S.extras[i].bought=on;save()}},
 price(k,v){if(+v>=0){S.products[k]=+v;save()}},
 addBill(){const n=val('bl-n'),a=+val('bl-a');if(!need(n&&a>0,'Bill name and total needed.'))return;
  if(S.bills.some(b=>b.name.toLowerCase()===n.toLowerCase())&&!confirm(`"${n}" is already a bill. Shared bills go in once. Add it again?`))return;
  add([{type:'addBill',name:n,amount:a,freq:val('bl-f','monthly'),due:val('bl-d')}],['bl-n','bl-a','bl-d'],'Bill added')},
 addExpense(){const a=+val('xp-a');if(!need(a>0,'Amount needed.'))return;add([{type:'addExpense',person:P(),cat:val('xp-c','Other'),desc:val('xp-s')||'Expense',amount:a,date:val('xp-d')||today()}],['xp-s','xp-a'],'Expense added')},
 order(){const l=shoppingList();if(!need(l.length,'The shopping list is empty.'))return;
  if(!confirm('Record the Woolworths order? Each person\'s calculated grocery share is added to their expenses (do not enter them again).'))return;
  const d=val('or-d')||today(),act=+val('or-a')||0,n0=S.expenses.length;placeOrder();
  S.expenses.slice(n0).forEach(e=>e.date=d);const o=S.orders.at(-1);o.date=d;if(act>0)o.actual=act;clr('or-d','or-a');ok('Order recorded');save()},
 pct(id,v){const a=S.assignments.find(x=>x.id===id);if(a){a.pct=Math.max(0,Math.min(100,+v||0));save()}},
 addAssignment(){const t=val('as-t'),d=val('as-d');if(!need(t&&d,'Assignment title and due date needed.'))return;add([{type:'addAssignment',person:P(),title:t,course:val('as-c'),due:d}],['as-t','as-c','as-d'],'Assignment added')},
 addExam(){const s=val('ex-s'),d=val('ex-d');if(!need(s&&d,'Subject and date needed.'))return;add([{type:'addExam',person:val('ex-o',P()),subject:s,date:d}],['ex-s','ex-d'],'Exam added')},
 habit(id,d,on){const h=S.habits.find(x=>x.id===id);if(h){(h.log??={})[d]=on;save()}},
 addHabit(){const n=val('hb-n');if(!need(n,'Type a habit first.'))return;add([{type:'addHabit',person:P(),name:n}],['hb-n'],'Habit added')},
 nlm(v){(S.settings.nlmBook??={})[P()]=String(v).trim();save()},
 addFood(){const n=val('fd-n');if(!need(n,'Food and portion needed.'))return;
  add([{type:'logFood',person:P(),name:n,kcal:+val('fd-kcal')||0,p:+val('fd-p')||0,c:+val('fd-c')||0,f:+val('fd-f')||0,date:val('fd-d')||today()}],['fd-n','fd-kcal','fd-p','fd-c','fd-f'],'Food logged')},
 addWorkout(){const t=val('wo-t'),m=+val('wo-m');if(!need(t&&m>0,'Workout and minutes needed.'))return;ACTIONS.addWorkout({person:P(),type:t,mins:m,intensity:val('wo-i','Moderate'),date:val('wo-d')||today()});clr('wo-t','wo-m');ok('Workout added');save()},
 async addNote(){const t=val('nb-t');if(!need(t,'Type a message first.'))return;const j=await call('/api/notes',{who:P(),text:t.slice(0,140),until:val('nb-u')});if(j){NB=j.notes;clr('nb-t','nb-u');ok('Posted')}render()},
 bins(k,v){S.settings.bins={...(S.settings.bins||{}),[k]:v};save()},
 async check(k,v){const j=await call('/api/planner/meta',{person:P(),checks:{[k]:v}});if(j&&PM)PM.meta=j.meta;render()},
 async meta(k,v){const j=await call('/api/planner/meta',{person:P(),[k]:v});if(j&&PM)PM.meta=j.meta;render()},
 reload(){PMP=null;PM=null;MSG='';render()},
 jump:n=>document.getElementById('pl-'+n)?.scrollIntoView({block:'start'})};

// extras belong to the person who adds them (the Woolworths shares follow); older extras without a person stay on Bea as before
const _addShop=ACTIONS.addShopping;ACTIONS.addShopping=a=>{_addShop(a);const e=S.extras.at(-1);if(e&&PEOPLE.includes(a.person))e.person=a.person};

// ---- the tab ----
VIEWS.Planner=()=>{const p=P();
 if(!p)return card('📝 Planner',`<p>Whose planner?</p><div class="row">${PEOPLE.map(x=>`<button onclick="view.person='${x}';render()">${x}</button>`).join('')}</div>`,'wide');
 if(!PROXY.ok)return card('📝 Planner','<p class="mute">The planner needs the fiaOS server (npm start).</p>','wide');
 if(PMP===p&&!PM)return card(`📝 ${p}'s planner`,`<p class="warn">${esc(MSG||'Could not load the planner.')}</p><button onclick="PL.reload()">Try again</button>`,'wide');
 if(PMP!==p||!PM){load();return card(`📝 ${p}'s planner`,'<p class="mute">Loading…</p>','wide')}
 const m=PM.meta,head=card(`📝 ${p}'s FiaOS planner`,`<p class="ex">One card per box on the paper planner. Each answer goes straight into the part of fiaOS (or Notion / Fia Health) shown on the card; shared household items only need entering once.</p>
  <div class="pl-g"><label>Week beginning<input type="date" value="${ea(m.weekOf)}" onchange="PL.meta('weekOf',this.value)"></label><label>Filled in on<input type="date" value="${ea(m.filledOn)}" onchange="PL.meta('filledOn',this.value)"></label></div>
  <div class="row">${PM.map.pages.map(g=>`<button class="sm" onclick="PL.jump(${g.n})">${g.n} · ${esc(g.title)}</button>`).join('')}</div>
  <p><a class="tag" href="${ea(PM.links.fiahealth)}" target="_blank" rel="noopener">Fia Health · ${p} ↗</a> <a class="tag" href="/PLANNER-MAP.md" target="_blank">Planner map</a>${MSG?` <span class="${/^⚠/.test(MSG)?'warn':'mute'}">${esc(MSG)}</span>`:''}</p>`,'wide pl-head');
 return head+PM.map.pages.map(g=>`<section class="card wide pl-page" id="pl-${g.n}"><h3>Page ${g.n} · ${esc(g.title)}</h3></section>`+g.sections.map(s=>B[s.id]?sec(s.id,B[s.id](p),s.id==='recipes'||s.id==='meals'||s.id==='prefs'?'wide':''):'').join('')).join('')};
(async()=>{try{await PROXY_READY}catch{}if(view.tab==='Planner')render()})();
})();
