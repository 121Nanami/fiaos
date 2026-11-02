// fiaOS Fia Health link (client). Card on Stage: status of the Fia Health app and one button per person that opens their own sign-in
// (separate logins and encrypted vaults for Cam, Bea and Ada). fiaOS never reads health records; sign-in happens in Fia Health.
(()=>{
let HL=null,BUSY=false;
const quiet=()=>!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');
async function load(){if(!PROXY.ok)return;try{const j=await api('/api/fiahealth/status'),was=JSON.stringify(HL);HL=j;if(was!==JSON.stringify(j)&&quiet()&&view.tab==='Stage')render()}catch(e){HL={error:e.message}}}
window.fhStart=async()=>{if(BUSY)return;BUSY=true;render();try{await api('/api/fiahealth/start',{})}catch(e){HL={error:e.message}}BUSY=false;await load();render()};
window.fhOpen=p=>window.open(`${HL.url}/?user=${encodeURIComponent(p)}`,'_blank','noopener');
function healthCard(){if(!PROXY.ok||!HL)return'';
 if(HL.error)return card('❤ Fia Health',`<p class="mute">${esc(HL.error)}</p>`,'health');
 if(!HL.installed)return card('❤ Fia Health','<p class="mute">Fia Health is not installed on this Mac.</p>','health');
 if(!HL.running)return card('❤ Fia Health',`<p class="mute">Not running.</p><button onclick="fhStart()" ${BUSY?'disabled':''}>${BUSY?'Starting…':'Start Fia Health'}</button>`,'health');
 const by=Object.fromEntries((HL.accounts||[]).map(a=>[a.name,a]));
 return card('❤ Fia Health',`<p class="ex">Each person signs in to their own vault.</p><div class="row">${PEOPLE.map(p=>`<button onclick="fhOpen('${p}')">${esc(p)}${by[p]?.registered?'':' · set up'}</button>`).join('')}</div>`,'health')}
const _St=VIEWS.Stage;VIEWS.Stage=()=>{const h=_St(),c=healthCard();if(!c)return h;const b=h.indexOf('class="card wide brief"');if(b<0)return c+h;const e=h.indexOf('</section>',b)+10;return h.slice(0,e)+c+h.slice(e)};
(async()=>{try{await PROXY_READY}catch{}setTimeout(load,2500)})();setInterval(load,60e3);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')load()});
})();
