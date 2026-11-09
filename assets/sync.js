/* Nederlands sync: same system as the Studiehub (personal sync code, Supabase get_progress/save_progress).
   Offline-first: localStorage is the source; online copies are merged, never blindly overwritten.
   Dutch progress lives in its own row (<code>-nl), so it never mixes with Studiehub progress even with the same code. */
(function(){
'use strict';
const CFG=window.SYNC_CONFIG||{};
const ENABLED=!!(CFG.url&&CFG.key);
const LS=localStorage;
const CODEKEY='nl-sync:code',LASTKEY='nl-sync:last',ERRKEY='nl-sync:err',STATEKEY='nl:state',HUBKEY='studie-sync:code';
const get=k=>{try{return LS.getItem(k)}catch(e){return null}},set=(k,v)=>{try{v==null?LS.removeItem(k):LS.setItem(k,v)}catch(e){}};
const num=x=>typeof x==='number'&&isFinite(x)?x:0;
const row=c=>c+'-nl';

/* ---- merge: every keyed entry carries ts; newest wins. days: max minutes. ---- */
function mergeMap(a,b){const o=Object.assign({},a||{});Object.entries(b||{}).forEach(([k,v])=>{const w=o[k];if(!w||num(v&&v.ts)>num(w&&w.ts))o[k]=v});return o}
function mergeMax(a,b){const o=Object.assign({},a||{});Object.entries(b||{}).forEach(([k,v])=>{o[k]=Math.max(num(o[k]),num(v))});return o}
function mergeState(a,b){if(!a)return b;if(!b)return a;
  const o=Object.assign({},num(a.ts)>=num(b.ts)?b:a,num(a.ts)>=num(b.ts)?a:b);
  ['mods','srs','errs','writing'].forEach(k=>{o[k]=mergeMap(a[k],b[k])});
  o.days=mergeMax(a.days,b.days);o.ts=Math.max(num(a.ts),num(b.ts));return o}

/* ---- server ---- */
function hdr(){const h={'Content-Type':'application/json',apikey:CFG.key};if(!/^sb_/.test(CFG.key))h.Authorization='Bearer '+CFG.key;return h}
async function rpc(fn,body,keepalive){const r=await fetch(CFG.url.replace(/\/$/,'')+'/rest/v1/rpc/'+fn,{method:'POST',headers:hdr(),body:JSON.stringify(body),keepalive:!!keepalive});
  if(!r.ok)throw new Error('HTTP '+r.status);const t=await r.text();return t?JSON.parse(t):null}
const canon=x=>JSON.stringify(x,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort().reduce((o,kk)=>(o[kk]=v[kk],o),{}):v);

let busy=null,again=false,timer=null;
const listeners=[];const emit=()=>listeners.forEach(f=>{try{f(status())}catch(e){}});
const readLocal=()=>{try{return JSON.parse(get(STATEKEY))}catch(e){return null}};
async function syncNow(){const code=get(CODEKEY);if(!ENABLED||!code)return false;
  if(busy){again=true;return busy}
  busy=(async()=>{try{
    const remote=await rpc('get_progress',{p_code:row(code)});const local=readLocal();
    const merged=mergeState(local,remote&&remote.nl);
    if(merged&&canon(local)!==canon(merged)){set(STATEKEY,JSON.stringify(merged));if(typeof window.__nlReload==='function')window.__nlReload()}
    if(merged&&canon(remote&&remote.nl)!==canon(merged))await rpc('save_progress',{p_code:row(code),p_data:{v:1,nl:merged}});
    set(LASTKEY,String(Date.now()));set(ERRKEY,null);return true}
  catch(e){set(ERRKEY,String(e&&e.message||e));return false}
  finally{busy=null;emit();if(again){again=false;setTimeout(syncNow,500)}}})();
  return busy}
function changed(){if(!ENABLED||!get(CODEKEY))return;clearTimeout(timer);timer=setTimeout(syncNow,4000)}
function status(){return{enabled:ENABLED,code:get(CODEKEY),hub:get(HUBKEY),last:+get(LASTKEY)||null,error:get(ERRKEY),busy:!!busy}}
const WORDS=['tulp','molen','fiets','gracht','kaas','stroopwafel','klomp','dijk','haring','duin','polder','zeil','reiger','eend','koe','brug'];
function newCode(){const r=n=>{const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]%n};return WORDS[r(WORDS.length)]+'-'+String(1000+r(9000))+'-'+WORDS[r(WORDS.length)]+'-'+String(10+r(90))}
const clean=c=>String(c||'').trim().toLowerCase().replace(/\s+/g,'-');
const valid=c=>/^[a-z0-9-]{8,36}$/.test(c);
/* mode: 'new' (code must be unused for Dutch), 'join' (Dutch progress must exist), 'any' (use it either way, e.g. your Studiehub code) */
async function setCode(c,mode){c=clean(c);
  if(!valid(c))throw new Error('A code needs at least 8 characters: letters, digits and dashes only.');
  let ex;try{ex=await rpc('get_progress',{p_code:row(c)})}catch(e){throw new Error('Can\'t reach the sync server. Are you online? Try again in a moment.')}
  if(mode==='new'&&ex!=null)throw new Error('This code is already in use. If it\'s yours, use “I already have a code”.');
  if(mode==='join'&&ex==null)throw new Error('No Dutch progress found for this code yet. Check the spelling, or start fresh with it.');
  set(CODEKEY,c);set(ERRKEY,null);emit();return syncNow()}
function forget(){set(CODEKEY,null);set(LASTKEY,null);set(ERRKEY,null);emit()}

window.NLSync={enabled:ENABLED,status,syncNow,changed,setCode,newCode,forget,onChange:f=>listeners.push(f),_merge:mergeState};
if(ENABLED&&get(CODEKEY)){
  window.addEventListener('load',()=>syncNow());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')syncNow();else syncNow()});
  window.addEventListener('online',()=>syncNow());
}
})();
