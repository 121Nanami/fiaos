// fiaOS family message board (client). Server: notes.js. Short notes with an expiry ("out till 6", "grab milk"), on Stage and in the brief.
// Add here, ask the helper ("tell everyone I'm out till 6"), or type "note: …" in the Notion fiaOS Inbox. Checked every 2 min; no sound, no motion.
(()=>{
let NB=null,MSG='',BUSY=false;window.NOTES=()=>NB;
const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
const live=()=>(NB||[]).filter(n=>!n.until||new Date(n.until)>Date.now());
async function load(){if(!PROXY.ok)return;try{const j=await api('/api/notes'),was=JSON.stringify(NB);NB=j.notes;if(was!==JSON.stringify(NB)&&quiet()&&view.tab==='Stage')render()}catch{}}
window.noteAdd=async()=>{const t=$('#nb-t').value.trim();if(!t||BUSY)return;BUSY=true;MSG='';
 try{const j=await api('/api/notes',{who:$('#nb-w').value,text:t,until:$('#nb-u').value.trim()});NB=j.notes}catch(e){MSG='⚠ '+e.message}BUSY=false;render()};
window.noteDel=async id=>{try{const j=await api('/api/notes/delete',{id});NB=j.notes}catch(e){MSG='⚠ '+e.message}render()};
// helper / Notion-queued action: same board (the server ignores a repeated id)
ACTIONS.addNote=a=>{api('/api/notes',{id:a.id,who:a.person||a.who||ME(),text:a.text,until:a.until||''}).then(j=>{NB=j.notes;render()}).catch(()=>{})};
const nRow=n=>`<li>${ptag(n.who==='Everyone'?'All':n.who)}<span class="nt">${esc(n.text)}</span><small>${esc(n.untilLabel||'')}</small><button class="nx" aria-label="Remove note" onclick="noteDel('${n.id}')">×</button></li>`;
function noteCard(){if(!PROXY.ok)return'';const L=live().slice().reverse(),me=view.person==='Household'?'Everyone':view.person;
 return card('📌 Notes',`${L.length?`<ul class="nlist">${L.map(nRow).join('')}</ul>`:'<p class="mute">No notes right now.</p>'}
 <div class="row nadd"><select id="nb-w" aria-label="From">${['Ada','Bea','Cam','Everyone'].map(p=>`<option ${p===me?'selected':''}>${p}</option>`).join('')}</select><input id="nb-t" maxlength="140" placeholder="e.g. Out till 6 · grab milk"></div>
 <div class="row nadd"><input id="nb-u" placeholder="Until (optional): 6pm, tonight, tomorrow…"><button onclick="noteAdd()" ${BUSY?'disabled':''}>Post</button></div>
 ${MSG?`<p class="warn">${esc(MSG)}</p>`:''}<p class="ex">Notes disappear by themselves (24 h if no time is given). Also from the helper or “note: …” in the Notion Inbox.</p>`,'notes')}
window.noteCard=noteCard;
(window.briefTop??=[]).push(()=>{const L=live();if(!L.length)return'';return`<div class="bbin bnote">📌 ${L.slice(-3).reverse().map(n=>`<b>${esc(n.who)}:</b> ${esc(n.text)}`).join(' · ')}${L.length>3?` <small>+${L.length-3}</small>`:''}</div>`});
const _St=VIEWS.Stage;VIEWS.Stage=()=>{const h=_St(),c=noteCard();if(!c)return h;const b=h.indexOf('class="card wide brief"');if(b<0)return c+h;const e=h.indexOf('</section>',b)+10;return h.slice(0,e)+c+h.slice(e)};
(async()=>{try{await PROXY_READY}catch{}setTimeout(load,1500)})();setInterval(load,2*60e3);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')load()});
})();
