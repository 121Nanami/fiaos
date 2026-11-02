// fiaOS weekly review (client). Server builds it (weekly.js) every Sunday from 6 pm and saves it to Notion "Weekly Reviews".
// Stage shows a calm review card on Sunday and Monday; the "Week" tab browses past weeks and can build "this week so far".
// One index fetch at start + every 30 min (re-render only if it changed). No sound, no motion.
(()=>{
let IDX=null,CUR=null,PICK=null,BUSY=false,MSG='';const LOADED={};
const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
const fmt=s=>new Date(s+'T12:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});
async function idx(){if(!PROXY.ok)return;try{const j=await api('/api/weekly'),was=JSON.stringify(IDX?.weeks);IDX=j;if(j.latest)LOADED[j.latest.week]=j.latest;
 if(was!==JSON.stringify(j.weeks)&&quiet()&&(view.tab==='Week'||(view.tab==='Stage'&&showCard())))render()}catch{}}
async function load(w){if(LOADED[w]||!PROXY.ok)return LOADED[w];try{LOADED[w]=w==='preview'?await api('/api/weekly?week=preview'):await api('/api/weekly?week='+w)}catch(e){MSG='⚠ '+e.message}return LOADED[w]}
const dow=()=>new Date().getDay();
function showCard(){return dow()===0||dow()===1}
// Sunday: this week's final review (after 6 pm) or this week so far; Monday: last week's final review
function cardReview(){if(!IDX)return null;const L=IDX.latest;
 if(L&&L.final&&daysUntil(L.end)>=-1&&daysUntil(L.end)<=0)return L;
 if(dow()===0)return LOADED.preview&&!LOADED.preview.none?LOADED.preview:null;return null}
const lineHtml=x=>`<li class="${x.missing?'miss':''}"><span class="wk">${esc(x.k)}</span><span>${esc(x.t)}</span></li>`;
function personBlock(W,p,{compact}={}){const R=p==='Household'?W.household:W.people?.[p];if(!R)return'<p class="mute">Not in this review.</p>';
 const past=R.lines.filter(x=>!x.ahead),ahead=R.lines.filter(x=>x.ahead);
 const A=R.ahead||W.household.ahead;
 return`${R.summary?`<p class="wsum">${esc(R.summary)}</p>`:''}<div class="wgrid"><div><h4>${W.final?'The week':'So far this week'}</h4><ul class="wl">${(compact?past.slice(0,5):past).map(lineHtml).join('')}</ul></div>
 <div><h4>Week ahead <small>${fmt(A.from)} – ${fmt(A.to)}</small></h4><ul class="wl">${ahead.map(lineHtml).join('')}</ul></div></div>`}
const notionLink=(W,p)=>{const u=W.notion?.urls?.[p];return u?` · <a href="${esc(u)}" target="_blank" rel="noopener">Open in Notion ↗</a>`:''};
function weekCard(){if(!showCard())return'';const W=cardReview();
 if(!W){if(dow()===0&&IDX&&!LOADED.preview&&!BUSY&&!window.__wkTried){window.__wkTried=true;BUSY=true;api('/api/weekly/run',{preview:true}).then(j=>{LOADED.preview=j}).catch(()=>{}).finally(()=>{BUSY=false;if(quiet()&&view.tab==='Stage')render()})}return''}
 const p=view.person;return card(`🗓️ Weekly review <small class="mute">${fmt(W.week)} – ${fmt(W.end)}${W.final?'':' · so far'}</small>`,personBlock(W,p,{compact:true})+
 `<p class="ex"><button class="sm" onclick="view.tab='Week';render()">Full review</button>${notionLink(W,p)}</p>`,'wide weekly')}
window.weekCard=weekCard;
const _St=VIEWS.Stage;VIEWS.Stage=()=>{const h=_St(),c=weekCard();if(!c)return h;const b=h.indexOf('class="card wide brief"');if(b<0)return c+h;const e=h.indexOf('</section>',b)+10;return h.slice(0,e)+c+h.slice(e)};
// ---- Week tab ----
window.weekPick=async w=>{PICK=w;MSG='';render();await load(w);render()};
window.weekPreview=async()=>{if(BUSY)return;BUSY=true;MSG='Building this week so far…';render();
 try{LOADED.preview=await api('/api/weekly/run',{preview:true});PICK='preview';MSG=''}catch(e){MSG='⚠ '+e.message}BUSY=false;render()};
if(!TABS.includes('Week'))TABS.splice(TABS.indexOf('Settings'),0,'Week');
VIEWS.Week=()=>{if(!PROXY.ok)return card('🗓️ Weekly review','<p class="mute">Needs the fiaOS server.</p>','wide');if(!IDX){idx();return card('🗓️ Weekly review','<p class="mute">Loading…</p>','wide')}
 const weeks=IDX.weeks||[];PICK??=(weeks[0]?.week||'preview');const W=LOADED[PICK];if(!W&&PICK)load(PICK).then(()=>render());
 const opt=weeks.map(w=>`<option value="${w.week}" ${PICK===w.week?'selected':''}>${fmt(w.week)} – ${fmt(w.end)}</option>`).join('')+`<option value="preview" ${PICK==='preview'?'selected':''}>This week so far</option>`;
 const head=`<div class="row wpick"><select onchange="weekPick(this.value)">${opt}</select><button class="sm" onclick="weekPreview()" ${BUSY?'disabled':''}>↻ Build this week so far</button></div>${MSG?`<p class="mute">${esc(MSG)}</p>`:''}`;
 if(!W||W.none)return card('🗓️ Weekly review',head+`<p class="mute">${PICK==='preview'?'Tap “Build this week so far” to see the week up to now.':'Loading…'}</p><p class="ex">A review is written automatically every Sunday from 6 pm and saved to Notion.</p>`,'wide');
 const P=view.person==='Household'?['Household',...PEOPLE]:[view.person];
 return card(`🗓️ Weekly review <small class="mute">${fmt(W.week)} – ${fmt(W.end)}${W.final?'':' · so far (not saved to Notion)'}</small>`,head+`<p class="ex">Built ${new Date(W.generatedAt).toLocaleString('en-AU',{weekday:'short',hour:'numeric',minute:'2-digit'})} from fiaOS, Notion and Apple Health. Faded lines weren't recorded.${IDX.db?` · <a href="${esc(IDX.db)}" target="_blank" rel="noopener">Weekly Reviews in Notion ↗</a>`:''}</p>`,'wide')
  +P.map(p=>card(`${p==='Household'?'🏠 Household':esc(p)}${notionLink(W,p)}`,personBlock(W,p),'wide weekly')).join('')};
// bins settings -> server (so "week ahead" bins match Settings)
const sendBins=()=>{if(PROXY.ok&&S.settings.bins)api('/api/weekly/prefs',{bins:S.settings.bins}).catch(()=>{})};
const _sb=window.saveBins;if(_sb)window.saveBins=()=>{_sb();sendBins()};
(async()=>{try{await PROXY_READY}catch{}setTimeout(()=>{idx();sendBins()},3000)})();setInterval(idx,30*60e3);
})();
