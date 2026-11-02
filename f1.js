// fiaOS F1 schedule (server): GET /api/f1 -> 2026-season races from the Jolpica (Ergast) API, cached 12 h, times converted to UTC.
// Read-only, no keys. If the API is down, serves the last good copy (memory, then data/f1-cache.json).
const fs=require('fs'),path=require('path');
const CACHE_MS=12*36e5,FILE=path.join(__dirname,'data','f1-cache.json'),VER=2; // VER bumps invalidate old cache shapes
let mem=null;
const local=(d,t)=>{if(!d||!t)return null;const x=new Date(d+'T'+t);if(isNaN(x))return null;
 return{utc:x.toISOString(),local:new Date(x.getTime()+0).toISOString().replace('Z','+00:00').replace('.000',''),
  label:x.toLocaleString('en-AU',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}};
async function load(){
 const y=new Date().getFullYear();
 const r=await fetch(`https://api.jolpi.ca/ergast/f1/${y}.json?limit=100`,{headers:{'User-Agent':'fiaOS/0.2 (personal dashboard)'}});
 if(!r.ok)throw new Error('F1 API '+r.status);
 const races=(await r.json()).MRData.RaceTable.Races.map(x=>({round:+x.round,name:x.raceName,circuit:x.Circuit.circuitName,
  place:x.Circuit.Location.locality+', '+x.Circuit.Location.country,race:local(x.date,x.time),quali:local(x.Qualifying?.date,x.Qualifying?.time),
  sprint:local(x.Sprint?.date,x.Sprint?.time),fp1:local(x.FirstPractice?.date,x.FirstPractice?.time),raceDate:x.date,
  sessions:[['Practice 1',x.FirstPractice],['Practice 2',x.SecondPractice],['Practice 3',x.ThirdPractice],['Sprint Qualifying',x.SprintQualifying||x.SprintShootout],['Sprint',x.Sprint],['Qualifying',x.Qualifying],['Race',{date:x.date,time:x.time}]]
   .filter(([,v])=>v&&v.date).map(([n,v])=>({name:n,...(local(v.date,v.time)||{utc:null,local:null,label:'TBC'}),date:v.date})).sort((a,b)=>String(a.utc||a.date).localeCompare(String(b.utc||b.date)))}));
 return{ver:VER,season:y,source:'Jolpica/Ergast F1 API (api.jolpi.ca)',fetchedAt:new Date().toISOString(),races}}
async function data(){
 if(mem&&mem.ver===VER&&Date.now()-new Date(mem.fetchedAt)<CACHE_MS)return mem;
 try{mem=await load();try{fs.mkdirSync(path.dirname(FILE),{recursive:true});fs.writeFileSync(FILE,JSON.stringify(mem))}catch{}return mem}
 catch(e){if(!mem)try{mem=JSON.parse(fs.readFileSync(FILE,'utf8'))}catch{}if(mem)return{...mem,stale:true,error:e.message};throw e}}
async function handle(req,res,u,send){
 try{const d=await data(),now=Date.now();
  const next=d.races.find(r=>r.race?new Date(r.race.utc).getTime()+2*36e5>now:new Date(r.raceDate+'T23:59:59Z')>now)||null;
  const nextSession=next&&(next.sessions||[]).find(x=>x.utc&&new Date(x.utc).getTime()+(x.name==='Race'?2:1)*36e5>now)||null; // still 'next' while it's on
  return send(res,200,{...d,now:new Date().toISOString(),next,nextSession})}
 catch(e){return send(res,502,{error:e.message})}}
module.exports={handle};
