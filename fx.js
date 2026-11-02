// fiaOS ambient FX — calm & low-power. No canvas, no continuous JS loops, no audio.
// Motion = CSS transform/opacity only; all animation pauses after 45 s idle, at night, when hidden, and with prefers-reduced-motion.
(()=>{
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
S.settings.quality??=(reduce?'Lite':'High');S.settings.autoQ??=true;S.settings.night??={on:true,from:21,to:6};S.settings.homeProfile??='Bea';view.person=S.settings.homeProfile;
const st=()=>S.settings,B=document.body;
const amb=document.createElement('div');amb.id='ambient';amb.innerHTML='<i class="orb o1"></i><i class="orb o2"></i><i class="orb o3"></i>';B.prepend(amb);
const dim=document.createElement('div');dim.id='dim';B.appendChild(dim);
function isNight(){const n=st().night,h=new Date().getHours();return n.on&&(n.from>n.to?(h>=n.from||h<n.to):(h>=n.from&&h<n.to))}
function apply(){B.dataset.q=reduce?'Lite':st().quality;B.classList.toggle('night',isNight())}
// idle: pause every CSS animation (CPU/GPU ~0) after 45 s without input
let idleT;const wake=()=>{B.classList.remove('idle');clearTimeout(idleT);idleT=setTimeout(()=>B.classList.add('idle'),45e3);if(B.classList.contains('night'))fetch('/api/wake',{method:'POST'}).catch(()=>{})};
// 20 min without input → back to Stage, close panels; screen stays on
let homeT;const goHome=()=>{document.getElementById('help')?.remove();document.getElementById('egg')?.remove();document.querySelectorAll('details[open]').forEach(d=>d.open=false);document.activeElement?.blur?.();view.person=S.settings.homeProfile||'Bea';if(!document.body.dataset.app){view.tab='Stage';render()}document.getElementById('main').scrollTop=0};
addEventListener('pointerdown',()=>{clearTimeout(homeT);homeT=setTimeout(goHome,20*60e3)},{passive:true});addEventListener('keydown',()=>{clearTimeout(homeT);homeT=setTimeout(goHome,20*60e3)});homeT=setTimeout(goHome,20*60e3);window.fxGoHome=goHome;
['pointerdown','keydown'].forEach(ev=>addEventListener(ev,wake,{passive:true}));wake();
document.addEventListener('visibilitychange',()=>B.classList.toggle('idle',document.hidden));
setInterval(()=>{if(isNight()!==B.classList.contains('night'))apply()},5*60e3);
// one-shot FPS probe (≈1 s of rAF only right after a tab change) → auto-lower quality if < 40 fps
let probing=false;function probe(){if(probing||!st().autoQ||B.dataset.q==='Lite')return;probing=true;let n=0,t0=performance.now();
 const f=t=>{n++;if(t-t0<1000)requestAnimationFrame(f);else{probing=false;const fps=n*1000/(t-t0);if(fps<40){setQuality(st().quality==='Ultra'?'High':'Lite',true)}}};requestAnimationFrame(f)}
window.setQuality=(qq,auto)=>{S.settings.quality=qq;if(auto)toast(`Switched to ${qq} quality for smoother performance (${qq})`);save();apply()};
window.toast=m=>{const d=document.createElement('div');d.className='toast';d.textContent=m;B.appendChild(d);setTimeout(()=>d.remove(),3000)};
document.addEventListener('pointerdown',e=>{const b=e.target.closest('button,.btn,a.tag');if(!b||B.dataset.q==='Lite'||true)return; // ripple off: calm appliance (fades only)
const r=b.getBoundingClientRect(),s=document.createElement('span'),d=Math.max(r.width,r.height)*2;s.className='ripple';s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left-d/2}px;top:${e.clientY-r.top-d/2}px`;b.appendChild(s);setTimeout(()=>s.remove(),500)},{passive:true});
const _render=window.render;let lastTab=null;window.render=function(){_render();renderPeople();const m=document.getElementById('main');if(view.tab!==lastTab){lastTab=view.tab;m.classList.remove('enter');void m.offsetWidth;m.classList.add('enter');probe()}};
const AV={Ada:'#39C5BB',Bea:'#F4D35E',Cam:'#FF8000',Household:'#8FC9D4'}; // per-person theme colours (polish.js)
function renderPeople(){const el=document.getElementById('people');if(!el)return;el.innerHTML=[...PEOPLE,'Household'].map(p=>`<button class="av ${view.person===p?'on':''}" title="${p}" aria-label="Show ${p}" onclick="view.person='${p}';render()" style="--c:${AV[p]||'#5a6b7a'}"><span>${p==='Household'?'⌂':p[0]}</span><em>${p==='Household'?'Home':p}</em></button>`).join('')}
// ===== Storm alert: the ONLY sound in fiaOS (one soft chime per storm, never 21:00–07:00) =====
function chime(){try{const C=window.AudioContext||window.webkitAudioContext,ac=new C(),t=ac.currentTime+.05,out=ac.createGain();out.gain.value=.12;out.connect(ac.destination);
 [[659.25,1,1.6],[987.77,.45,1.2],[1318.5,.15,.8]].forEach(([f,g,d])=>{const o=ac.createOscillator(),e=ac.createGain();o.type='sine';o.frequency.value=f;e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(g,t+.015);e.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(e);e.connect(out);o.start(t);o.stop(t+d+.05)});
 setTimeout(()=>ac.close(),2200);window.__chimed=(window.__chimed||0)+1}catch(e){console.warn('chime',e)}}
window.stormCheck=()=>{const h=W?.hourly;let hit=null;if(h&&h.time){const now=Date.now();for(let i=0;i<h.time.length;i++){const t=new Date(h.time[i]).getTime();if(t<now-36e5||t>now+12*36e5)continue;
  const code=h.weather_code?.[i],cape=h.cape?.[i]||0;if([95,96,99].includes(code)||cape>=1500){hit={time:h.time[i],code,cape};break}}}
 window.__storm=hit;let b=document.getElementById('storm');
 if(!hit){b?.remove();return}
 if(!b){b=document.createElement('div');b.id='storm';b.setAttribute('role','status');document.body.appendChild(b)}
 const when=new Date(hit.time).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
 b.innerHTML=`<span>⛈</span><div><b>Thunderstorm expected</b> — consider unplugging the Surface.<small>${[95,96,99].includes(hit.code)?'Storm forecast':'Unstable air (CAPE '+Math.round(hit.cape)+' J/kg)'} from about ${when} · Open-Meteo</small></div><button class="sm" onclick="this.parentNode.classList.add('min')">OK</button>`;
 const key=hit.time.slice(0,10)+'@'+S.settings.loc?.name,hr=new Date().getHours();
 if(S.settings.lastStormDing!==key&&hr>=7&&hr<21){S.settings.lastStormDing=key;localStorage.setItem(KEY,JSON.stringify(S));chime()}};
window.fxChime=chime;
const help=()=>{const h=document.getElementById('help');if(h)return h.remove();const d=document.createElement('div');d.id='help';d.innerHTML=`<div class="card"><h3>Keyboard shortcuts</h3><table>
<tr><td>1–9</td><td>First nine tabs</td></tr><tr><td>← / →</td><td>Previous / next tab, including Notes</td></tr><tr><td>/</td><td>Ask Negi-chan</td></tr><tr><td>Esc</td><td>Close / unfocus</td></tr>
<tr><td>Shift+Q</td><td>Cycle quality</td></tr><tr><td>Shift+N</td><td>Toggle night mode now</td></tr><tr><td>R</td><td>Refresh weather</td></tr><tr><td>?</td><td>This help</td></tr>
<tr><td>Ctrl+Alt+F2</td><td>Admin console (TTY2) · Ctrl+Alt+F1 back</td></tr></table><button onclick="this.closest('#help').remove()">Close</button></div>`;B.appendChild(d)};window.fxHelp=help;
addEventListener('keydown',e=>{if(e.key==='Escape'){document.activeElement.blur();document.getElementById('help')?.remove();document.getElementById('egg')?.remove();return}
 if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.target.isContentEditable||e.ctrlKey||e.metaKey||e.altKey)return;if(document.body.dataset.app&&(e.key==='ArrowRight'||e.key==='ArrowLeft'||/^[1-9]$/.test(e.key)))return;const i=TABS.indexOf(view.tab);
 if(/^[1-9]$/.test(e.key)&&TABS[+e.key-1]){view.tab=TABS[+e.key-1];render()}else if(e.key==='ArrowRight'){view.tab=TABS[(i+1)%TABS.length];render()}else if(e.key==='ArrowLeft'){view.tab=TABS[(i+TABS.length-1)%TABS.length];render()}
 else if(e.key==='/'){e.preventDefault();document.getElementById('ask').focus()}
 else if(e.key==='Q'){const o=['Ultra','High','Lite'];setQuality(o[(o.indexOf(st().quality)+1)%3]);toast('Quality: '+st().quality)}
 else if(e.key==='N'){B.classList.toggle('night')}else if(e.key==='r'&&window.loadWeather){loadWeather();toast('Refreshing weather…')}else if(e.key==='?')help()});
const _S=VIEWS.Settings,cb=(on,js,txt)=>`<label><input type="checkbox" style="min-height:auto;flex:none;width:28px;height:28px" ${on?'checked':''} onchange="${js}"> ${txt}</label>`;
VIEWS.Settings=()=>card('✨ Display & power',`<div class="row">${['Ultra','High','Lite'].map(x=>`<button class="${st().quality===x?'on':''}" onclick="setQuality('${x}')">${x}</button>`).join('')}</div>
${cb(st().autoQ,"S.settings.autoQ=this.checked;save()",'Auto-lower quality if animation drops below 40 fps')}
${cb(st().night.on,"S.settings.night.on=this.checked;save();setQuality(S.settings.quality)",`Night mode (dimmer, still) ${st().night.from}:00–${st().night.to}:00`)}
<label>Home profile (shown at start and after 20 min idle) <select onchange="S.settings.homeProfile=this.value;save()">${opts([...PEOPLE,'Household'],st().homeProfile)}</select></label>
<div class="row"><button class="sm" onclick="fxChime()">Test storm chime</button></div><small>Ultra and High: soft fades when switching tabs · Lite: no motion at all. Nothing moves on its own, nothing flashes, and everything stops after 45 s idle. The only sound is one soft chime when a thunderstorm is forecast (never 21:00–07:00).${reduce?' (Reduced motion is on in the system, so Lite is forced.)':''} Press <b>?</b> for shortcuts.</small>`,'wide')+_S();
apply();render();
})();
