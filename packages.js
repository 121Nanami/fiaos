// fiaOS Packages — AusPost/StarTrack parcels found in the connected Gmail (server: /api/acct/packages, cached 15 min).
// Calm: one fetch at start + every 15 min, no sound, no motion. Delivered parcels hide 3 days after delivery.
(()=>{
let PKG=null;window.PKG=()=>PKG;
const LIVE=['out for delivery','arriving today','awaiting collection'];
const CHIP={'out for delivery':'Out for delivery','arriving today':'Arriving today','awaiting collection':'Ready to collect','delivered':'Delivered','in transit':'On its way'};
const ago=s=>{const h=(Date.now()-new Date(s))/36e5;return h<1?'just now':h<24?Math.round(h)+'h ago':Math.round(h/24)+'d ago'};
const visible=()=>(PKG?.packages||[]).filter(p=>p.status!=='delivered'||Date.now()-new Date(p.statusDate)<3*864e5);
window.pkgVisible=visible;window.pkgLive=()=>visible().filter(p=>LIVE.includes(p.status));
const hasGmail=()=>PEOPLE.some(p=>ACC?.people?.[p]?.google?.gmail);
async function pkgRefresh(){if(!PROXY.ok)return;if(ACC&&!hasGmail()){PKG={packages:[],errors:['Connect Gmail (read) in Settings → Accounts to see AusPost parcels.']};return}
 try{PKG=await api('/api/acct/packages')}catch(e){PKG={packages:PKG?.packages||[],errors:[e.message]}}
 if(view.tab==='Stage'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||''))render()}
window.pkgRefresh=pkgRefresh;
function pkgCard(){
 if(!PROXY.ok)return'';if(!PKG)return card('📦 Packages','<p class="mute">Checking email for parcels…</p>','wide pkgs');
 const v=visible(),err=(PKG.errors||[])[0];
 const rows=v.map(p=>`<li><span class="pchip s-${p.status.replace(/\s+/g,'-')}">${CHIP[p.status]||esc(p.status)}</span>
  <span class="pwho"><b>${esc(p.retailer||p.carrier)}</b> <small>${esc(p.carrier)} · ${esc(p.tracking)} · ${ago(p.statusDate)}</small><br><small class="psub">${esc(p.subject||'')}</small></span>
  <a class="ptrack" href="${esc(p.url)}" target="_blank" rel="noopener">Track</a></li>`).join('');
 return card('📦 Packages',`${rows?`<ul class="plist">${rows}</ul>`:'<p class="mute">No parcels on the way.</p>'}
  ${err?`<p class="ex">${esc(err)}</p>`:''}<p class="ex">From AusPost / StarTrack emails in the last 30 days · checked ${PKG.checkedAt?new Date(PKG.checkedAt).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):'—'}</p>`,'wide pkgs')}
window.pkgCard=pkgCard;
const _St=VIEWS.Stage;VIEWS.Stage=()=>pkgCard()+_St(); // brief.js (loaded after) puts the brief above this
(async()=>{try{await PROXY_READY}catch{}setTimeout(pkgRefresh,2500)})();setInterval(pkgRefresh,15*60e3);
})();
