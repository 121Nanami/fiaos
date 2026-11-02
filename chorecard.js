// fiaOS chores + to-dos (client). Server: chores.js (local, per person, nothing pre-filled).
// Each person's Stage shows their chores this week with a big tick button; Household shows everyone. Habits & Chores tab: the whole
// rotation (this week + next week), editing, and other to-dos. Fetch at start + every 3 min; re-render only when something changed.
(()=>{
let CH=null,BUSY=false,MSG='';window.CHORES=()=>CH;
const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
const DAYS9=['Mon','Tue','Wed','Thu','Fri','Sat','Sun','Daily','Any'],EFF={1:'Quick',2:'Medium',3:'Big'};
const dayLabel=d=>d==='Daily'?'every day':d==='Any'?'any day':d;
async function load(){if(!PROXY.ok)return;try{const j=await api('/api/chores'),was=JSON.stringify(CH);CH=j;
 if(was!==JSON.stringify(j)&&quiet()&&(view.tab==='Stage'||view.tab==='Habits & Chores'))render()}catch(e){CH=CH||{error:e.message,items:[]}}}
window.choreTick=async(id,done)=>{if(BUSY)return;const it=CH?.items?.find(x=>x.id===id);if(!it)return;BUSY=true;it.done=done;render();
 try{CH=await api('/api/chores/tick',{id,done});MSG=''}catch(e){it.done=!done;MSG='⚠ '+e.message}BUSY=false;render()};
window.choreEdit=async b=>{if(BUSY)return;BUSY=true;MSG='Saving…';render();try{CH=await api('/api/chores/edit',b);MSG=''}catch(e){MSG='⚠ '+e.message}BUSY=false;render()};
window.choreAdd=()=>{const n=$('#ch-n').value.trim();if(!n)return;choreEdit({op:'add',name:n,day:$('#ch-d').value,person:$('#ch-p').value})};
const todayDow=()=>DAYS[(new Date().getDay()+6)%7];
const mine=p=>(CH?.items||[]).filter(i=>i.person===p);
const row=i=>`<li class="${i.done?'done':''}"><button class="chk ${i.done?'on':''}" aria-label="${i.done?'Untick':'Tick'} ${esc(i.name)}" onclick="choreTick('${i.id}',${!i.done})">${i.done?'✓':''}</button>
 <span class="cn">${esc(i.name)}<small>${dayLabel(i.day)}${i.day===todayDow()?' · today':''}</small></span></li>`;
function choreCard(){if(!PROXY.ok||!CH)return'';if(CH.error&&!CH.items?.length)return card('🧹 Chores this week',`<p class="mute">${esc(CH.error)}</p>`,'chores');
 const P=who(),hh=view.person==='Household',wk=new Date(CH.week+'T12:00').toLocaleDateString('en-AU',{day:'numeric',month:'short'});
 const body=hh?`<div class="chh">${PEOPLE.map(p=>{const m=mine(p);return`<div><h4>${ptag(p)} <small>${CH.people[p]?.done||0}/${m.length}</small></h4><ul class="clist">${m.map(row).join('')||'<li class="mute">Nothing</li>'}</ul></div>`}).join('')}</div>`
  :(()=>{const p=P[0],m=mine(p),nx=(CH.items||[]).filter(i=>i.next===p).map(i=>esc(i.name));return`<ul class="clist">${m.map(row).join('')||'<li class="mute">No chores for you this week.</li>'}</ul>
   <p class="ex">${m.filter(i=>i.done).length} of ${m.length} done${nx.length?` · next week: ${nx.join(', ')}`:''}</p>`})();
 return card(`🧹 ${hh?'Chores this week':'My chores this week'} <small class="mute">from ${wk}</small>`,body+(MSG?`<p class="warn">${esc(MSG)}</p>`:''),hh?'wide chores':'chores')}
window.choreCard=choreCard;
// brief: on a chore's day "today: X"; otherwise how many are left this week
window.choreBriefLine=p=>{if(!CH?.items||!PEOPLE.includes(p))return'';const m=mine(p);if(!m.length)return'';const left=m.filter(i=>!i.done);
 const tday=left.filter(i=>i.day===todayDow()||i.day==='Daily');if(!left.length)return`<div class="bbin bchore">🧹 All ${m.length} chores done this week ✓</div>`;
 return`<div class="bbin bchore">🧹 ${tday.length?`Today: ${tday.map(i=>esc(i.name)).join(' · ')}`:`Chores left: ${left.map(i=>`${esc(i.name)} <small>${dayLabel(i.day)}</small>`).join(' · ')}`}${tday.length&&left.length>tday.length?` <small>+${left.length-tday.length} more this week</small>`:''}</div>`};
(window.briefExtras??=[]).push(window.choreBriefLine);
const _St=VIEWS.Stage;VIEWS.Stage=()=>{const h=_St(),c=choreCard();if(!c)return h;const b=h.indexOf('class="card wide brief"');if(b<0)return c+h;const e=h.indexOf('</section>',b)+10;return h.slice(0,e)+c+h.slice(e)};
// Habits & Chores: chores (per person) + to-dos (per person). Everything is added by hand; nothing is pre-filled.
let TD=null;
async function loadTodos(){if(!PROXY.ok)return;try{const j=await api('/api/todos'),was=JSON.stringify(TD);TD=j;if(was!==JSON.stringify(j)&&quiet()&&view.tab==='Habits & Chores')render()}catch(e){TD=TD||{items:[],error:e.message}}}
window.todoCall=async(r,b)=>{try{TD=await api('/api/todos/'+r,b)}catch(e){MSG='⚠ '+e.message}render()};
window.todoAdd=()=>{const n=$('#td-n').value.trim();if(!n)return;todoCall('add',{name:n,person:$('#td-p').value})};
const pSel=(id,v)=>`<select id="${id}" style="max-width:110px">${PEOPLE.map(p=>`<option ${p===v?'selected':''}>${p}</option>`).join('')}</select>`;
function rotaCard(){if(!CH)return card('🧹 Chores','<p class="mute">Loading…</p>','wide');
 const upd=(id,el)=>`choreEdit({op:'update',id:'${id}',day:${el}.querySelector('.cd').value,person:${el}.querySelector('.cp').value})`;
 const sel=(id,v,arr,cls)=>`<select class="${cls}" onchange="${upd(id,'this.closest(\'tr\')')}">${arr.map(o=>`<option ${o===v?'selected':''}>${o}</option>`).join('')}</select>`;
 const rows=(CH.items||[]).map(i=>`<tr class="${i.done?'done':''}"><td><button class="chk sm ${i.done?'on':''}" onclick="choreTick('${i.id}',${!i.done})" aria-label="tick">${i.done?'✓':''}</button></td><td>${esc(i.name)}</td><td>${sel(i.id,i.day,DAYS9,'cd')}</td><td>${sel(i.id,i.person,PEOPLE,'cp')}</td>
  <td><button class="sm" onclick="if(confirm('Remove “${esc(i.name).replace(/'/g,'')}”?'))choreEdit({op:'remove',id:'${i.id}'})">Remove</button></td></tr>`).join('');
 const eff=PEOPLE.map(p=>`${ptag(p)} ${CH.people?.[p]?.done||0}/${CH.people?.[p]?.assigned||0} done`).join(' ');
 return card('🧹 Chores',`<p>${eff}</p>${rows?`<div class="tscroll"><table class="rota"><tr><th></th><th>Chore</th><th>Day</th><th>Who</th><th></th></tr>${rows}</table></div>`:'<p class="mute">No chores yet. Add the first one below.</p>'}
 <div class="row"><input id="ch-n" placeholder="New chore"><select id="ch-d" style="max-width:110px">${DAYS9.map(d=>`<option>${d}</option>`).join('')}</select>${pSel('ch-p',who()[0])}<button onclick="choreAdd()" ${BUSY?'disabled':''}>Add</button></div>
 ${MSG?`<p class="warn">${esc(MSG)}</p>`:''}<p class="ex">Each chore has an owner and a day. Ticks clear every Monday.</p>`,'wide')}
function todoCard(){const P=who(),L=(TD?.items||[]).filter(t=>P.includes(t.person));
 const li=t=>`<li class="${t.done?'done':''}"><button class="chk ${t.done?'on':''}" onclick="todoCall('tick',{id:'${t.id}',done:${!t.done}})">${t.done?'✓':''}</button> <span class="cn">${esc(t.name)}<small>${ptag(t.person)}</small></span> <button class="sm" onclick="todoCall('remove',{id:'${t.id}'})">×</button></li>`;
 return card('📝 To-do',`<ul class="clist">${L.map(li).join('')||'<li class="mute">Nothing on the list.</li>'}</ul><div class="row"><input id="td-n" placeholder="New to-do" onkeydown="if(event.key==='Enter')todoAdd()">${pSel('td-p',P[0])}<button onclick="todoAdd()">Add</button></div>`)}
const _HC=VIEWS['Habits & Chores'];VIEWS['Habits & Chores']=()=>{let h=_HC();const i=h.indexOf('<h3>Chore roster</h3>');if(i>-1){const s=h.lastIndexOf('<section',i),e=h.indexOf('</section>',i)+10;h=h.slice(0,s)+h.slice(e)}return rotaCard()+h+todoCard()};
(async()=>{try{await PROXY_READY}catch{}setTimeout(()=>{load();loadTodos()},2000)})();setInterval(()=>{load();loadTodos()},3*60e3);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){load();loadTodos()}});
})();
