// fiaOS tiny server: serves the app + proxies ICS, Woolworths search, and xAI (key from env XAI_API_KEY). No dependencies.
const http=require('http'),fs=require('fs'),path=require('path'),PORT=+process.env.PORT||8080,KEY=process.env.XAI_API_KEY||'',HOST=process.env.HOST||'127.0.0.1';
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.md':'text/markdown','.json':'application/json','.webm':'video/webm'};
const send=(res,code,body,type='application/json')=>{res.writeHead(code,{'Content-Type':type,'Access-Control-Allow-Origin':'*','Cache-Control':'no-cache, no-store, must-revalidate'});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body))};
const okUrl=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)&&!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(x.hostname)}catch{return false}};
const body=req=>new Promise(r=>{let d='';req.on('data',c=>d+=c);req.on('end',()=>r(d))});
const OFFH={headers:{'User-Agent':'fiaOS/0.2 (personal dashboard)'}},F='code,product_name,brands,serving_size,serving_quantity,nutriments';
async function off(q,au){ // legacy full-text search; falls back to search-a-licious + per-product lookup when it is overloaded (503)
  try{const r=await fetch(`https://world.openfoodfacts.org/cgi/search.pl?json=1&page_size=8&fields=${F}&${au?'countries_tags_en=australia&':''}search_terms=${encodeURIComponent(q)}`,OFFH);if(r.ok)return{source:'search.pl',...await r.json()}}catch{}
  const h=await(await fetch(`https://search.openfoodfacts.org/search?page_size=8&fields=code&q=${encodeURIComponent(q+(au?' countries_tags:"en:australia"':''))}`,OFFH)).json();
  const products=(await Promise.all((h.hits||[]).map(x=>fetch(`https://world.openfoodfacts.org/api/v2/product/${x.code}.json?fields=${F}`,OFFH).then(r=>r.json()).then(j=>j.product&&{...j.product,code:x.code}).catch(()=>null)))).filter(Boolean);
  return{source:'search-a-licious',products}}
const integ=require('./integrations'),notion=require('./notion'),health=require('./health'),f1=require('./f1'),nlm=require('./notebooklm'),pods=require('./podcasts'),weekly=require('./weekly'),chores=require('./chores'),alerts=require('./alerts'),notes=require('./notes'),fianotes=require('./fianotes'),hub=require('./fiaos-core'),fiamail=require('./fiamail'),fialauncher=require('./fialauncher'),facet=require('./facet'),fiamedia=require('./fiamedia'),fialocal=require('./fialocal'),fiastudio=require('./fiastudio'),fiaoffice=require('./fiaoffice');
let wwCookie='';
async function woolies(q){
  if(!wwCookie){const h=await fetch('https://www.woolworths.com.au/',{headers:{'User-Agent':UA}});wwCookie=(h.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ')}
  const r=await fetch('https://www.woolworths.com.au/apis/ui/Search/products',{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/json',Accept:'application/json',Cookie:wwCookie,Origin:'https://www.woolworths.com.au',Referer:'https://www.woolworths.com.au/shop/search/products?searchTerm='+encodeURIComponent(q)},body:JSON.stringify({SearchTerm:q,PageSize:5,PageNumber:1,SortType:'TraderRelevance',Location:'/shop/search/products?searchTerm='+q,IsSpecial:false})});
  if(!r.ok){wwCookie='';return{ok:false,status:r.status,blocked:r.status===403}}
  const j=await r.json();const items=(j.Products||[]).flatMap(p=>p.Products||[]).slice(0,5).map(p=>({name:p.Name,size:p.PackageSize,price:p.Price,cupString:p.CupString,stockcode:p.Stockcode,url:`https://www.woolworths.com.au/shop/productdetails/${p.Stockcode}`}));
  return{ok:true,items}}
// xAI proxy: logs each call (no content), 120 s timeout, retries once with the default model if the browser asks for an unknown/retired one.
const DEF_MODEL=process.env.FIAOS_MODEL||'grok-4';
async function grokCall(j){let note='';
  const call=async()=>{const ac=new AbortController(),to=setTimeout(()=>ac.abort(),120e3);try{const r=await fetch('https://api.x.ai/v1/chat/completions',{method:'POST',signal:ac.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+KEY},body:JSON.stringify(j)});return{status:r.status,text:await r.text()}}finally{clearTimeout(to)}};
  let r=await call();
  if((r.status===400||r.status===404)&&/model/i.test(r.text)&&j.model!==DEF_MODEL){note=`model ${j.model} rejected, retried ${DEF_MODEL}; `;j.model=DEF_MODEL;r=await call()}
  return{...r,note}}
// server-side Grok for the Notion Inbox (no browser involved); returns the reply text
async function askGrok(messages){const t0=Date.now();let status=0;try{const r=await grokCall({model:process.env.FIAOS_INBOX_MODEL||DEF_MODEL,response_format:{type:'json_object'},messages});status=r.status;
  if(r.status>=400)throw new Error('Grok error '+r.status);return JSON.parse(r.text).choices[0].message.content}
  finally{console.log(`${new Date().toLocaleString('en-AU',{hour12:false})} grok inbox -> ${status} ${Date.now()-t0}ms`)}}
async function grok(req,res){const t0=Date.now(),ip=req.socket.remoteAddress||'?';let status=0,note='';
  try{if(!KEY){status=400;return send(res,400,{error:'XAI_API_KEY not set on server'})}
    let j;try{j=JSON.parse(await body(req))}catch{status=400;return send(res,400,{error:'bad JSON body'})}
    if(!j.model||!/^grok/i.test(j.model))j.model=DEF_MODEL;
    const r=await grokCall(j);note=r.note;
    status=r.status;if(r.status>=400)note+=r.text.slice(0,200).replace(/\s+/g,' ');
    return send(res,r.status,r.text)}
  catch(e){status=e.name==='AbortError'?504:502;note=e.message;return send(res,status,{error:e.name==='AbortError'?'Grok took longer than 2 minutes':e.message})}
  finally{console.log(`${new Date().toLocaleString('en-AU',{hour12:false})} grok ${ip} -> ${status} ${Date.now()-t0}ms ${note}`)}}
http.createServer(async(req,res)=>{const u=new URL(req.url,'http://x');try{
  if(u.pathname==='/api/wake'&&req.method==='POST'){ // night screen wake (Linux kiosk): brightnessctl via the fiaos-wake helper, localhost only
    if(!/^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress||''))return send(res,403,{error:'local only'});
    if(process.platform==='linux')require('child_process').execFile('/usr/local/bin/fiaos-brightness',['wake'],()=>{});return send(res,200,{ok:true})}
  if(u.pathname.startsWith('/api/acct/')||u.pathname.startsWith('/oauth/'))return integ.handle(req,res,u,send,body);
  if(u.pathname.startsWith('/api/notion/'))return notion.handle(req,res,u,body);
  if(u.pathname.startsWith('/api/health/'))return health.handle(req,res,u,body); // Apple Health via iOS Shortcuts (token in the URL)
  if(u.pathname.startsWith('/api/nlm/'))return nlm.handle(req,res,u,body); // NotebookLM source docs in Google Drive (drive.file)
  if(u.pathname==='/api/podcasts')return pods.handle(req,res,u,send); // MrBallen etc. for Bea (public RSS, cached 30 min, LAN only)
  if(u.pathname==='/api/weekly'||u.pathname.startsWith('/api/weekly/'))return weekly.handle(req,res,u,body); // weekly review (Sunday evening, saved to Notion)
  if(u.pathname==='/api/chores'||u.pathname.startsWith('/api/chores/')||u.pathname==='/api/todos'||u.pathname.startsWith('/api/todos/'))return chores.handle(req,res,u,body); // per-person chores + to-dos (local)
  if(u.pathname.startsWith('/api/fiahealth/'))return require('./fiahealth').handle(req,res,u); // Fia Health link (3 separate logins, own app on :3940)
  if(u.pathname==='/api/alerts')return alerts.handle(req,res,u); // BOM warnings + fire danger + QFD bushfires for Demo Harbour
  if(u.pathname==='/api/notes'||u.pathname.startsWith('/api/notes/'))return notes.handle(req,res,u,body); // family message board
  if(u.pathname==='/api/fianotes'||u.pathname.startsWith('/api/fianotes/'))return fianotes.handle(req,res,u,body); // FiaNotes / FiaDocs (local notes, docs, sheets, cards)
  if(u.pathname.startsWith('/api/hub/'))return hub.handle(req,res,u,body);
  if(u.pathname==='/api/mail'||u.pathname.startsWith('/api/mail/'))return fiamail.handle(req,res,u,body);
  if(u.pathname==='/api/launcher'||u.pathname.startsWith('/api/launcher/'))return fialauncher.handle(req,res,u,body);
  if(u.pathname==='/api/facet'||u.pathname.startsWith('/api/facet/'))return facet.handle(req,res,u,body);
  if(u.pathname==='/api/media'||u.pathname.startsWith('/api/media/'))return fiamedia.handle(req,res,u,body);
  if(u.pathname==='/api/local'||u.pathname.startsWith('/api/local/'))return fialocal.handle(req,res,u,body);
  if(u.pathname==='/api/studio'||u.pathname.startsWith('/api/studio/'))return fiastudio.handle(req,res,u,body);
  if(u.pathname==='/api/office'||u.pathname.startsWith('/api/office/'))return fiaoffice.handle(req,res,u,body);
  if(u.pathname==='/api/planner'||u.pathname.startsWith('/api/planner/'))return require('./planner').handle(req,res,u,body); // paper planner map + per-person planner ticks
  if(u.pathname==='/api/f1')return f1.handle(req,res,u,send); // F1 calendar for Cam (Jolpica API, cached 12 h)
  if(u.pathname==='/api/health')return send(res,200,{ok:true,xai:!!KEY,notion:!!process.env.NOTION_TOKEN,fianotes:true,house:true});
  if(u.pathname==='/api/ics'){const t=u.searchParams.get('url')?.replace(/^webcal:/,'https:');if(!okUrl(t))return send(res,400,{error:'bad url'});const r=await fetch(t,{headers:{'User-Agent':UA}});return send(res,r.status,await r.text(),'text/calendar')}
  if(u.pathname==='/api/off')return send(res,200,await off(u.searchParams.get('q')||'',u.searchParams.get('au')));
  if(u.pathname==='/api/woolies')return send(res,200,await woolies(u.searchParams.get('q')||''));
  if(u.pathname==='/api/grok'&&req.method==='POST')return grok(req,res);
  const rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname);if(/(^|\/)\.|^\/(data|backup|node_modules|linux|no-usb|test)(\/|$)/i.test(rel))return send(res,404,'not found','text/plain'); // never serve .env, data/ (tokens), etc.
  let f=path.join(__dirname,rel);if(!f.startsWith(__dirname)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return send(res,404,'not found','text/plain');
  send(res,200,fs.readFileSync(f),MIME[path.extname(f)]||'application/octet-stream')}catch(e){send(res,502,{error:e.message})}
}).listen(PORT,HOST,()=>{console.log(`fiaOS on http://localhost:${PORT}  (xAI key from env: ${KEY?'yes':'no'})`);notion.startInbox({grok:KEY?askGrok:null});nlm.start();pods.start();weekly.start({grok:KEY?askGrok:null,port:PORT});chores.start();fianotes.start({grok:KEY?askGrok:null});fiamail.start();fialauncher.start();facet.start();fiamedia.start();fialocal.start();fiastudio.start();fiaoffice.start();
  hub.register('tasks',terms=>{try{const v=chores.view();return (v.items||[]).filter(i=>hub.match(terms,i.name+' '+(i.person||''))).slice(0,8).map(i=>({kind:'task',id:i.id,title:i.name,snippet:(i.person||'')+' · '+(i.day||''),tab:'Habits & Chores',score:2}))}catch{return []}})});
