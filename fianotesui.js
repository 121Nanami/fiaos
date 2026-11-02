// FiaNotes / FiaDocs (client). Server: fianotes.js. Notes, rich documents, a small spreadsheet and SM-2 cards.
// Local only. Negi-chan (the existing Grok helper) is optional: summarise and draft cards when XAI_API_KEY is set.
// Open with ?tab=Notes. Typing in the editor must not re-render the whole app or the cursor jumps.
(()=>{
if(!TABS.includes('Notes'))TABS.push('Notes');
{const tt=new URLSearchParams(location.search).get('tab');if(tt==='Notes')view.tab='Notes'}
const FN=window.FN={mode:'library',folder:'',kind:'',tag:'',q:'',hits:null,id:null,note:null,html:'',backlinks:[],values:null,ref:'A1',db:null,err:'',status:'',ai:null,show:false,ahead:false,busy:false,migrateMsg:'',draft:'',seq:0};
const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
const ea=s=>esc(s??'').replace(/"/g,'&quot;');
const kindName=k=>k==='doc'?'Document':k==='sheet'?'Sheet':'Note';
const today=()=>new Date().toLocaleDateString('en-CA');
function setStatus(t){FN.status=t;const s=document.getElementById('fn-status');if(s)s.textContent=t}
function slimApp(){try{
  const take=(a,n)=>(a||[]).slice(-n);
  return {recipes:S.recipes,assignments:take(S.assignments,200),exams:take(S.exams,100),chores:S.chores,bills:S.bills,habits:S.habits,people:S.people};
}catch{return {}}}
function migText(j,manual){const parts=[];for(const[k,v]of Object.entries(j||{})){if(!v||typeof v!=='object'||v.added==null)continue;if(v.added||v.updated)parts.push(`${k}: ${v.added} new${v.updated?`, ${v.updated} updated`:''}`);if(v.error&&(manual||k!=='live'))parts.push(`${k}: ${v.error}`)}return parts.join(' · ')||(manual?'Nothing new to bring in.':'')}
async function load(){try{FN.db=await api('/api/fianotes');FN.err='';
  if(FN.id&&!(FN.db.notes||[]).some(n=>n.id===FN.id))FN.id=null;
  if(!FN.note&&!FN.id&&FN.db.notes&&FN.db.notes[0])FN.id=FN.db.notes[0].id;
  if(FN.id&&(!FN.note||FN.note.id!==FN.id)){const j=await api('/api/fianotes/note?id='+encodeURIComponent(FN.id));applyNote(j)}
}catch(e){FN.err=e.message}
 if((view.tab==='Notes'||view.tab==='Stage')&&quiet())render()}
function applyNote(j){FN.note=j.note;FN.html=j.html||'';FN.backlinks=j.backlinks||[];FN.values=j.values;FN.draft=j.note.body||'';FN.id=j.note.id}
async function open(id){FN.id=id;FN.mode='library';FN.ai=null;try{applyNote(await api('/api/fianotes/note?id='+encodeURIComponent(id)));FN.err=''}catch(e){FN.err=e.message}render()}
window.FN.open=open;
function visible(){const all=FN.q&&FN.hits?FN.hits:(FN.db?.notes||[]);return all.filter(n=>(!FN.folder||n.folder===FN.folder)&&(!FN.kind||n.kind===FN.kind)&&(!FN.tag||(n.tags||[]).includes(FN.tag)))}
function folders(){return FN.db?.folders||[{id:'inbox',name:'Inbox'}]}
function fname(id){return folders().find(f=>f.id===id)?.name||'Inbox'}
function listHtml(){const rows=visible();if(!FN.db)return'<p class="mute">Loading…</p>';if(FN.err&&!FN.db.notes)return'';if(!rows.length)return `<p class="mute">${FN.q?'Nothing matches that search.':'Nothing in this folder yet.'}</p>`;
 return rows.map(n=>`<button type="button" class="fn-item ${n.id===FN.id?'on':''}" data-id="${ea(n.id)}" onclick="FN.open('${n.id}')"><b class="fn-item-title">${esc(n.title)}</b><small>${kindName(n.kind)} · ${esc(fname(n.folder))}${n.example?' · example':''}</small><span>${esc(n.snippet||'')}</span></button>`).join('')}
function backHtml(list){if(!list||!list.length)return'<p class="mute">No backlinks yet. Link to this note with [[its title]].</p>';return list.map(b=>`<button type="button" class="tag" onclick="FN.open('${b.id}')">${esc(b.title)}</button>`).join(' ')}
function tagHtml(){const set=new Set();(FN.db?.notes||[]).forEach(n=>{if(!FN.folder||n.folder===FN.folder)(n.tags||[]).forEach(t=>set.add(t))});
 return [...set].sort().map(t=>`<button type="button" class="tag ${FN.tag===t?'on':''}" data-tag="${ea(t)}" onclick="FN.pickTag(this.dataset.tag)">${esc(t)}</button>`).join('')||'<span class="mute">No tags yet.</span>'}
function colName(n){let s='';while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26)}return s}
function gridSize(cells){let maxC=5,maxR=10;for(const ref of Object.keys(cells||{})){const m=/^([A-Z]+)(\d+)$/.exec(ref);if(!m)continue;let c=0;for(const ch of m[1])c=c*26+(ch.charCodeAt(0)-64);maxC=Math.max(maxC,c+1);maxR=Math.max(maxR,+m[2]+2)}return{maxC:Math.min(maxC,10),maxR:Math.min(maxR,30)}}
function shown(ref){const v=FN.values&&FN.values[ref];if(v){if(v.error)return v.error;if(v.value!=null&&v.value!=='')return String(v.value);return ''}return (FN.note?.cells||{})[ref]||''}
function sheetHtml(){const cells=FN.note.cells||{},sz=gridSize(cells);let h='<div class="fn-scroll"><table class="fn-grid"><tr><th></th>';for(let c=1;c<=sz.maxC;c++)h+=`<th>${colName(c)}</th>`;h+='</tr>';
 for(let r=1;r<=sz.maxR;r++){h+=`<tr><th>${r}</th>`;for(let c=1;c<=sz.maxC;c++){const ref=colName(c)+r,val=shown(ref),err=/^#/.test(val);h+=`<td data-ref="${ref}" class="${FN.ref===ref?'on':''} ${err?'err':''}" onclick="FN.pick('${ref}')">${esc(val)}</td>`}h+='</tr>'}
 return h+'</table></div>'}
function aiHtml(j){if(!j)return'';const cards=(j.cards||[]).map(c=>`<li><b>${esc(c.front)}</b> — ${esc(c.back)}</li>`).join('');
 return `<div class="fn-ai"><p>${esc(j.summary||'')}</p>${cards?`<ul>${cards}</ul>`:''}<p class="ex">${j.via==='grok'?'From Negi-chan.':'Local only. '+esc(j.note||'')}</p>
  <div class="row">${j.summary?`<button type="button" class="sm" onclick="FN.saveSummary()">Save summary as a note</button>`:''}${(j.cards||[]).length?`<button type="button" class="sm" onclick="FN.addAiCards()">Add these cards</button>`:''}</div></div>`}
function editorHtml(){const n=FN.note;if(!n)return'<div class="fn-editor"><p class="mute">Pick a note, or make a new one. Example notes are marked — clear them when you are ready to keep only yours.</p></div>';
 const foldersOpts=folders().map(f=>`<option value="${ea(f.id)}" ${f.id===n.folder?'selected':''}>${esc(f.name)}</option>`).join('');
 const people=['Ada','Bea','Cam','Everyone'].map(p=>`<option ${p===n.person?'selected':''}>${p}</option>`).join('');
 const bar=n.kind==='sheet'?`<div class="row fn-fxrow"><b id="fn-ref">${esc(FN.ref||'A1')}</b><input id="fn-fx" class="fn-keep" value="${ea((n.cells||{})[FN.ref]||'')}" placeholder="Value or =SUM(A1:A3)" onchange="FN.fx(this.value)"></div>${sheetHtml()}<p class="ex">Formulas: SUM, AVERAGE, MIN, MAX, COUNT, and + − × ÷. CSV import and export are on the right.</p>`
  :`<div class="row fn-tools"><button type="button" class="sm" onclick="FN.wrap('**','**')">Bold</button><button type="button" class="sm" onclick="FN.wrap('*','*')">Italic</button><button type="button" class="sm" onclick="FN.line('## ')">Heading</button><button type="button" class="sm" onclick="FN.line('- ')">List</button><button type="button" class="sm" onclick="FN.wrap('[','](https://)')">Link</button><button type="button" class="sm" onclick="FN.insert('\\n|  |  |\\n| --- | --- |\\n|  |  |\\n')">Table</button></div>
    <textarea id="fn-ed" class="fn-ed fn-keep" oninput="FN.onBody(this.value)">${esc(FN.draft)}</textarea>
    <div id="fn-prev" class="fn-prev">${FN.html||'<p class="mute">Preview appears as you type.</p>'}</div>`;
 return `<div class="fn-editor"><input id="fn-title" class="fn-title fn-keep" value="${ea(n.title)}" oninput="FN.onTitle(this.value)">
  <div class="row"><select aria-label="Folder" onchange="FN.meta({folder:this.value})">${foldersOpts}</select><select aria-label="Person" onchange="FN.meta({person:this.value})">${people}</select>
  <input id="fn-tags" class="fn-keep" value="${ea((n.tags||[]).join(', '))}" placeholder="tags, comma separated" onchange="FN.meta({tags:this.value})"></div>
  ${bar}
  <div id="fn-back" class="fn-back"><b>Backlinks</b> ${backHtml(FN.backlinks)}</div>
  <div id="fn-aibox">${aiHtml(FN.ai)}</div>
  <div class="row fn-actions"><span id="fn-status" class="mute">${esc(FN.status)}</span>
   <button type="button" class="sm" onclick="FN.dl('md')">.md</button><button type="button" class="sm" onclick="FN.dl('html')">.html</button><button type="button" class="sm" onclick="FN.dl('pdf')">.pdf</button><button type="button" class="sm" onclick="FN.print()">Print / PDF</button>
   ${n.kind==='sheet'?'<button type="button" class="sm" onclick="FN.dl(\'csv\')">.csv</button>':`<button type="button" class="sm" onclick="FN.makeCards()">Cards from this note</button><button type="button" class="sm" onclick="FN.aiRun('summarise')">Summarise</button><button type="button" class="sm" onclick="FN.aiRun('flashcards')">Negi-chan cards</button>`}
   <button type="button" class="sm" onclick="FN.remove()">Delete</button></div>
  <p class="ex">${n.example?'Example note. Editing it keeps your version. ':''}Stored on this machine. A link like [[Bin night]] connects notes. Print / PDF uses the browser’s print dialog for the formatted page; the .pdf button is a plain-text download.</p></div>`}
function reviewHtml(){const cards=FN.db?.cards||[],due=cards.filter(c=>c.due<=today()).sort((a,b)=>a.due.localeCompare(b.due)),later=cards.filter(c=>c.due>today).sort((a,b)=>a.due.localeCompare(b.due));
 const queue=FN.ahead?[...due,...later]:due,c=queue[0];
 if(!c)return `<div class="fn-review"><p>${cards.length?'Nothing due. Next card is '+esc(later[0]?.due||'later')+'.':'No cards yet. Open a note and use “Cards from this note”, or add one here.'}</p>${later.length&&!FN.ahead?'<button type="button" onclick="FN.ahead=true;render()">Study ahead</button>':''}${addCardForm()}</div>`;
 const pv=c.preview||{};
 return `<div class="fn-review"><p class="mute">${due.length} due · ${cards.length} cards${c.example?' · example card':''}</p>
  <div class="fn-face">${esc(c.front)}</div>
  ${FN.show?`<div class="fn-face fn-backface">${esc(c.back)}</div>
    <div class="row"><button type="button" onclick="FN.grade(1)">Again <small>${esc(pv[1]||'')}</small></button><button type="button" onclick="FN.grade(3)">Hard <small>${esc(pv[3]||'')}</small></button><button type="button" class="on" onclick="FN.grade(4)">Good <small>${esc(pv[4]||'')}</small></button><button type="button" onclick="FN.grade(5)">Easy <small>${esc(pv[5]||'')}</small></button></div>`
    :'<button type="button" class="on" onclick="FN.show=true;render()">Show answer</button>'}
  <p class="ex">SM-2, same idea as Anki. Again fails the card (1 day). Good and Easy push the gap out. ${c.noteId?`<button type="button" class="sm" onclick="FN.open('${c.noteId}')">Open source note</button>`:''}</p>
  ${addCardForm()}</div>`}
function addCardForm(){return `<div class="row"><input id="fn-cf" class="fn-keep" placeholder="Front"><input id="fn-cb" class="fn-keep" placeholder="Back"><button type="button" onclick="FN.addCard()">Add card</button></div>`}
function bringHtml(){return `<div class="fn-bring"><p>Bring in what fiaOS already has. This copies; it does not delete the message board or your Notion workspace.</p>
  <ul><li><b>Message board</b> — each note in <code>data/notes.json</code> (who, text, until) becomes a note in Message board.</li>
  <li><b>This browser’s copy</b> — recipes, uni, chores, bills, habits and targets that Notion sync keeps in the app.</li>
  <li><b>Notion itself</b> — if <code>NOTION_TOKEN</code> is set, wiki pages (with their text), the journal, and the synced databases. Otherwise drop a pull dump at <code>data/notion-pull.json</code> and press the button again.</li></ul>
  <div class="row"><button type="button" class="on" onclick="FN.bring(true)" ${FN.busy?'disabled':''}>${FN.busy?'Bringing in…':'Bring in board + Notion'}</button>
  <button type="button" onclick="document.getElementById('fn-file').click()">Import .md, .docx or .csv</button>
  <button type="button" onclick="FN.clearEx()">Clear example notes</button></div>
  <input id="fn-file" type="file" accept=".md,.markdown,.txt,.docx,.csv" hidden onchange="FN.importFile(this)">
  ${FN.migrateMsg?`<p>${esc(FN.migrateMsg)}</p>`:''}
  <p class="ex">.docx keeps headings, bold, italic, simple lists and tables. Images and old .doc files are skipped. Spreadsheet formulas that come in as text starting with = are calculated.</p></div>`}
function shell(){if(FN.err&&!FN.db)return card('FiaNotes',`<p class="warn">⚠ ${esc(FN.err)}</p><p class="ex">Start the app with <code>node server.js</code> and open this page from that server.</p>`,'wide fn');
 const due=FN.db?.counts?.due??0;
 return `<section class="card wide fn"><h3>FiaNotes <small>notes · documents · sheets · cards${due?` · ${due} due`:''}</small></h3>
  <div class="row fn-mode"><button type="button" class="${FN.mode==='library'?'on':''}" onclick="FN.mode='library';render()">Library</button>
   <button type="button" class="${FN.mode==='cards'?'on':''}" onclick="FN.mode='cards';FN.show=false;render()">Cards${due?` (${due})`:''}</button>
   <button type="button" class="${FN.mode==='bring'?'on':''}" onclick="FN.mode='bring';render()">Bring in</button>
   <input id="fn-q" class="fn-keep" placeholder="Search titles, text and tags" value="${ea(FN.q)}" oninput="FN.onQ(this.value)"></div>
  ${FN.db?.example?'<p class="ex">Example notes are loaded so the library isn’t empty. Yours are added beside them. Clear examples from Bring in when you want.</p>':''}
  ${FN.migrateMsg&&FN.mode!=='bring'?`<p class="ex">${esc(FN.migrateMsg)}</p>`:''}
  ${FN.mode==='cards'?reviewHtml():FN.mode==='bring'?bringHtml():`<div class="fn-body">
    <div class="fn-side"><button type="button" class="fn-fold ${FN.folder?'':'on'}" onclick="FN.folder='';render()">All</button>
      ${folders().map(f=>`<button type="button" class="fn-fold ${FN.folder===f.id?'on':''}" onclick="FN.folder='${f.id}';render()">${esc(f.name)}</button>`).join('')}
      <div class="row"><input id="fn-newfolder" class="fn-keep" placeholder="New folder" onkeydown="if(event.key==='Enter')FN.addFolder()"><button type="button" class="sm" onclick="FN.addFolder()">+</button></div>
      <div class="fn-kinds"><button type="button" class="sm ${FN.kind?'':'on'}" onclick="FN.kind='';render()">All</button><button type="button" class="sm ${FN.kind==='note'?'on':''}" onclick="FN.kind='note';render()">Notes</button><button type="button" class="sm ${FN.kind==='doc'?'on':''}" onclick="FN.kind='doc';render()">Docs</button><button type="button" class="sm ${FN.kind==='sheet'?'on':''}" onclick="FN.kind='sheet';render()">Sheets</button></div>
      <div class="fn-tags">${tagHtml()}</div></div>
    <div class="fn-list">${listHtml()}</div>
    ${editorHtml()}
  </div>
  <div class="row"><button type="button" onclick="FN.create('note')">New note</button><button type="button" onclick="FN.create('doc')">New document</button><button type="button" onclick="FN.create('sheet')">New sheet</button></div>`}
 </section>`}
VIEWS.Notes=()=>shell();
function stageCard(){if(!FN.db)return'';const due=FN.db.counts?.due||0,n=FN.db.counts?.notes||0;
 return card('FiaNotes',`<p>${n} note${n===1?'':'s'} on this machine.${due?` <b>${due} card${due===1?'':'s'} due.</b>`:' No cards due.'}</p><button type="button" onclick="view.tab='Notes';render()">Open FiaNotes</button>`,'fn-stage')}
const _St=VIEWS.Stage;VIEWS.Stage=()=>{const h=_St(),c=stageCard();if(!c)return h;const b=h.indexOf('class="card wide brief"');if(b<0)return c+h;const e=h.indexOf('</section>',b)+10;return h.slice(0,e)+c+h.slice(e)};

FN.pickTag=t=>{FN.tag=FN.tag===t?'':t;render()};
FN.paintList=()=>{const list=document.querySelector('.fn-list');if(list)list.innerHTML=listHtml();else if(view.tab==='Notes')render()};
FN.onQ=v=>{FN.q=v;clearTimeout(FN._q);FN._q=setTimeout(async()=>{if(!FN.q.trim()){FN.hits=null;FN.paintList();return}try{FN.hits=(await api('/api/fianotes/search?q='+encodeURIComponent(FN.q))).hits;FN.paintList()}catch(e){setStatus('⚠ '+e.message)}},180)};
let bodyT=null;
FN.onBody=v=>{FN.draft=v;clearTimeout(bodyT);bodyT=setTimeout(()=>FN.persist(),450)};
FN.onTitle=v=>{if(FN.note)FN.note.title=v;clearTimeout(bodyT);bodyT=setTimeout(()=>FN.persist(),450)};
FN.meta=async patch=>{if(!FN.note)return;if(patch.tags!=null)FN.note.tags=patch.tags.split(',').map(t=>t.trim().toLowerCase().replace(/^#/,'')).filter(Boolean);if(patch.folder)FN.note.folder=patch.folder;if(patch.person)FN.note.person=patch.person;await FN.persist();FN.db=await api('/api/fianotes');render()};
FN.persist=async()=>{if(!FN.note)return;const seq=++FN.seq;setStatus('Saving…');try{
  const n=FN.note,j=await api('/api/fianotes/note',{id:n.id,kind:n.kind,title:n.title,body:n.kind==='sheet'?(n.body||''):FN.draft,folder:n.folder,tags:n.tags,person:n.person,cells:n.cells});
  if(seq!==FN.seq)return;FN.note=j.note;FN.html=j.html||'';FN.backlinks=j.backlinks||[];FN.values=j.values;const p=document.getElementById('fn-prev');if(p)p.innerHTML=j.html||'';const b=document.getElementById('fn-back');if(b)b.innerHTML='<b>Backlinks</b> '+backHtml(j.backlinks);setStatus('Saved');
  const row=document.querySelector(`.fn-item[data-id="${j.note.id}"] .fn-item-title`);if(row)row.textContent=j.note.title;
 }catch(e){setStatus('⚠ '+e.message)}};
FN.wrap=(a,b)=>{const ta=document.getElementById('fn-ed');if(!ta)return;const s=ta.selectionStart,e=ta.selectionEnd,t=ta.value;ta.value=t.slice(0,s)+a+t.slice(s,e)+b+t.slice(e);FN.draft=ta.value;ta.focus();try{ta.setSelectionRange(s+a.length,e+a.length)}catch{}FN.onBody(ta.value)};
FN.line=prefix=>{const ta=document.getElementById('fn-ed');if(!ta)return;const s=ta.selectionStart,line=ta.value.lastIndexOf('\n',s-1)+1;ta.value=ta.value.slice(0,line)+prefix+ta.value.slice(line);FN.draft=ta.value;ta.focus();FN.onBody(ta.value)};
FN.insert=txt=>{const ta=document.getElementById('fn-ed');if(!ta)return;const s=ta.selectionStart;ta.value=ta.value.slice(0,s)+txt+ta.value.slice(s);FN.draft=ta.value;ta.focus();FN.onBody(ta.value)};
FN.pick=ref=>{FN.ref=ref;const lab=document.getElementById('fn-ref'),fx=document.getElementById('fn-fx');if(lab)lab.textContent=ref;if(fx){fx.value=(FN.note?.cells||{})[ref]||'';fx.focus()}document.querySelectorAll('.fn-grid td.on').forEach(td=>td.classList.remove('on'));document.querySelector(`.fn-grid td[data-ref="${ref}"]`)?.classList.add('on')};
FN.fx=async val=>{if(!FN.note)return;FN.note.cells={...(FN.note.cells||{})};if(String(val).length)FN.note.cells[FN.ref]=val;else delete FN.note.cells[FN.ref];await FN.persist();render()};
FN.create=async kind=>{const j=await api('/api/fianotes/note',{kind,title:kind==='sheet'?'Untitled sheet':kind==='doc'?'Untitled document':'Untitled note',folder:FN.folder||'inbox',body:'',person:(typeof ME==='function'?ME():'Bea'),tags:[]});
  applyNote(j);FN.mode='library';FN.db=await api('/api/fianotes');render();setTimeout(()=>document.getElementById('fn-title')?.focus(),40)};
FN.addFolder=async()=>{const name=document.getElementById('fn-newfolder')?.value.trim();if(!name)return;await api('/api/fianotes/folder',{op:'add',name});FN.db=await api('/api/fianotes');render()};
FN.remove=async()=>{if(!FN.note||!confirm('Delete “'+FN.note.title+'”? Cards made from it go too.'))return;await api('/api/fianotes/delete',{id:FN.note.id});FN.note=null;FN.id=null;await load()};
FN.dl=async fmt=>{if(!FN.id)return;const r=await fetch('/api/fianotes/export?id='+encodeURIComponent(FN.id)+'&fmt='+fmt);if(!r.ok){let m=r.status;try{m=(await r.json()).error||m}catch{}setStatus('⚠ '+m);return}const blob=await r.blob(),a=document.createElement('a');const m=/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition')||'');a.download=m?m[1]:'note.'+fmt;a.href=URL.createObjectURL(blob);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)};
FN.print=async()=>{if(!FN.id)return;const r=await fetch('/api/fianotes/export?id='+encodeURIComponent(FN.id)+'&fmt=html');const html=await r.text();const w=window.open('','fianotes-print');if(!w){setStatus('⚠ Allow pop-ups to print');return}w.document.open();w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),250)};
FN.makeCards=async()=>{const j=await api('/api/fianotes/cards',{op:'fromNote',id:FN.id});FN.db=await api('/api/fianotes');setStatus(j.added?`Added ${j.added} card${j.added>1?'s':''}.`:'No new cards. Try Question :: Answer, Q: / A:, or {{cloze}}.');};
FN.aiRun=async op=>{if(!FN.id)return;setStatus(op==='summarise'?'Summarising…':'Drafting cards…');try{FN.ai=await api('/api/fianotes/ai',{op,id:FN.id});setStatus(FN.ai.via==='grok'?'Negi-chan answered.':'Done from the note itself.');const host=document.getElementById('fn-aibox');if(host)host.innerHTML=aiHtml(FN.ai);else render()}catch(e){setStatus('⚠ '+e.message)}};
FN.saveSummary=async()=>{if(!FN.ai?.summary||!FN.note)return;const j=await api('/api/fianotes/note',{kind:'note',title:'Summary · '+FN.note.title.slice(0,80),body:FN.ai.summary,folder:FN.note.folder,tags:['summary'],person:FN.note.person});applyNote(j);FN.ai=null;FN.db=await api('/api/fianotes');render()};
FN.addAiCards=async()=>{if(!FN.ai?.cards?.length)return;const j=await api('/api/fianotes/cards',{op:'addMany',noteId:FN.id,cards:FN.ai.cards});FN.db=await api('/api/fianotes');setStatus(`Added ${j.added} card${j.added===1?'':'s'}.`)};
FN.grade=async q=>{const cards=FN.db?.cards||[],due=cards.filter(c=>c.due<=today()).sort((a,b)=>a.due.localeCompare(b.due)),later=cards.filter(c=>c.due>today).sort((a,b)=>a.due.localeCompare(b.due)),c=(FN.ahead?[...due,...later]:due)[0];if(!c)return;await api('/api/fianotes/cards',{op:'grade',id:c.id,q});FN.show=false;FN.db=await api('/api/fianotes');render()};
FN.addCard=async()=>{const front=document.getElementById('fn-cf')?.value.trim(),back=document.getElementById('fn-cb')?.value.trim();if(!front||!back)return;await api('/api/fianotes/cards',{op:'add',front,back,noteId:FN.id||''});FN.db=await api('/api/fianotes');FN.ahead=true;render()};
FN.bring=async manual=>{FN.busy=true;if(view.tab==='Notes')render();try{let live=false;try{live=!!(await api('/api/notion/status')).connected}catch{}const j=await api('/api/fianotes/migrate',{board:true,app:slimApp(),live,dump:true});FN.migrateMsg=migText(j,!!manual);try{localStorage.setItem('fiaos.fnMigrated',new Date().toISOString())}catch{}FN.err=''}catch(e){FN.migrateMsg='⚠ '+e.message}FN.busy=false;const mode=FN.mode;await load();FN.mode=mode;if(view.tab==='Notes'||view.tab==='Stage')render()};
FN.clearEx=async()=>{if(!confirm('Remove the example notes and cards? Notes you wrote stay.'))return;FN.db=await api('/api/fianotes/examples/clear',{});FN.note=null;FN.id=FN.db.notes?.[0]?.id||null;if(FN.id)await open(FN.id);else render()};
FN.importFile=async input=>{const file=input.files&&input.files[0];input.value='';if(!file)return;const ext=(file.name.split('.').pop()||'').toLowerCase();try{let data,fmt;if(ext==='docx'){const bytes=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));data=btoa(s);fmt='docx'}else{data=await file.text();fmt=ext==='csv'?'csv':'md'}
  const j=await api('/api/fianotes/import',{fmt,name:file.name,data,folder:FN.folder||'inbox'});applyNote(j);FN.mode='library';FN.db=await api('/api/fianotes');render()}catch(e){FN.migrateMsg='⚠ '+e.message;FN.mode='bring';render()}};
document.addEventListener('click',e=>{const a=e.target.closest?.('.fn-wiki');if(!a||!a.dataset.ref)return;e.preventDefault();const ref=a.dataset.ref,notes=FN.db?.notes||[];const hit=notes.find(n=>n.id===ref)||notes.find(n=>n.title.toLowerCase()===ref.toLowerCase());if(hit)open(hit.id);else FN.createLinked(ref)});
FN.createLinked=async title=>{const j=await api('/api/fianotes/note',{kind:'note',title,folder:FN.note?.folder||FN.folder||'inbox',body:'',person:'Everyone',tags:[]});applyNote(j);FN.db=await api('/api/fianotes');render()};
async function autoMigrate(){let flag='';try{flag=localStorage.getItem('fiaos.fnMigrated')||''}catch{}if(flag)return;await FN.bring()}
const _r=render;render=function(){const ed=document.activeElement,keep=ed&&ed.classList&&ed.classList.contains('fn-keep'),ss=keep?ed.selectionStart:null,se=keep?ed.selectionEnd:null,id=keep?ed.id:'';_r.apply(this,arguments);if(keep&&view.tab==='Notes'){const n=id&&document.getElementById(id);if(n){n.focus();try{if(ss!=null)n.setSelectionRange(ss,se)}catch{}}}};window.render=render;
(async()=>{try{await PROXY_READY}catch{}await load();try{await autoMigrate()}catch(e){console.warn('fianotes migrate',e)}})();
if(document.getElementById('main'))render();
})();
