// House tab: mail, media, studio and desk in the same fiaOS shell. Embeds: desk.html and facet.html.
// Shared search is /api/hub/search. Cross-links are /api/hub/links.
(()=>{
if(!TABS.includes('House'))TABS.push('House');
{const tt=new URLSearchParams(location.search).get('tab');if(tt==='House')view.tab='House'}
const H=window.HOUSE={mode:'search',q:'',hits:[],mail:null,msg:null,events:[],media:null,pods:null,desk:null,studio:null,local:null,facet:null,err:'',status:'',svg:'',slides:[{title:'Title',body:'One idea.',notes:''}],deckTitle:'Untitled deck'};
const ea=s=>esc(s??'').replace(/"/g,'&quot;');
const apiH=async(u,b)=>{const r=await fetch(u,b?{method:'POST',headers:{'Content-Type':'application/json','X-FiaOS':'1'},body:JSON.stringify(b)}:{headers:{'X-FiaOS':'1'}});const j=await r.json().catch(()=>({error:'bad response'}));if(!r.ok)throw new Error(j.error||r.status);return j};
function setStatus(t){H.status=t;const s=document.getElementById('house-status');if(s)s.textContent=t}
async function load(){try{
  if(H.mode==='mail'){H.mail=await apiH('/api/mail?person='+(typeof ME==='function'?ME():'Bea'));H.events=(await apiH('/api/mail/calendar?person=All')).events}
  if(H.mode==='media'){H.media=await apiH('/api/media');try{H.pods=await apiH('/api/media/podcasts?person=Bea')}catch(e){H.pods={episodes:[],error:e.message}}}
  if(H.mode==='desk'){H.desk=await apiH('/api/launcher');H.local=await apiH('/api/local');H.facet=await apiH('/api/facet')}
  if(H.mode==='studio'){H.studio=await apiH('/api/studio')}
  H.err=''}catch(e){H.err=e.message}
 if(view.tab==='House'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||''))render();if(H.focusCal)requestAnimationFrame(()=>document.getElementById('house-cal')?.scrollIntoView({block:'start'}))}
function modes(){return ['search','mail','media','studio','desk'].map(m=>`<button type="button" class="${H.mode===m?'on':''}" onclick="HOUSE.mode='${m}';HOUSE.load()">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}
function searchHtml(){return `<div class="row"><input id="house-q" class="fn-keep" placeholder="Search notes, mail, events, tasks, media…" value="${ea(H.q)}" onkeydown="if(event.key==='Enter')HOUSE.find()"><button type="button" onclick="HOUSE.find()">Search</button></div>
 ${H.hits.length?H.hits.map(h=>`<button type="button" class="fn-item" onclick="HOUSE.openHit('${ea(h.kind)}','${ea(h.id)}','${ea(h.tab)}')"><b>${esc(h.title||h.kind)}</b><small>${esc(h.kind)} · ${esc(h.tab||'')}</small><span>${esc(h.snippet||'')}</span></button>`).join(''):'<p class="mute">One search across the house. Try “clinic” or “bin”.</p>'}`}
function mailHtml(){const m=H.mail;if(!m)return'<p class="mute">Loading mail…</p>';
 const list=(m.items||[]).map(i=>`<button type="button" class="fn-item ${i.unread?'':'mute'}" onclick="HOUSE.openMail('${i.id}')"><b>${esc(i.subject)}</b><small>${esc(i.from)} · ${esc((i.date||'').slice(0,16).replace('T',' '))}</small></button>`).join('');
 const ev=(H.events||[]).map(e=>`<li><b>${esc(e.title)}</b> <small>${esc(e.person)} · ${esc(String(e.start).replace('T',' ').slice(0,16))}${e.noteId?` · note ${esc(e.noteId)}`:''}</small></li>`).join('');
 const open=H.msg?`<article class="fn-prev"><h2>${esc(H.msg.subject)}</h2><p class="mute">${esc(H.msg.from)} → ${esc(H.msg.to||'')}</p><p>${esc(H.msg.body||'').replace(/\n/g,'<br>')}</p>
  <div class="row"><input id="house-linknote" placeholder="Note id to link" value="${ea(H.msg.noteId||'')}"><button type="button" class="sm" onclick="HOUSE.linkMail()">Link note</button></div></article>`:'';
 return `<div class="house-split"><div>${m.example?'<p class="ex">Example mail is loaded so the inbox is not empty.</p>':''}<p>${m.unread} unread · ${(m.sources||[]).join(', ')}</p>${list}
  <h3 id="house-cal">Calendar</h3><ul class="fn-cal">${ev||'<li class="mute">No events.</li>'}</ul>
  <p><a href="/api/mail/calendar?fmt=ics">Download .ics</a></p></div>
  <div>${open}
  <h3>New message</h3>
  <input id="house-to" placeholder="To"><input id="house-sub" placeholder="Subject"><textarea id="house-body" class="fn-ed" placeholder="Message. It is saved here. SMTP sends it if you have set a server."></textarea>
  <div class="row"><button type="button" onclick="HOUSE.sendMail()">Keep / send</button><button type="button" class="sm" onclick="HOUSE.addEvent()">Add today’s event</button></div>
  <details><summary>IMAP / SMTP on this machine</summary>
  <div class="row"><input id="house-imap-host" placeholder="IMAP host"><input id="house-imap-user" placeholder="User"><input id="house-imap-pass" type="password" placeholder="Password"></div>
  <div class="row"><button type="button" class="sm" onclick="HOUSE.saveImap()">Save IMAP</button><button type="button" class="sm" onclick="HOUSE.syncImap()">Fetch</button></div>
  <p class="ex">Passwords stay in data/mail.json on this machine (mode 0600). Nothing is sent to Google.</p></details>
  <p id="house-status" class="mute" role="status" aria-live="polite">${esc(H.status)}</p></div></div>`}
function mediaHtml(){const files=H.media?.files||[];const pods=(H.pods?.episodes||[]).slice(0,5);
 return `<p class="mute">${files.length} file${files.length===1?'':'s'} in the library${H.media?.ytdlp?' · yt-dlp is installed':' · yt-dlp not installed (download stays off)'}.</p>
 <div class="row house-focus"><button type="button" class="sm" onclick="HOUSE.focus('white')">White</button><button type="button" class="sm" onclick="HOUSE.focus('pink')">Pink</button><button type="button" class="sm" onclick="HOUSE.focus('brown')">Brown</button><button type="button" class="sm" onclick="HOUSE.focus('binaural')">Binaural</button><button type="button" class="sm" onclick="HOUSE.focusStop()">Stop</button></div>
 <p class="ex">Focus audio is generated here and only plays while you ask. It is separate from the storm chime.</p>
 ${files.map(f=>`<div class="fn-item"><b>${esc(f.name)}</b><small>${esc(f.kind)} · ${Math.round(f.bytes/1024)} KB</small>${f.kind==='audio'?`<audio controls src="/api/media/file?id=${encodeURIComponent(f.rel)}"></audio>`:''}${f.kind==='video'?`<video controls src="/api/media/file?id=${encodeURIComponent(f.rel)}"></video>`:''}${f.kind==='image'?`<img alt="" src="/api/media/file?id=${encodeURIComponent(f.rel)}" style="max-width:100%;border-radius:12px">`:''}</div>`).join('')||'<p class="mute">Drop audio, video or pictures into the media folder. Podcasts still arrive from the Stage card.</p>'}
 <h3>Podcasts</h3>${H.pods?.error?`<p class="mute">${esc(H.pods.error)}</p>`:pods.map(e=>`<p><a href="${ea(e.listen||e.url||'#')}" target="_blank" rel="noopener">${esc(e.title||'Episode')}</a> <small>${esc(e.show||'')}</small></p>`).join('')||'<p class="mute">No episodes cached.</p>'}
 <div class="row"><input id="house-dl" placeholder="https:// link for yt-dlp"><button type="button" onclick="HOUSE.dl()">Download</button></div>
 <p class="ex">The downloader only runs if yt-dlp is installed locally. Files land in the media folder. Use it for things you are allowed to keep.</p>`}
function studioHtml(){const s=H.studio||{paint:[],draw:[],slides:[],clips:[],ffmpeg:false};
 return `<div class="row"><button type="button" class="sm ${H.sub==='paint'?'on':''}" onclick="HOUSE.sub='paint';render()">FiaPaint</button><button type="button" class="sm ${H.sub==='draw'?'on':''}" onclick="HOUSE.sub='draw';render()">FiaDraw</button><button type="button" class="sm ${H.sub==='slides'?'on':''}" onclick="HOUSE.sub='slides';render()">FiaSlides</button><button type="button" class="sm ${H.sub==='clip'?'on':''}" onclick="HOUSE.sub='clip';render()">FiaClip</button></div>
 ${H.sub==='draw'?drawHtml():H.sub==='slides'?slidesHtml(s):H.sub==='clip'?`<p>Mark an in and out on a file already in the media library. ${s.ffmpeg?'ffmpeg is installed and can copy a trim.':'ffmpeg is not installed, so the points are saved and the file stays whole.'} Several spans, joined together, are in Studio → FiaClip.</p>
  <div class="row"><input id="house-clip-file" aria-label="File in the media library" placeholder="file name in the library"><input id="house-clip-a" type="number" aria-label="Start seconds" placeholder="start sec" value="0"><input id="house-clip-b" type="number" aria-label="End seconds" placeholder="end sec" value="10"><button type="button" onclick="HOUSE.saveClip()">Save trim</button></div>`
  :`<p>FiaPaint. Strokes stay in the browser until you save a PNG. Layers, opacity and blend modes are in the Studio tab.</p><div class="row"><input id="house-ink" type="color" value="#1c2430" aria-label="Brush colour"><button type="button" class="sm" onclick="HOUSE.paintClear()">Clear</button><button type="button" onclick="HOUSE.paintSave()">Save PNG</button></div><canvas id="house-paint" width="640" height="360" aria-label="Quick painting canvas"></canvas>`}
 <p id="house-status" class="mute" role="status" aria-live="polite">${esc(H.status)}</p>
 <p class="ex">${(s.slides||[]).length} deck${s.slides?.length===1?'':'s'} · ${(s.draw||[]).length} drawing${s.draw?.length===1?'':'s'} · ${(s.paint||[]).length} painting${s.paint?.length===1?'':'s'}. Open formats: PNG, SVG, HTML, ODT.</p>`}
function drawHtml(){return `<p>FiaDraw writes SVG. Rectangles and words only, on purpose.</p>
 <div class="row"><button type="button" class="sm" onclick="HOUSE.addShape('rect')">Rectangle</button><button type="button" class="sm" onclick="HOUSE.addShape('text')">Word</button><button type="button" onclick="HOUSE.saveDraw()">Save SVG</button></div>
 <div id="house-svg" class="house-svg">${H.svg||'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="100%" height="280"><rect width="640" height="360" fill="#f7f3ea"/></svg>'}</div>`}
function slidesHtml(s){const slides=H.slides||[];
 return `<input id="house-deck" class="fn-title fn-keep" value="${ea(H.deckTitle)}" oninput="HOUSE.deckTitle=this.value">
 ${slides.map((sl,i)=>`<div class="house-slide"><input value="${ea(sl.title)}" oninput="HOUSE.slides[${i}].title=this.value" placeholder="Slide title"><textarea class="fn-ed" oninput="HOUSE.slides[${i}].body=this.value">${esc(sl.body||'')}</textarea><input value="${ea(sl.notes||'')}" oninput="HOUSE.slides[${i}].notes=this.value" placeholder="Speaker notes"></div>`).join('')}
 <div class="row"><button type="button" class="sm" onclick="HOUSE.addSlide()">Add slide</button><button type="button" onclick="HOUSE.saveSlides()">Save deck</button><button type="button" class="sm" onclick="HOUSE.present()">Present / print</button><button type="button" class="sm" onclick="HOUSE.mailDeck()">Draft a message</button></div>
 ${(s.slides||[]).map(d=>`<button type="button" class="tag" onclick="HOUSE.loadDeck('${d.id}')">${esc(d.title)}</button>`).join('')}`}
function deskHtml(){const d=H.desk,st=d?.stats||{},mem=st.mem||{},loc=H.local||{},wg=loc.wireguard||{},mx=loc.matrix||{};
 const gb=n=>n?Math.round(n/1024/1024/1024*10)/10+' GB':'—';
 return `<div class="house-split"><div><h3>Launcher</h3>${(d?.apps||[]).slice(0,12).map(a=>`<div class="fn-item"><b>${esc(a.name)}</b><small>${esc(a.kind)}</small>${a.kind==='page'?`<a href="${ea(a.exec)}">${esc(a.exec)}</a>`:`<code>${esc(a.exec)}</code>`}</div>`).join('')}
  <h3>Tile</h3><div class="row"><button type="button" class="sm" onclick="HOUSE.tile('left')">Left</button><button type="button" class="sm" onclick="HOUSE.tile('right')">Right</button><button type="button" class="sm" onclick="HOUSE.tile('focus')">Fullscreen</button></div>
  <p class="ex">Centre embeds <a href="/desk.html">/desk.html</a>. If swaymsg or wmctrl is missing, the button reports the command and Centre can run it.</p></div>
  <div><h3>${esc(st.hostname||'This machine')}</h3><p>Load ${esc((st.load||[]).join(' · '))} · up ${Math.round((st.uptime||0)/3600)} h<br>Memory ${gb(mem.MemAvailable)} free of ${gb(mem.MemTotal)}</p>
  <h3>Clipboard</h3><div class="row"><input id="house-clip" placeholder="Paste to keep a copy"><button type="button" onclick="HOUSE.keepClip()">Keep</button></div>
  ${(d?.clipboard||[]).slice(0,6).map(c=>`<p class="fn-prev">${esc(c.text).slice(0,180)}</p>`).join('')||'<p class="mute">Nothing kept yet.</p>'}
  <h3>Facet</h3><p><a href="/facet.html">Open the Facet start page</a></p>
  ${(H.facet?.bookmarks||[]).map(b=>`<a class="tag" href="${ea(b.url)}">${esc(b.title)}</a>`).join('')}
  <h3>House room</h3><p class="mute">${mx.up?'Conduit is up at '+esc(mx.base):'Conduit is not running. Messages below stay in data/matrix-room.json. '+esc(wg.note||'')}</p>
  <div id="house-chat">${(H.chat||[]).map(m=>`<p><b>${esc(m.who)}</b> ${esc(m.text)}</p>`).join('')}</div>
  <div class="row"><input id="house-say" placeholder="Say something"><button type="button" onclick="HOUSE.say()">Send</button></div>
  <p id="house-status" class="mute" role="status" aria-live="polite">${esc(H.status)}</p></div></div>`}
function shell(){if(H.err)return card('House',`<p class="warn">⚠ ${esc(H.err)}</p><p class="ex">Start <code>node server.js</code>.</p>`,'wide house');
 const body=H.mode==='mail'?mailHtml():H.mode==='media'?mediaHtml():H.mode==='studio'?studioHtml():H.mode==='desk'?deskHtml():searchHtml();
 return `<section class="card wide house"><h3>House <small>mail · media · studio · desk</small></h3><div class="row house-modes">${modes()}</div>${body}</section>`}
VIEWS.House=()=>shell();
H.load=()=>{load()};
HOUSE.find=async()=>{H.q=document.getElementById('house-q')?.value||H.q;try{H.hits=(await apiH('/api/hub/search?q='+encodeURIComponent(H.q))).hits;H.mode='search';render()}catch(e){setStatus(e.message)}};
HOUSE.openHit=(kind,id,tab)=>{if(tab==='Notes'&&window.FN){view.tab='Notes';FN.open(id);return}if(kind==='mail'){H.mode='mail';load().then(()=>HOUSE.openMail(id));return}if(kind==='event'){H.mode='mail';load();return}view.tab=tab||'House';if(tab==='House'){H.mode=kind==='media'?'media':kind==='studio'?'studio':'desk'}render()};
HOUSE.openMail=async id=>{try{H.msg=(await apiH('/api/mail/message?id='+encodeURIComponent(id))).message;await apiH('/api/mail/read',{id});render()}catch(e){setStatus(e.message)}};
HOUSE.linkMail=async()=>{if(!H.msg)return;const noteId=document.getElementById('house-linknote')?.value.trim();await apiH('/api/mail/message',{id:H.msg.id,noteId});if(noteId)await apiH('/api/hub/links',{fromKind:'mail',fromId:H.msg.id,toKind:'note',toId:noteId,label:'from mail'});setStatus('Linked');H.msg.noteId=noteId};
HOUSE.sendMail=async()=>{try{const j=await apiH('/api/mail/send',{person:typeof ME==='function'?ME():'Bea',to:document.getElementById('house-to').value,subject:document.getElementById('house-sub').value,body:document.getElementById('house-body').value});setStatus(j.sent?'Sent.':'Saved on this machine.');H.mode='mail';await load()}catch(e){setStatus(e.message)}};
HOUSE.addEvent=async()=>{const day=new Date().toLocaleDateString('en-CA');try{await apiH('/api/mail/event',{person:typeof ME==='function'?ME():'Bea',title:document.getElementById('house-sub')?.value||'New event',start:day+'T09:00:00',end:day+'T10:00:00'});setStatus('Event added');await load()}catch(e){setStatus(e.message)}};
HOUSE.saveImap=async()=>{try{await apiH('/api/mail/account',{person:typeof ME==='function'?ME():'Bea',kind:'imap',host:document.getElementById('house-imap-host').value,user:document.getElementById('house-imap-user').value,pass:document.getElementById('house-imap-pass').value,port:993,secure:true});setStatus('IMAP saved')}catch(e){setStatus(e.message)}};
HOUSE.syncImap=async()=>{try{const j=await apiH('/api/mail/sync',{person:typeof ME==='function'?ME():'Bea'});setStatus('Fetched '+j.added);await load()}catch(e){setStatus(e.message)}};
let focusCtx=null,focusNodes=[];
HOUSE.focusStop=()=>{focusNodes.forEach(n=>{try{n.stop?.()}catch{}try{n.disconnect?.()}catch{}});focusNodes=[];if(focusCtx){focusCtx.close();focusCtx=null}};
HOUSE.focus=kind=>{HOUSE.focusStop();const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx){setStatus('This browser has no audio engine');return}focusCtx=new Ctx();const master=focusCtx.createGain();master.gain.value=0.04;master.connect(focusCtx.destination);
 if(kind==='binaural'){const a=focusCtx.createOscillator(),b=focusCtx.createOscillator();a.frequency.value=140;b.frequency.value=148;const pa=focusCtx.createStereoPanner(),pb=focusCtx.createStereoPanner();pa.pan.value=-1;pb.pan.value=1;a.connect(pa).connect(master);b.connect(pb).connect(master);a.start();b.start();focusNodes=[a,b];return}
 const len=focusCtx.sampleRate*2,buf=focusCtx.createBuffer(1,len,focusCtx.sampleRate),data=buf.getChannelData(0);let brown=0;
 for(let i=0;i<len;i++){const w=Math.random()*2-1;if(kind==='brown'){brown=(brown+w*0.02)/1.02;data[i]=brown}else if(kind==='pink'){data[i]=(data[i-1]||0)*0.98+w*0.02}else data[i]=w}
 const src=focusCtx.createBufferSource();src.buffer=buf;src.loop=true;src.connect(master);src.start();focusNodes=[src]};
HOUSE.dl=async()=>{try{const j=await apiH('/api/media/download',{url:document.getElementById('house-dl').value});setStatus(j.stub?j.error:('Saved '+(j.added||[]).length));if(!j.stub)await load()}catch(e){setStatus(e.message)}};
H.sub='paint';
function paintPos(c,e){const r=c.getBoundingClientRect();return [(e.clientX-r.left)*(c.width/r.width),(e.clientY-r.top)*(c.height/r.height)]}
function paintBoot(){const c=document.getElementById('house-paint');if(!c||c.dataset.on)return;c.dataset.on='1';const g=c.getContext('2d');g.fillStyle='#f7f3ea';g.fillRect(0,0,c.width,c.height);g.lineCap='round';let down=false;
 c.onpointerdown=e=>{down=true;g.strokeStyle=(document.getElementById('house-ink')||{}).value||'#1c2430';g.lineWidth=3;g.beginPath();const p=paintPos(c,e);g.moveTo(p[0],p[1])};
 c.onpointermove=e=>{if(!down)return;const p=paintPos(c,e);g.lineTo(p[0],p[1]);g.stroke()};
 c.onpointerup=()=>down=false;c.onpointerleave=()=>down=false}
HOUSE.paintClear=()=>{const c=document.getElementById('house-paint');if(!c)return;const g=c.getContext('2d');g.fillStyle='#f7f3ea';g.fillRect(0,0,c.width,c.height)};
HOUSE.paintSave=async()=>{const c=document.getElementById('house-paint');if(!c)return;try{const j=await apiH('/api/studio/paint',{title:'Painting',png:c.toDataURL('image/png')});setStatus('Saved '+j.id)}catch(e){setStatus(e.message)}};
HOUSE.addShape=kind=>{const host=document.getElementById('house-svg');if(!host)return;let svg=host.querySelector('svg');if(!svg){host.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="100%" height="280"><rect width="640" height="360" fill="#f7f3ea"/></svg>';svg=host.querySelector('svg')}
 if(kind==='rect'){const r=document.createElementNS('http://www.w3.org/2000/svg','rect');r.setAttribute('x',40+Math.random()*200);r.setAttribute('y',40+Math.random()*80);r.setAttribute('width',120);r.setAttribute('height',70);r.setAttribute('fill','#39C5BB');svg.appendChild(r)}
 else{const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',48);t.setAttribute('y',180);t.setAttribute('fill','#1c2430');t.setAttribute('font-size','28');t.textContent='Bea';svg.appendChild(t)}
 H.svg=host.innerHTML};
HOUSE.saveDraw=async()=>{const svg=document.querySelector('#house-svg svg');if(!svg)return;try{const j=await apiH('/api/studio/draw',{title:'Drawing',svg:svg.outerHTML});setStatus('Saved '+j.id)}catch(e){setStatus(e.message)}};
HOUSE.addSlide=()=>{H.slides.push({title:'',body:'',notes:''});render()};
HOUSE.saveSlides=async()=>{try{const j=await apiH('/api/studio/slides',{title:H.deckTitle,slides:H.slides});H.deckId=j.id;setStatus('Deck saved');H.studio=await apiH('/api/studio')}catch(e){setStatus(e.message)}};
HOUSE.present=()=>{if(!H.deckId){setStatus('Save the deck first');return}window.open('/api/studio/slides/html?id='+encodeURIComponent(H.deckId),'_blank')};
HOUSE.loadDeck=id=>{const d=(H.studio?.slides||[]).find(x=>x.id===id);if(!d)return;H.deckId=d.id;H.deckTitle=d.title;H.slides=d.slides.map(s=>({...s}));H.sub='slides';render()};
HOUSE.mailDeck=async()=>{H.mode='mail';await load();setTimeout(()=>{const s=document.getElementById('house-sub'),b=document.getElementById('house-body');if(s)s.value=H.deckTitle;if(b)b.value=H.slides.map(sl=>sl.title+'\n'+sl.body).join('\n\n')},50)};
HOUSE.saveClip=async()=>{try{const file=document.getElementById('house-clip-file').value,start=+document.getElementById('house-clip-a').value,end=+document.getElementById('house-clip-b').value;const j=await apiH('/api/studio/clip',{title:'Trim',file,segments:[{start,end}]});setStatus(j.ok?('Cut '+(j.file||'a copy')):(j.error||'Timeline saved'))}catch(e){setStatus(e.message)}};
HOUSE.tile=async p=>{try{const j=await apiH('/api/launcher/tile',{preset:p});setStatus(j.ran?('Ran '+j.ran):j.note)}catch(e){setStatus(e.message)}};
HOUSE.keepClip=async()=>{try{await apiH('/api/launcher/clipboard',{text:document.getElementById('house-clip').value});H.desk=await apiH('/api/launcher');render()}catch(e){setStatus(e.message)}};
HOUSE.say=async()=>{try{const j=await apiH('/api/local/room',{who:typeof ME==='function'?ME():'Bea',text:document.getElementById('house-say').value});H.chat=j.messages;const box=document.getElementById('house-chat');if(box)box.innerHTML=j.messages.map(m=>`<p><b>${esc(m.who)}</b> ${esc(m.text)}</p>`).join('');document.getElementById('house-say').value=''}catch(e){setStatus(e.message)}};
const _r=render;render=function(){_r.apply(this,arguments);if(view.tab==='House'&&H.mode==='studio'&&H.sub==='paint')paintBoot()};window.render=render;
if(document.getElementById('main'))render();
})();
