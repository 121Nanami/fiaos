// fiaOS demo — fictional household Ada, Bea and Cam. Demo data only. Persists in localStorage under fiaos.demo.v1.
const KEY='fiaos.demo.v1', DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], PEOPLE=['Ada','Bea','Cam'];
const aud=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n||0);
const today=()=>new Date().toLocaleDateString('en-CA');
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x.toLocaleDateString('en-CA')};
const daysUntil=d=>Math.round((new Date(d)-new Date(today()))/864e5);
const fmtD=d=>new Date(d).toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});
const uid=()=>Math.random().toString(36).slice(2,9);

function seed(){const day=today();
 const people={Ada:{kcal:2000,p:90,c:220,f:60,goal:'Practice demo science',budget:120},Bea:{kcal:1900,p:85,c:200,f:55,goal:'Finish the demo workshop',budget:100},Cam:{kcal:2400,p:120,c:260,f:75,goal:'Keep a demo training week',budget:80}};
 const recipes={oats:{name:'Demo oats',kcal:420,p:18,c:62,f:11,ing:{'rolled oats 1 kg':0.08,'milk 2 L':0.1}},soup:{name:'Demo soup',kcal:360,p:16,c:48,f:9,ing:{'tomato 400 g':1,'bread loaf':0.25}},bowl:{name:'Demo rice bowl',kcal:540,p:28,c:74,f:12,ing:{'rice 1 kg':0.15,'beans 400 g':0.5}}};
 const blank=()=>Object.fromEntries(DAYS.map(d=>[d,[]]));
 const mealPlan={Ada:{...blank(),Mon:['oats','soup','bowl'],Tue:['oats','bowl','soup']},Bea:{...blank(),Mon:['oats','soup','bowl'],Wed:['soup','oats','bowl']},Cam:{...blank(),Mon:['bowl','soup','oats'],Fri:['oats','bowl','soup']}};
 return{_example:true,people,products:{'rolled oats 1 kg':4.5,'milk 2 L':3.2,'tomato 400 g':1.4,'bread loaf':3,'rice 1 kg':2.5,'beans 400 g':1.6},recipes,mealPlan,
  extras:[{item:'demo tea',qty:1,person:'Ada'}],orders:[],
  foodLog:[{id:'demo-food',person:'Bea',date:day,name:'Demo oats',kcal:420,p:18,c:62,f:11}],
  workouts:[{id:'demo-wo',person:'Cam',date:day,type:'Demo walk',mins:30,intensity:'Low'}],
  assignments:[{id:'demo-as',person:'Bea',title:'Demo essay',course:'DEMO101',due:addDays(day,12),pct:20}],
  exams:[{id:'demo-ex',person:'Ada',subject:'Demo quiz',date:addDays(day,14)}],
  expenses:[{id:'demo-exp',person:'Cam',date:day,cat:'Demo',desc:'Demo coffee',amount:4.5}],
  bills:[{id:'demo-bill',name:'Demo power',amount:120,freq:'quarterly',due:addDays(day,21)}],
  habits:[{id:'demo-hab',person:'Ada',name:'Read one demo page',log:{}}],
  chores:[{id:'demo-ch',person:'Cam',name:'Take the demo bins out',day:'Tue',done:false}],
  settings:{apiKey:'',model:'grok-4',housemates:3,persona:true,loc:{name:'Demo Harbour',lat:-35,lon:149},homeProfile:'Bea',bins:{day:'Monday',recycleAnchor:'2026-01-05',greenAnchor:'',src:'Demo Shire collection — Demo Lane, Demo Harbour (example only)'}},
  chat:[]};}

var PENDING=false;
let S=JSON.parse(localStorage.getItem(KEY)||'null')||seed();
let view={person:'Bea',tab:'Stage'};
const ME=()=>view.person==='Household'?(S.settings.homeProfile&&S.settings.homeProfile!=='Household'?S.settings.homeProfile:'Bea'):view.person;
const save=()=>{localStorage.setItem(KEY,JSON.stringify(S));render()};
const who=()=>view.person==='Household'?PEOPLE:[view.person];

// ===== Interconnection engine =====
function intake(p,d=today()){return S.foodLog.filter(x=>x.person===p&&x.date===d).reduce((a,x)=>({kcal:a.kcal+ +x.kcal,p:a.p+ +x.p,c:a.c+ +x.c,f:a.f+ +x.f}),{kcal:0,p:0,c:0,f:0})}
function planTotals(p,day){return (S.mealPlan[p][day]||[]).reduce((a,r)=>{const x=S.recipes[r];return x?{kcal:a.kcal+x.kcal,p:a.p+x.p}:a},{kcal:0,p:0})}
function shoppingList(){ // meal plan (all people x 7 days) -> aggregated Woolworths packs
 const need={},by={};PEOPLE.forEach(p=>DAYS.forEach(d=>(S.mealPlan[p][d]||[]).forEach(r=>{const x=S.recipes[r];if(!x)return;for(const[i,q]of Object.entries(x.ing)){need[i]=(need[i]||0)+q;by[i]=by[i]||{};by[i][p]=(by[i][p]||0)+q}})));
 S.extras.forEach(e=>{const w=PEOPLE.includes(e.person)?e.person:'Bea';need[e.item]=(need[e.item]||0)+e.qty;by[e.item]=by[e.item]||{};by[e.item][w]=(by[e.item][w]||0)+e.qty}); // extras are charged to whoever added them (older ones: Bea)
 return Object.entries(need).map(([item,q])=>{const packs=Math.ceil(q-1e-9),price=S.products[item]||0;return{item,packs,price,cost:packs*price,share:by[item],q}}).sort((a,b)=>a.item.localeCompare(b.item))}
function groceryShare(list){const s=Object.fromEntries(PEOPLE.map(p=>[p,0]));list.forEach(l=>{const tot=l.q;for(const[p,q]of Object.entries(l.share)){if(p==='Household')PEOPLE.forEach(x=>s[x]+=l.cost*q/tot/PEOPLE.length);else s[p]+=l.cost*q/tot}});return s}
function examSoon(p,days=7){return S.exams.filter(e=>e.person===p&&daysUntil(e.date)>=0&&daysUntil(e.date)<=days)}
function baseWorkout(p){const t=S.people[p],i=intake(p),hr=new Date().getHours(),exp=t.kcal*Math.min(1,Math.max(.3,(hr-6)/15)),diff=i.kcal-exp,ex=examSoon(p);
 let type,intensity,mins,why=[];
 if(diff>300){type='Cardio / HIIT';intensity='High';mins=40;why.push(`${Math.round(diff)} kcal ahead of pace`)}
 else if(diff<-500){type='Mobility / light walk';intensity='Low';mins=25;why.push(`under-fuelled by ${Math.round(-diff)} kcal — eat before training`)}
 else{type=/muscle|strength/i.test(t.goal)?'Strength':'Run / Strength mix';intensity='Moderate';mins=50;why.push('intake on track')}
 if(i.p<t.p*.5&&hr>14)why.push('protein low — add a high-protein meal');
 if(ex.length){mins=Math.round(mins*.6);if(intensity==='High')intensity='Moderate';why.push(`exam week (${ex[0].subject}) — load reduced 40%`)}
 return{type,intensity,mins,why}}
function studyBlocks(){const out=[];S.exams.forEach(e=>{const n=daysUntil(e.date);if(n<0||n>14)return;for(let k=Math.min(n,14);k>=1;k--){const d=addDays(e.date,-k);if(daysUntil(d)<0)continue;const hrs=k<=3?3:k<=7?2:1;out.push({person:e.person,date:d,title:`Study: ${e.subject}`,hrs})}});return out}
const H=()=>Math.max(1,+S.settings.housemates||1);
function billShares(){return S.bills.map(b=>({...b,each:b.amount/H()}))}
const monthly=b=>b.freq==='once'?0:b.freq==='weekly'?b.amount*52/12:b.freq==='fortnightly'?b.amount*26/12:b.freq==='quarterly'?b.amount/3:b.amount;
function weekSpend(p){return S.expenses.filter(e=>e.person===p&&daysUntil(e.date)>-7&&daysUntil(e.date)<=0).reduce((a,e)=>a+ +e.amount,0)}
function baseAgenda(){const it=[];const P=who();
 S.assignments.forEach(a=>P.includes(a.person)&&a.pct<100&&it.push({date:a.due,person:a.person,txt:`📝 ${a.title} due (${a.course})`}));
 S.exams.forEach(e=>P.includes(e.person)&&it.push({date:e.date,person:e.person,txt:`🎓 EXAM ${e.subject}`}));
 studyBlocks().forEach(b=>P.includes(b.person)&&it.push({date:b.date,person:b.person,txt:`📚 ${b.title} · ${b.hrs}h`}));
 S.bills.forEach(b=>it.push({date:b.due,person:'Home',txt:`💳 ${b.name} ${aud(b.amount)} (${aud(b.amount/H())} each)`}));
 return it.filter(x=>daysUntil(x.date)>=0&&daysUntil(x.date)<=14).sort((a,b)=>a.date.localeCompare(b.date))}

// ===== Actions (used by UI and AI) =====
const ACTIONS={
 setMeal:({person,day,slot,recipe})=>{if(S.recipes[recipe]&&S.mealPlan[person]){S.mealPlan[person][day]=S.mealPlan[person][day]||[];S.mealPlan[person][day][slot??0]=recipe}},
 addRecipe:({id,name,kcal,p,c,f,ing})=>{id=id||uid();S.recipes[id]={name,kcal:+kcal,p:+p,c:+c,f:+f,ing:ing||{}};Object.keys(ing||{}).forEach(i=>S.products[i]??=5)},
 logFood:a=>S.foodLog.push({id:uid(),date:today(),...a}),
 addWorkout:a=>S.workouts.push({id:uid(),date:today(),...a}),
 addAssignment:a=>S.assignments.push({id:uid(),pct:0,...a}),
 addExam:a=>S.exams.push({id:uid(),...a}),
 addExpense:a=>S.expenses.push({id:uid(),date:today(),...a,amount:+a.amount}),
 addBill:a=>S.bills.push({id:uid(),...a,amount:+a.amount}),
 addShopping:({item,qty,price})=>{S.extras.push({item,qty:+qty||1});if(price)S.products[item]=+price;else S.products[item]??=5},
 addHabit:a=>S.habits.push({id:uid(),log:{},...a}),
 addChore:a=>S.chores.push({id:uid(),done:false,...a}),
 updateTargets:({person,...t})=>Object.assign(S.people[person],t),
 placeOrder:()=>placeOrder()};
function apply(acts){let n=0;(acts||[]).forEach(a=>{const f=ACTIONS[a.type];if(f){try{f(a);n++}catch(e){console.warn(e)}}});save();return n}
function placeOrder(){const l=shoppingList(),sh=groceryShare(l),tot=l.reduce((a,x)=>a+x.cost,0);
 PEOPLE.forEach(p=>S.expenses.push({id:uid(),person:p,date:today(),cat:'Groceries',amount:+sh[p].toFixed(2),desc:'Woolworths order (share)'}));
 S.orders.push({id:uid(),date:today(),total:tot,items:l.length});S.extras=[]}

// ===== UI =====
const $=s=>document.querySelector(s), el=(h)=>{const d=document.createElement('div');d.innerHTML=h;return d.firstElementChild};
const TABS=['Stage','Meals & Diet','Woolworths','Workouts','Study','Money','Habits & Chores','Settings'];
const bar=(v,m)=>`<div class="bar"><i class="${v>m?'over':''}" style="width:${Math.min(100,v/m*100)}%"></i></div>`;
function card(t,b,c=''){return`<section class="card ${c}"><h3>${t}</h3>${b}</section>`}
// Grok status: 'local' (browser key) · 'server' (fiaOS server holds the key) · 'checking' (health not back yet) · 'none'
function grokState(){let P;try{P=PROXY}catch{return S.settings.apiKey?'local':'checking'}return P.xai?'server':S.settings.apiKey?'local':P.checked?'none':'checking'}
function greeting(){const g=grokState(),hi=`♪ Hi ${ME()}! I'm ${HELPER}.`;
 return g==='none'?`${hi} No xAI key yet — add one in Settings. Offline I can still "plan my meals for the week" or suggest a "workout".`
  :g==='checking'?`${hi} Connecting to Grok…`:`${hi} Grok is connected — ask me anything about the household.`}
function render(){
 
 $('#nav').innerHTML=TABS.map(t=>`<button class="${view.tab===t?'on':''}" onclick="view.tab='${t}';render()">${t}</button>`).join('');
 $('#main').innerHTML=(S._example?card('⚠ EXAMPLE DATA','<span class="ex">All people, meals, prices, bills and dates are example seed data. Reset or edit in Settings.</span>','wide'):'')+VIEWS[view.tab]();
 $('#chat').innerHTML=(S.chat.length?S.chat:[{role:'assistant',content:greeting()}]).map(m=>`<div class="msg ${m.role==='user'?'u':''}">${esc(m.content)}</div>`).join('')+(PENDING?'<div class="msg">♪ Thinking…</div>':'');$('#chat').scrollTop=1e9}
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const opts=(arr,sel)=>arr.map(o=>`<option ${o===sel?'selected':''}>${o}</option>`).join('');
const VIEWS={
 Stage(){return mikuSays()+songCard()+who().map(p=>{const i=intake(p),t=S.people[p],w=workoutSuggestion(p);return card(`${p} · ${t.goal}`,`Calories ${i.kcal}/${t.kcal}${bar(i.kcal,t.kcal)}Protein ${i.p}/${t.p}g${bar(i.p,t.p)}
  <b>Suggested workout:</b> ${w.type} · ${w.intensity} · ${w.mins} min<br><small>${w.why.join(' · ')}</small><br><br>
  Spend this week ${aud(weekSpend(p))} / budget ${aud(t.budget)}${bar(weekSpend(p),t.budget)}${examSoon(p).map(e=>`<span class="tag warn">Exam in ${daysUntil(e.date)}d: ${e.subject}</span>`).join('')}`)}).join('')
  +card('♪ Setlist — next 14 days',`${typeof calToggle==='function'?calToggle():''}<table>${agenda().map(a=>`<tr><td>${fmtD(a.date)}</td><td>${a.who||a.person}</td><td>${a.txt}</td></tr>`).join('')}</table>`,'wide')},
 'Meals & Diet'(){const R=Object.entries(S.recipes);return who().map(p=>{const t=S.people[p];return card(`${p} meal plan (target ${t.kcal} kcal / ${t.p}g P)`,`<table>${DAYS.map(d=>{const pt=planTotals(p,d);return`<tr><td>${d}</td>${[0,1,2].map(s=>`<td><select onchange="apply([{type:'setMeal',person:'${p}',day:'${d}',slot:${s},recipe:this.value}])">${R.map(([k,r])=>`<option value="${k}" ${S.mealPlan[p][d][s]===k?'selected':''}>${r.name}</option>`).join('')}</select></td>`).join('')}<td class="${Math.abs(pt.kcal-t.kcal)>400?'warn':''}">${pt.kcal}</td></tr>`}).join('')}</table>`,'wide')
  +card(`${p} food log today`,`<table>${S.foodLog.filter(x=>x.person===p&&x.date===today()).map(x=>`<tr><td>${esc(x.name)}</td><td>${x.kcal} kcal</td><td>P${x.p} C${x.c} F${x.f}</td></tr>`).join('')}</table>
  <div class="row"><select id="lf-${p}">${R.map(([k,r])=>`<option value="${k}">${r.name}</option>`).join('')}</select><button onclick="const r=S.recipes[$('#lf-${p}').value];apply([{type:'logFood',person:'${p}',name:r.name,kcal:r.kcal,p:r.p,c:r.c,f:r.f}])">+ Log</button></div>`)}).join('')},
 Woolworths(){const l=shoppingList(),tot=l.reduce((a,x)=>a+x.cost,0),sh=groceryShare(l);return card('🛒 Woolworths list — auto-built from your 7-day meal plan',`<table><tr><th>Item</th><th>Packs</th><th>Each</th><th>Cost</th><th>Who</th></tr>${l.map(x=>`<tr><td>${x.item}</td><td>${x.packs}</td><td>${aud(x.price)}</td><td>${aud(x.cost)}</td><td>${Object.keys(x.share).map(p=>`<span class="tag">${p}</span>`).join('')}</td></tr>`).join('')}</table>
  <h3>Total ${aud(tot)}</h3>${PEOPLE.map(p=>`<span class="tag">${p}: ${aud(sh[p])}</span>`).join('')}<br><br>
  <div class="row"><input id="ex-i" placeholder="Add extra item"><button onclick="apply([{type:'addShopping',item:$('#ex-i').value,qty:1}])">Add</button><button class="on" onclick="placeOrder();save()">Mark order placed → Expenses</button></div>
  <p class="ex">Ordering on woolworths.com.au needs browser automation (no public API). This button records the order and splits cost into each person's expenses.</p>`,'wide')
  +card('Past orders',S.orders.map(o=>`${fmtD(o.date)} · ${o.items} items · ${aud(o.total)}${o.actual?` · paid ${aud(o.actual)}`:''}`).join('<br>')||'None yet')},
 Workouts(){return who().map(p=>{const w=workoutSuggestion(p);return card(`${p}`,`<b>Today:</b> ${w.type} · ${w.intensity} · ${w.mins} min<br><small>${w.why.join(' · ')}</small>
  <div class="row"><button onclick="ACTIONS.addWorkout({person:'${p}',type:'${w.type}',mins:${w.mins},intensity:'${w.intensity}'});save()">✓ Done</button></div>
  <table>${S.workouts.filter(x=>x.person===p).slice(-6).reverse().map(x=>`<tr><td>${fmtD(x.date)}</td><td>${x.type}</td><td>${x.mins}m</td><td>${x.intensity}</td></tr>`).join('')}</table>`)}).join('')},
 Study(){const P=who();return card('Assignments',`<table>${S.assignments.filter(a=>P.includes(a.person)).sort((a,b)=>a.due.localeCompare(b.due)).map(a=>`<tr><td>${a.person}</td><td>${esc(a.title)}<br><small>${a.course}</small></td><td>${fmtD(a.due)} (${daysUntil(a.due)}d)</td><td><button class="sm" onclick="S.assignments.find(x=>x.id==='${a.id}').pct=Math.min(100,${a.pct}+20);save()">${a.pct}%</button></td></tr>`).join('')}</table>
  <div class="row"><select id="as-p">${opts(PEOPLE)}</select><input id="as-t" placeholder="Title"><input id="as-d" type="date"><button onclick="apply([{type:'addAssignment',person:$('#as-p').value,title:$('#as-t').value,course:'',due:$('#as-d').value}])">+</button></div>`,'wide')
  +card('Exams',`<table>${S.exams.filter(e=>P.includes(e.person)).map(e=>`<tr><td>${e.person}</td><td>${e.subject}</td><td>${fmtD(e.date)} (${daysUntil(e.date)}d)</td></tr>`).join('')}</table>
  <div class="row"><select id="exm-p">${opts(PEOPLE)}</select><input id="exm-s" placeholder="Subject"><input id="exm-d" type="date"><button onclick="apply([{type:'addExam',person:$('#exm-p').value,subject:$('#exm-s').value,date:$('#exm-d').value}])">+</button></div>`)
  +card('Auto study blocks (from exam dates)',`<table>${studyBlocks().filter(b=>P.includes(b.person)).map(b=>`<tr><td>${fmtD(b.date)}</td><td>${b.person}</td><td>${b.title}</td><td>${b.hrs}h</td></tr>`).join('')}</table>`)},
 Money(){const P=who(),bs=billShares(),mt=S.bills.reduce((a,b)=>a+monthly(b),0);return card(`💳 Bills & rent — split ${H()} ways (Ada · Bea · Cam)`,`<table><tr><th>Bill</th><th>Amount</th><th>Freq</th><th>Due</th><th>Each</th></tr>${bs.map(b=>`<tr><td>${b.name}</td><td>${aud(b.amount)}</td><td>${b.freq}</td><td>${fmtD(b.due)}</td><td>${aud(b.each)}</td></tr>`).join('')}</table><h3>Monthly fixed: ${aud(mt)} · ${aud(mt/H())} per person</h3>`,'wide')
  +P.map(p=>{const ex=S.expenses.filter(e=>e.person===p),cats={};ex.forEach(e=>cats[e.cat]=(cats[e.cat]||0)+ +e.amount);return card(`${p} expenses`,`Week ${aud(weekSpend(p))} / ${aud(S.people[p].budget)}${bar(weekSpend(p),S.people[p].budget)}${Object.entries(cats).map(([c,v])=>`<span class="tag">${c} ${aud(v)}</span>`).join('')}<table>${ex.slice(-5).reverse().map(e=>`<tr><td>${fmtD(e.date)}</td><td>${esc(e.desc)}</td><td>${aud(e.amount)}</td></tr>`).join('')}</table>
  <div class="row"><input id="e-${p}" placeholder="Desc"><input id="ea-${p}" type="number" placeholder="$" style="max-width:100px"><button onclick="apply([{type:'addExpense',person:'${p}',cat:'Other',desc:$('#e-${p}').value,amount:$('#ea-${p}').value}])">+</button></div>`)}).join('')},
 'Habits & Chores'(){const P=who(),t=today();return card('Habits (tap to tick today)',S.habits.filter(h=>P.includes(h.person)).map(h=>`<button class="${h.log[t]?'on':''}" style="margin:4px" onclick="const h=S.habits.find(x=>x.id==='${h.id}');h.log['${t}']=!h.log['${t}'];save()">${h.person}: ${esc(h.name)} ${h.log[t]?'✓':''} · ${Object.values(h.log).filter(Boolean).length}🔥</button>`).join(''))
  +card('Chore roster',S.chores.filter(c=>P.includes(c.person)||c.person==='Everyone').map(c=>`<button class="${c.done?'on':''}" style="margin:4px" onclick="const c=S.chores.find(x=>x.id==='${c.id}');c.done=!c.done;save()">${c.day} · ${c.person}: ${c.name} ${c.done?'✓':''}</button>`).join(''))},
 Settings(){const g=grokState();return card('xAI Grok API',`<p class="grokst">${g==='server'?'✅ Grok connected via fiaOS server — no key needed on this device.':g==='local'?'✅ Grok connected with this browser\'s key.':g==='checking'?'Checking the fiaOS server…':'No Grok key yet. Add one below, or put XAI_API_KEY in the fiaOS server\'s .env.'}</p><label>${g==='server'?'Optional browser key (leave blank to use the server)':'API key'} (stored only in this browser's localStorage)<input id="k" type="password" value="${S.settings.apiKey}"></label><label>Model<input id="m" value="${S.settings.model}"></label><label>Housemates sharing bills<input id="hm" type="number" value="${S.settings.housemates}"></label><label><input type="checkbox" id="ps" ${S.settings.persona?'checked':''} style="min-height:auto;flex:none;width:28px;height:28px"> Use cheerful "${HELPER}" helper persona</label><button onclick="S.settings.apiKey=$('#k').value.trim();S.settings.model=$('#m').value.trim();S.settings.housemates=+$('#hm').value;S.settings.persona=$('#ps').checked;save()">Save</button>`)
  +card('Targets',PEOPLE.map(p=>`<div class="row"><b style="width:60px">${p}</b><input value="${esc(S.people[p].goal||'').replace(/"/g,'&quot;')}" title="goal" placeholder="goal" onchange="S.people['${p}'].goal=this.value.trim();save()">${['kcal','p','c','f','budget'].map(k=>`<input type="number" value="${S.people[p][k]}" title="${k}" onchange="S.people['${p}'].${k}=+this.value;save()">`).join('')}</div>`).join('')+'<small>goal · kcal · protein g · carbs g · fat g · weekly budget AUD</small>')
  +card('Data',`<button onclick="if(confirm('Reset to the demo household?')){localStorage.removeItem('${KEY}');S=seed();save()}">Reset to empty</button> <button onclick="S._example=false;save()">Hide example banner</button> <button onclick="S.chat=[];save()">Clear chat</button>`)}};

// ===== AI =====
const HELPER='Negi-chan',PERSONA='Speak as Negi-chan, a cheerful, encouraging pop-idol-style helper with musical puns and the odd ♪ — but keep facts exact.';
const sys=()=>`You are the fiaOS assistant for a household of Ada, Bea and Cam (en-AU, AUD). The person currently selected on screen is given as viewing. You get the full app state as JSON. Answer concisely and, when useful, change the app by returning actions. ${S.settings.persona?PERSONA:''} ALWAYS reply with a JSON object: {"reply":"text for user","actions":[...]}.
Action types: setMeal{person,day(Mon..Sun),slot(0 breakfast,1 lunch,2 dinner),recipe(existing recipe id)}; addRecipe{id,name,kcal,p,c,f,ing:{"<Woolworths product>":packFraction}}; logFood{person,name,kcal,p,c,f}; addWorkout{person,type,mins,intensity}; addAssignment{person,title,course,due(YYYY-MM-DD)}; addExam{person,subject,date}; addExpense{person,cat,desc,amount}; addBill{name,amount,freq,due}; addShopping{item,qty,price}; addHabit{person,name}; addChore{person,name,day}; updateTargets{person,kcal,p,c,f,budget}; placeOrder{}; addNote{person,text,until} (family message board, e.g. "out till 6"; until like "6pm"/"tonight"/"tomorrow" or empty).
addRecipe must come before setMeal that uses it. Meal plans feed the Woolworths list; keep daily kcal near each person's target.`;
function ctx(){const{settings,chat,...st}=S;return JSON.stringify({today:today(),viewing:view.person,...st,derived:{shoppingList:shoppingList(),workoutSuggestions:Object.fromEntries(PEOPLE.map(p=>[p,workoutSuggestion(p)])),studyBlocks:studyBlocks(),agenda:agenda()}})}
// Chat: always goes through the fiaOS server when it has the key (a browser-saved key is only a fallback — xAI's CORS blocks the Authorization header from Safari).
// If the first /api/health check failed (iPad waking up, Wi-Fi slow), it re-checks before giving up. Shows a "thinking" bubble; 2-minute timeout.
const STALE=m=>m.role==='assistant'&&(/^⚠/.test(m.content)||/Add an xAI key in Settings/.test(m.content)||/^Offline planner:/.test(m.content));
async function ask(q){S.chat.push({role:'user',content:q});PENDING=true;save();let out;
 try{if(!PROXY.checked)await PROXY_READY;if(!PROXY.xai)await detectProxy(15000);
  const viaServer=PROXY.xai,key=S.settings.apiKey;
  if(!viaServer&&!key)throw new Error(`Can't reach the fiaOS server (${location.host||'no server'}). Is the Mac awake and on the same Wi-Fi?`);
  const ac=new AbortController(),to=setTimeout(()=>ac.abort(),125e3);let r;
  try{r=await fetch(viaServer?'/api/grok':'https://api.x.ai/v1/chat/completions',{method:'POST',cache:'no-store',signal:ac.signal,headers:{'Content-Type':'application/json',...(viaServer?{}:{Authorization:'Bearer '+key})},body:JSON.stringify({model:S.settings.model||'grok-4',response_format:{type:'json_object'},messages:[{role:'system',content:sys()},{role:'system',content:'STATE: '+ctx()},...S.chat.filter(m=>!STALE(m)).slice(-10).map(m=>({role:m.role,content:m.content}))]})})}
  catch(e){throw new Error(e.name==='AbortError'?'Grok took too long to answer.':`Couldn't reach ${viaServer?'the fiaOS server':'xAI'} (${e.message}).`)}
  finally{clearTimeout(to)}
  if(!r.ok){let m=(await r.text()).slice(0,300);try{m=JSON.parse(m).error||m}catch{}throw new Error('Grok error '+r.status+': '+(typeof m==='string'?m:JSON.stringify(m)))}
  const j=await r.json(),txt=j.choices[0].message.content;try{out=JSON.parse(txt.replace(/^```json|```$/g,''))}catch{out={reply:txt}}
  const n=apply(out.actions);S.chat.push({role:'assistant',content:(out.reply||'')+(n?`\n✅ Applied ${n} action(s).`:'')})}
 catch(e){S.chat.push({role:'assistant',content:'⚠ '+e.message+'\n(Falling back to offline mode.)'});const o=offline(q);const n=apply(o.actions);S.chat.push({role:'assistant',content:o.reply+(n?`\n✅ Applied ${n}.`:'')})}
 PENDING=false;save()}
function offline(q){const p=PEOPLE.find(x=>q.toLowerCase().includes(x.toLowerCase()))||ME();if(/\b39\b/.test(q))egg();
 if(/plan/i.test(q)&&/meal/i.test(q)&&p){const t=S.people[p],R=Object.keys(S.recipes),acts=[];
  DAYS.forEach(d=>{let best,bd=1e9;for(const a of R)for(const b of R)for(const c of R){const k=S.recipes[a].kcal+S.recipes[b].kcal+S.recipes[c].kcal;const sc=Math.abs(k-t.kcal)+Math.random()*150;if(sc<bd){bd=sc;best=[a,b,c]}}best.forEach((r,s)=>acts.push({type:'setMeal',person:p,day:d,slot:s,recipe:r}))});
  return{reply:`Offline planner: built ${p}'s 7-day plan near ${t.kcal} kcal/day. Woolworths list updated.`,actions:acts}}
 if(/workout/i.test(q)&&p){const w=workoutSuggestion(p);return{reply:`${p}: ${w.type}, ${w.intensity}, ${w.mins} min — ${w.why.join('; ')}`}}
 return{reply:'♪ Offline I understand "plan my meals for the week" and "workout". Add an xAI key in Settings for full Grok answers.'}}

$('#send').onclick=()=>{const v=$('#ask').value.trim();if(v){$('#ask').value='';ask(v)}};
$('#ask').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();$('#send').click()}}; // must not return false: that cancels every keystroke
const tick=()=>{$('#clock').textContent=new Date().toLocaleString('en-AU',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});setTimeout(tick,60500-Date.now()%60e3)};tick();

// ===== Miku-inspired extras (original artwork, no official assets) =====
const SONGS=[['World is Mine','ryo (supercell)'],['Senbonzakura','Kurousa-P'],['Tell Your World','livetune'],['Ievan Polkka','traditional / Otomania'],['Melt','ryo (supercell)'],['Rolling Girl','wowaka'],['Love is War','ryo (supercell)'],['Hibikase','GigaP'],['Sand Planet','Hachi'],['Unknown Mother-Goose','wowaka'],['Miku','Anamanaguchi'],['Ghost Rule','DECO*27'],['Vampire','DECO*27'],['Hatsune Miku no Shoushitsu','cosMo@Bousou-P'],['Glow','keeno'],['Two-Faced Lovers','wowaka'],['Rabbit Hole','DECO*27'],['Decorator','livetune'],['Weekender Girl','kz / Hachioji-P'],['Aishite Aishite Aishite','Kikuo']];
const yt=q=>'https://www.youtube.com/results?search_query='+encodeURIComponent(q);
function songCard(){const d=Math.floor((Date.now()-new Date(new Date().getFullYear(),0,0))/864e5),i=d%SONGS.length,[n,a]=SONGS[i];
 return card('🎵 Song of the day (link)',`<b style="font-size:24px">${n}</b><br><small>${a}</small><br><a class="btn" target="_blank" href="${yt(n+' '+a+' Hatsune Miku')}">▶ Listen on YouTube</a>
 <details><summary>Playlist (${SONGS.length})</summary>${SONGS.map(([n,a])=>`<a class="tag" target="_blank" href="${yt(n+' '+a+' Hatsune Miku')}">♪ ${n}</a>`).join('')}</details>`)}
function mikuSays(){const t=[],me=ME(),w=workoutSuggestion(me),i=intake(me),ex=examSoon(me,7);
 if(ex.length)t.push(`Your ${ex[0].subject} is in ${daysUntil(ex[0].date)} days — I lightened your workouts so you can shine on exam day! ✨`);
 const a=S.assignments.filter(x=>x.person===me&&x.pct<100).sort((x,y)=>x.due.localeCompare(y.due))[0];if(a)t.push(`Next up: "${a.title}" due ${fmtD(a.due)}. You're ${a.pct}% there — let's go!`);
 t.push(`Today's move: ${w.type} for ${w.mins} min. You've got this.`);
 if(i.p<S.people[me].p*.5)t.push('Protein is low today — a yoghurt or tuna wrap would help!');
 return card(`<span class="tt"></span> ${HELPER} says… <small style="color:var(--t2)">(for ${me})</small>`,t.map(x=>`<div class="bubble">${x}</div>`).join(''),'wide says')}
function egg(){const o=el(`<div id="egg"><div class="big39">39</div><div>San-kyu, Bea! ミク ♪ Thank you!</div></div>`);for(let k=0;k<39;k++){const n=document.createElement('span');n.className='note';n.textContent='♪♫♬✦'[k%4];n.style.left=Math.random()*100+'vw';n.style.animationDelay=Math.random()*1.5+'s';n.style.color=k%3?'#39C5BB':'#E12885';o.appendChild(n)}document.body.appendChild(o);o.onclick=()=>o.remove();setTimeout(()=>o.remove(),5000)}
let kb='';document.addEventListener('keydown',e=>{if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable)return;kb=(kb+e.key).slice(-2);if(kb==='39')egg()});
let taps=0,tt;document.querySelector('.brand').onclick=()=>{taps++;clearTimeout(tt);tt=setTimeout(()=>taps=0,1500);if(taps===3){taps=0;egg()}};
const sp=document.getElementById('splash');if(sp){const hide=()=>{sp.classList.add('out');setTimeout(()=>sp.remove(),700)};sp.onclick=hide;setTimeout(hide,1600)}
// ===== Live integrations (no accounts/keys) =====
let PROXY={ok:false,xai:false,checked:false},W=null,OFF=[],WW={},ICSMSG='';
S.settings.loc??={name:'Demo Harbour',lat:-35,lon:149};S.icsEvents??=[];S.settings.ics??='';
async function detectProxy(ms=10000){if(location.protocol!=='file:')for(let i=0;i<2&&!PROXY.xai;i++)try{const ac=new AbortController(),to=setTimeout(()=>ac.abort(),ms);const r=await fetch('/api/health?t='+Date.now(),{signal:ac.signal,cache:'no-store'});clearTimeout(to);if(r.ok)PROXY=await r.json()}catch{}
 PROXY.checked=true;if(PROXY.xai&&S.chat.some(STALE)){S.chat=S.chat.filter(m=>!STALE(m));save()}render()}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!PROXY.xai)detectProxy()});
// (1) Open-Meteo
const WMO={0:'Clear ☀️',1:'Mostly clear 🌤',2:'Partly cloudy ⛅',3:'Overcast ☁️',45:'Fog 🌫',48:'Fog 🌫',51:'Drizzle 🌦',53:'Drizzle 🌦',55:'Drizzle 🌦',61:'Rain 🌧',63:'Rain 🌧',65:'Heavy rain 🌧',80:'Showers 🌦',81:'Showers 🌧',82:'Violent showers ⛈',95:'Thunderstorm ⛈',96:'Storm + hail ⛈',99:'Storm + hail ⛈'};
async function loadWeather(){const L=S.settings.loc;try{const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${L.lat}&longitude=${L.lon}&current=temperature_2m,apparent_temperature,precipitation,weather_code,uv_index&hourly=precipitation_probability,temperature_2m,weather_code,cape&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&forecast_days=3&timezone=auto`);W=await r.json();W.at=new Date();render();window.stormCheck&&stormCheck()}catch(e){W={error:e.message};render()}}
function weatherFlags(){if(!W||!W.current)return null;const c=W.current,h=new Date().getHours(),pp=(W.hourly.precipitation_probability||[]).slice(h,h+4),rainP=Math.max(0,...pp),
 rain=c.precipitation>0.2||rainP>=60||[61,63,65,80,81,82,95,96,99].includes(c.weather_code),hot=c.apparent_temperature>=32||W.daily.temperature_2m_max[0]>=34;return{rain,hot,rainP,c}}
function workoutSuggestion(p){const w=baseWorkout(p),f=weatherFlags();if(!f)return w;
 const outdoor=/run|walk|cardio/i.test(w.type);
 if(f.rain&&outdoor){w.type=w.type.replace(/Cardio \/ HIIT/,'Indoor HIIT / spin').replace(/Run/,'Treadmill / indoor').replace(/light walk/,'yoga flow').replace(/^Brisk walk$/,'Indoor walk / treadmill').replace(/Recovery walk \+ stretch/,'Recovery · stretch & mobility');w.why.push(`rain likely (${f.rainP}%) — moved indoors`)}
 else if(f.hot){w.type=outdoor?w.type+' (indoors or before 7am)':w.type;w.mins=Math.round(w.mins*.85);w.why.push(`hot (${Math.round(f.c.apparent_temperature)}°C feels-like) — shorter, hydrate`)}
 else if(outdoor)w.why.push('nice weather — go outside!');return w}
function weatherCard(){if(!W)return card('🌦 Weather','Loading Open-Meteo…');if(W.error)return card('🌦 Weather',`<span class="warn">Weather unavailable: ${esc(W.error)}</span>`);
 const c=W.current,d=W.daily,f=weatherFlags();return card(`🌦 ${esc(S.settings.loc.name)} weather`,`<b style="font-size:40px;color:var(--t2)">${Math.round(c.temperature_2m)}°C</b> ${WMO[c.weather_code]||''}<br>Feels ${Math.round(c.apparent_temperature)}°C · UV ${c.uv_index}<br>
 ${d.time.map((t,i)=>`<span class="tag">${fmtD(t)}: ${Math.round(d.temperature_2m_min[i])}–${Math.round(d.temperature_2m_max[i])}° · ${d.precipitation_probability_max[i]}% rain</span>`).join('')}
 <br><small>${f.rain?'☔ Indoor workout day':f.hot?'🥵 Hot — train early':'🎶 Outdoor-friendly'} · live from Open-Meteo, ${W.at.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}</small>`)}
async function setLocation(q){const r=await(await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name='+encodeURIComponent(q))).json();const x=r.results?.[0];if(!x){alert('Place not found');return}S.settings.loc={name:`${x.name}${x.admin1?', '+x.admin1:''}`,lat:x.latitude,lon:x.longitude};save();loadWeather()}
// (2) Open Food Facts
async function offSearch(q){OFF=[{loading:true}];render();const F='code,product_name,brands,serving_size,serving_quantity,nutriments';
 try{let list;if(/^\d{8,14}$/.test(q.trim())){const j=await(await fetch(`https://world.openfoodfacts.org/api/v2/product/${q.trim()}.json?fields=${F}`)).json();list=j.product?[{...j.product,code:q.trim()}]:[]}
 else{if(!PROXY.ok){OFF=[{err:'Name search needs the local proxy (run npm start; Open Food Facts search blocks browser CORS). Barcode lookup works here.'}];render();return}
  const j=await(await fetch('/api/off?au=1&q='+encodeURIComponent(q))).json();list=j.products||[];
  if(!list.length){const j2=await(await fetch('/api/off?q='+encodeURIComponent(q))).json();list=j2.products||[]}}
 OFF=list.filter(p=>p.nutriments&&p.nutriments['energy-kcal_100g']!=null).map(p=>{const n=p.nutriments,srv=p.serving_quantity&&n['energy-kcal_serving']!=null,k=srv?'_serving':'_100g',g=x=>Math.round((n[x+k]||0)*10)/10;
  return{name:`${p.product_name||'?'}${p.brands?' ('+p.brands.split(',')[0]+')':''}`,code:p.code,per:srv?p.serving_size:'100 g',kcal:Math.round(n['energy-kcal'+k]),p:g('proteins'),c:g('carbohydrates'),f:g('fat')}});if(!OFF.length)OFF=[{none:true}]}catch(e){OFF=[{err:e.message}]}render()}
function offCard(){return card('🔎 Open Food Facts — search or barcode',`<div class="row"><input id="offq" placeholder="e.g. Chobani yoghurt or 9300601…"><button onclick="offSearch($('#offq').value)">Search</button></div>
 <table>${OFF.map((x,i)=>x.loading?'<tr><td>Searching…</td></tr>':x.none?'<tr><td>No matches with nutrition data.</td></tr>':x.err?`<tr><td class="warn">${esc(x.err)}</td></tr>`:`<tr><td>${esc(x.name)}<br><small>per ${esc(x.per)} · P${x.p} C${x.c} F${x.f}</small></td><td>${x.kcal} kcal</td><td><button class="sm" onclick="const x=OFF[${i}];apply([{type:'logFood',person:ME(),name:x.name+' ('+x.per+')',kcal:x.kcal,p:x.p,c:x.c,f:x.f}])">+ Log</button></td></tr>`).join('')}</table><small>Live data © Open Food Facts contributors (ODbL).</small>`,'wide')}
// (3) ICS import
function parseICS(txt){const L=txt.replace(/\r?\n[ \t]/g,'').split(/\r?\n/),ev=[];let e=null;
 for(const l of L){if(l==='BEGIN:VEVENT')e={};else if(l==='END:VEVENT'){e&&e.date&&ev.push(e);e=null}else if(e){const i=l.indexOf(':'),k=l.slice(0,i).split(';')[0],v=l.slice(i+1);
  if(k==='SUMMARY')e.title=v.replace(/\\([,;\\])/g,'$1').replace(/\\n/g,' ');if(k==='UID')e.uid=v;if(k==='LOCATION')e.loc=v.replace(/\\/g,'');
  if(k==='DTSTART'){const m=v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);if(m){let d;if(m[4]&&/Z$/.test(v))d=new Date(Date.UTC(+m[1],m[2]-1,+m[3],+m[4],+m[5]));else d=new Date(+m[1],m[2]-1,+m[3],+(m[4]||0),+(m[5]||0));e.date=d.toLocaleDateString('en-CA');e.time=m[4]?d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}):''}}}}return ev}
const kindOf=t=>/\b(exam|final|mid-?sem|midterm|quiz|test)\b/i.test(t)?'exam':/\b(assignment|due|report|essay|submission|submit|assessment|deadline|project)\b/i.test(t)?'assignment':'event';
async function importICS(){const url=S.settings.ics.trim();if(!url)return;ICSMSG='Importing…';render();let txt;
 try{const r=await fetch(PROXY.ok?'/api/ics?url='+encodeURIComponent(url):url.replace(/^webcal:/,'https:'));if(!r.ok)throw new Error('HTTP '+r.status);txt=await r.text()}
 catch(e){ICSMSG=`⚠ Couldn't fetch (${e.message}). ${PROXY.ok?'':'Most calendar hosts (incl. Google) block browser CORS — run "npm start" and open http://localhost:8080 so the built-in proxy can fetch it.'}`;render();return}
 const ev=parseICS(txt).filter(e=>daysUntil(e.date)>=-1&&daysUntil(e.date)<=120);let ne=0,na=0;
 S.icsEvents=ev.map(e=>({...e,kind:kindOf(e.title||'')}));
 S.icsEvents.forEach(e=>{const tag='ics:'+(e.uid||e.title+e.date);if(e.kind==='exam'&&!S.exams.some(x=>x.src===tag)){S.exams.push({id:uid(),person:S.settings.icsPerson||'Bea',subject:e.title,date:e.date,src:tag});ne++}
  if(e.kind==='assignment'&&!S.assignments.some(x=>x.src===tag)){S.assignments.push({id:uid(),person:S.settings.icsPerson||'Bea',title:e.title,course:'(calendar)',due:e.date,pct:0,src:tag});na++}});
 ICSMSG=`✅ ${ev.length} upcoming events imported · ${ne} new exams · ${na} new assignments detected (${new Date().toLocaleTimeString('en-AU')})`;save()}
function agenda(){const a=baseAgenda();S.icsEvents.filter(e=>e.kind==='event'&&daysUntil(e.date)>=0&&daysUntil(e.date)<=14).forEach(e=>a.push({date:e.date,person:S.settings.icsPerson||'Bea',txt:`📅 ${esc(e.title||'')}${e.time?' · '+e.time:''}`}));return a.sort((x,y)=>x.date.localeCompare(y.date))}
// (4) Woolworths prices via proxy
const wwSearch=q=>'https://www.woolworths.com.au/shop/search/products?searchTerm='+encodeURIComponent(q);
const wwTerm=i=>i.replace(/\b\d+(\.\d+)?\s?(kg|g|ml|l|pk)\b|\beach\b/gi,'').trim();
async function fetchWW(){const l=shoppingList();if(!PROXY.ok){WW._msg='Live prices need the local proxy (npm start). Using search links.';render();return}WW._msg='Fetching…';render();let ok=0,bl=0;
 for(const x of l){try{const j=await(await fetch('/api/woolies?q='+encodeURIComponent(wwTerm(x.item)))).json();if(j.ok&&j.items.length){WW[x.item]=j.items[0];ok++}else if(j.blocked)bl++}catch{}}
 WW._msg=ok?`✅ Live prices for ${ok}/${l.length} items`:`⚠ Woolworths blocked the request${bl?' (HTTP 403, bot protection)':''} — showing search links instead.`;render()}
function wwCard(){const l=shoppingList(),live=l.filter(x=>WW[x.item]);const tot=l.reduce((a,x)=>a+(WW[x.item]?.price?x.packs*WW[x.item].price:x.cost),0);
 return card('🛒 Woolworths — live price check & links',`<div class="row"><button onclick="fetchWW()">Fetch live prices</button><a class="btn" target="_blank" href="https://www.woolworths.com.au/shop/cart">Open cart on Woolworths</a></div><small>${esc(WW._msg||'')}</small>
 <table>${l.map(x=>{const w=WW[x.item];return`<tr><td>${x.item} ×${x.packs}</td><td>${w?`<a class="tag" target="_blank" href="${w.url}">${esc(w.name)} ${esc(w.size||'')}</a> ${aud(w.price)}`:`<small>est. ${aud(x.price)}</small>`}</td><td><a class="tag" target="_blank" href="${wwSearch(wwTerm(x.item))}">Search ↗</a></td></tr>`}).join('')}</table>
 <b>${live.length?'Live-adjusted':'Estimated'} total: ${aud(tot)}</b><p class="ex">Woolworths has no public API or add-to-cart link; tap each Search link while logged in to add items. Full auto-ordering needs browser automation on Bea's account.</p>`,'wide')}
// wire into views
const _V={...VIEWS};
VIEWS.Stage=()=>{const h=_V.Stage();const i=h.indexOf('<section class="card ">♪')>-1?0:0;return weatherCard()+h};
VIEWS['Meals & Diet']=()=>offCard()+_V['Meals & Diet']();
VIEWS.Woolworths=()=>_V.Woolworths()+wwCard();
VIEWS.Settings=()=>card('🔌 Live integrations',`<p>Proxy server: ${PROXY.ok?'✅ connected':!PROXY.checked?'checking…':'❌ not reachable — start it with <code>npm start</code> (or the fiaOS app on the Mac)'} · Grok: ${PROXY.xai?'✅ connected via fiaOS server (browser key not needed)':S.settings.apiKey?'✅ using this browser\'s key':!PROXY.checked?'checking…':PROXY.ok?'no key on server':'offline (server not reachable)'}</p>
 <label>Weather location<div class="row"><input id="locq" value="${esc(S.settings.loc.name)}"><button onclick="setLocation($('#locq').value)">Set</button></div></label>
 <label>Calendar ICS URL (uni timetable, Google Calendar "Secret address in iCal format", webcal://…)<div class="row"><input id="icsu" value="${esc(S.settings.ics)}" placeholder="https://…/basic.ics"><button onclick="S.settings.ics=$('#icsu').value;save();importICS()">Import</button></div></label><label>Calendar belongs to <select onchange="S.settings.icsPerson=this.value;save()">${opts(PEOPLE,S.settings.icsPerson||'Bea')}</select></label><small>${esc(ICSMSG)}</small>
 <p class="ex">Browser CORS: Open-Meteo & Open Food Facts work from a file. Google Calendar/most ICS hosts and Woolworths do not — they go through server.js.</p>`,'wide')+_V.Settings();
const PROXY_READY=detectProxy();PROXY_READY.then(()=>S.settings.ics&&importICS());loadWeather();setInterval(loadWeather,30*60e3);
render();
