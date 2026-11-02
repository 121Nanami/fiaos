// fiaOS polish (loaded last): per-person themes (Ada Miku teal, Cam papaya, Bea Mimikyu yellow/brown), tidy Settings
// (grouped sections, long setup cards collapsed), slimmer example-data notice, Miku extras only on Ada's view.
// Pure DOM tidy after each render — no timers, no polling, no motion.
(()=>{
// name tags + avatars follow the themes
Object.assign(PTAG,{Ada:'#39C5BB',Bea:'#F4D35E',Cam:'#FF8000',All:'#b7c3cf'});
// Miku song card + Negi-chan bubble are Ada's theme; Cam and Bea get their own plain nudge card
const _song=songCard;songCard=()=>view.person==='Ada'?_song():'';
const _says=mikuSays;mikuSays=()=>{const h=_says(),me=ME();if(view.person==='Ada')return h;
 const t=view.person==='Cam'?'🏁 Pit wall':view.person==='Bea'?'👻 Little nudges':'💬 Nudges';
 return h.replace(/<h3>[\s\S]*?<\/h3>/,`<h3>${t} <small>for ${esc(me)}</small></h3>`).replace('wide says','wide says plain')};
// ---- Settings: sections + collapsible long cards (open state remembered for this visit) ----
const GROUPS=[['Home & display',/Display & power|Bin day|Storm & fire|Live integrations|Targets/],['Accounts & services',/Accounts|Notion|NotebookLM|Apple Health/],['Helper & data',/Grok|^Data$/]];
const COLLAPSE=/Accounts|NotebookLM|Apple Health|Notion|Live integrations/;
const OPEN=new Set(JSON.parse(sessionStorage.getItem('fiaos.open')||'[]'));
window.cardToggle=(b,key)=>{const c=b.closest('.card');const open=!c.classList.contains('open');c.classList.toggle('open',open);b.textContent=open?'Less ▴':'More ▾';
 open?OPEN.add(key):OPEN.delete(key);sessionStorage.setItem('fiaos.open',JSON.stringify([...OPEN]))};
const title=c=>(c.querySelector(':scope>h3')?.textContent||'').replace(/^[^\w]+/,'').trim();
function tidySettings(m){const cards=[...m.querySelectorAll(':scope>section.card')];if(!cards.length)return;
 const placed=new Set(),frag=document.createDocumentFragment();
 for(const [name,re] of [...GROUPS,['More',/.*/]]){const L=cards.filter(c=>!placed.has(c)&&re.test(title(c)));if(!L.length)continue;
  const h=document.createElement('h2');h.className='sgroup';h.textContent=name;frag.appendChild(h);
  L.forEach(c=>{placed.add(c);frag.appendChild(c);const t=title(c);
   if(COLLAPSE.test(t)&&!c.querySelector(':scope>.cbody')){const kids=[...c.children].filter(x=>x.tagName!=='H3');if(kids.length<2&&!(kids[0]&&kids[0].textContent.length>400))return;
    const keep=kids[0],body=document.createElement('div');body.className='cbody';kids.slice(keep&&keep.textContent.length<400?1:0).forEach(k=>body.appendChild(k));c.appendChild(body);c.classList.add('collapsible');
    const key=t.slice(0,30),open=OPEN.has(key);c.classList.toggle('open',open);
    c.querySelector(':scope>h3').insertAdjacentHTML('beforeend',`<button class="sm cmore" onclick="cardToggle(this,'${key.replace(/'/g,'')}')">${open?'Less ▴':'More ▾'}</button>`)}})}
 m.appendChild(frag)}
function after(){const m=document.getElementById('main');if(!m)return;
 // example-data notice: one slim line, only on Stage and Settings
 const ex=[...m.querySelectorAll(':scope>section.card')].find(c=>/EXAMPLE DATA/.test(c.querySelector('h3')?.textContent||''));
 if(ex){if(!['Stage','Settings'].includes(view.tab))ex.remove();else ex.classList.add('exstrip')}
 if(view.tab==='Settings')tidySettings(m);
 if(view.tab==='Stage'){const b=m.querySelector(':scope>.brief'),w=m.querySelector(':scope>.card.weekly');if(b&&w)b.after(w)}}
const _r=window.render;window.render=function(){document.body.dataset.person=view.person;_r.apply(this,arguments);try{after()}catch(e){console.warn('polish',e)}};render=window.render;
document.body.dataset.person=view.person;render();
})();
