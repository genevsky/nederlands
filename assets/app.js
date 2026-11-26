/* Nederlands A2 → B2 — learning app.
   Routes: #/ home · #/m/m01 module · #/review daily review · #/words word bank · #/progress · #/sync
   State (localStorage 'nl:state', synced by sync.js):
     mods[id]   {ts, step, done, ms, sc:{words:[ok,n],read,listen,dict,gram}}
     srs[nl]    {ts, nl, en, ex, cz, au, b(box), due(day), n, w, mod}
     errs[id]   {ts, it(item snapshot), sk(skill), mod, n(times wrong), ok(correct streak), due, res(resolved), cb(check-back stage 1–2, 3 = done)}
     gram[id]   {ts, b(box), due, n, w(times wrong), seen[item ids, latest last], miss{item id: times wrong}}  grammar topic of a finished session
     writing[id]{ts, task, text, words}
     days[day]  seconds practised */
(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const DAYMS=864e5,today=()=>Math.floor((Date.now()-new Date().getTimezoneOffset()*6e4)/DAYMS);
const dayDate=d=>new Date(d*DAYMS);
const VER=window.NL_VER||'1';
const view=$('#view');
const C=window.CURRICULUM,CO=window.COURSE;
const READY=new Set(window.NL_READY||[]);
const mid=n=>'m'+String(n).padStart(2,'0');
/* every session (module mNN or lesson lNN) gets an id and a slot = its position in the plan (dates follow the slot) */
C.forEach((c,i)=>{c.slot=i+1;c.id=c.id||mid(c.n)});
const lab=c=>c.les?'L'+c.les:String(c.n),nameOf=c=>c.les?'Les '+c.les:'Module '+c.n;
/* writing-feedback codes (feedback.text marks mistakes as [[fragment|CODE]]) */
const CODES={WO:'Word order: check where the verbs go',VERB:'Verb form: check the subject (ik/hij/we…) and the other verbs',TENSE:'Tense: present, past, perfect?',SP:'Spelling',ART:'Article: de, het, een, or none',ADJ:'Adjective: -e or no -e',PREP:'Preposition: use a different one (or none)',PRON:'Pronoun (hij/hem, je/jouw/uw, die/dat…)',WORD:"Word choice: this word doesn't fit here",MISS:'A word is missing here',PL:'Plural form of the noun',PUNCT:'Punctuation or capital letter','?':'Unclear: say it another way'};
const SKILL={words:'Vocabulary',read:'Reading',listen:'Listening',dict:'Dictation',gram:'Grammar',write:'Writing',speak:'Speaking'};

/* ---------- markdown-lite: **b** *i* ==highlight== {word|gloss} tables (| a | b |) ---------- */
function inline(s){return esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\*([^*]+?)\*/g,'<i>$1</i>').replace(/==(.+?)==/g,'<mark>$1</mark>')
  .replace(/\{([^{}|]+)\|([^{}]+)\}/g,(m,w,g)=>`<button class="gl" type="button" data-g="${g.replace(/"/g,'&quot;')}">${w}</button>`)}
function md(s){if(!s)return '';const out=[];String(s).split(/\n{2,}/).forEach(b=>{const L=b.split('\n');
  if(L.every(l=>/^\|/.test(l.trim()))){const rows=L.filter(l=>!/^\|\s*-/.test(l.trim())).map(l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim()));
    out.push('<div class="tw"><table>'+rows.map((r,i)=>'<tr>'+r.map(c=>i?`<td>${inline(c)}</td>`:`<th>${inline(c)}</th>`).join('')+'</tr>').join('')+'</table></div>')}
  else if(L.every(l=>/^- /.test(l)))out.push('<ul>'+L.map(l=>'<li>'+inline(l.slice(2))+'</li>').join('')+'</ul>');
  else out.push('<p>'+L.map(inline).join('<br>')+'</p>')});return out.join('')}

/* ---------- state ---------- */
const KEY='nl:state';
const load=()=>{let s;try{s=JSON.parse(localStorage.getItem(KEY))}catch(e){}return Object.assign({v:1,mods:{},srs:{},errs:{},writing:{},days:{},gram:{}},s||{})};
let S=load();
/* cards from Les 1 had the plural in the prompt, which gives the answer away: move the forms to 'say' (shown after answering) */
Object.values(S.srs).forEach(w=>{const m=/^(.*?)\s*·\s*plural:\s*(.+)$/.exec(w.en||'');if(!m)return;const v=/past of (\S+)/.exec(m[1]);w.en=m[1];if(!w.say&&v)w.say=v[1]+', '+w.nl+', '+m[2]});
function save(){S.ts=Date.now();try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}if(window.NLSync)NLSync.changed()}
window.__nlReload=()=>{S=load();if(!busyItem)route()};
let busyItem=false;

/* practice timer: counts visible seconds on module/review screens */
let ticking=false;setInterval(()=>{if(ticking&&document.visibilityState==='visible'){const d=today();S.days[d]=(S.days[d]||0)+5;if(curMod){const m=S.mods[curMod];if(m)m.ms=(m.ms||0)+5000}if(Math.random()<.2)save()}},5000);

/* ---------- answer checking ---------- */
const nrm=s=>String(s||'').normalize('NFC').toLowerCase().replace(/[’‘ʼ`´]/g,"'").replace(/[.,!?;:"“”„()¿¡…]/g,' ').replace(/\s+/g,' ').trim();
const deacc=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'');
const lev=(a,b)=>{const m=a.length,n=b.length;let p=[...Array(n+1).keys()];for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c}return p[n]};
const ART=/^(de|het|een) /;
/* returns {ok, note}: ok=true correct (note = small warning), ok=false wrong (note = why) */
function judge(input,answers,opts){opts=opts||{};const u=nrm(input);if(!u)return{ok:false,note:''};
  for(const a of answers){const A=nrm(a);if(u===A)return{ok:true}}
  for(const a of answers){const A=nrm(a);if(deacc(u)===deacc(A))return{ok:true,note:'Watch the accents: **'+a+'**'}}
  if(opts.article){for(const a of answers){const A=nrm(a);if(ART.test(A)){const bare=A.replace(ART,'');
    if(u===bare)return{ok:false,note:'Right word, but learn it with its article: **'+a+'**'};
    if(ART.test(u)&&u.replace(ART,'')===bare)return{ok:false,note:'Wrong article: it\'s **'+a+'**'}}}}
  for(const a of answers){const A=nrm(a);const tol=A.length>=12?2:A.length>=5?1:0;if(tol&&lev(u,A)<=tol&&!(opts.article&&ART.test(A)&&!ART.test(u)))return{ok:true,typo:true,note:'Small typo, spelled: **'+a+'**'}}
  return{ok:false,note:''}}

/* ---------- audio ---------- */
let AUD=null;
function stopAudio(){if(AUD){const a=AUD;AUD=null;try{a.pause()}catch(e){}if(a._end)a._end()}$$('.playing').forEach(e=>e.classList.remove('playing'))}
function play(src,rate,btn){return new Promise(res=>{stopAudio();if(!src){res();return}const a=new Audio(src+(src.includes('?')?'&':'?')+'v='+VER);AUD=a;a.playbackRate=rate||1;if(btn)btn.classList.add('playing');
  let fin=false;const end=()=>{if(fin)return;fin=true;if(btn)btn.classList.remove('playing');if(AUD===a)AUD=null;res()};a._end=end;a.onended=end;a.onerror=end;a.play().catch(end)})}
/* play a list of clips in order; tapping the button again stops */
let seqId=0;
async function playSeq(list,btn,gap){if(btn&&btn.classList.contains('playing')){seqId++;stopAudio();return}const my=++seqId;
  for(const s of list||[]){if(my!==seqId)break;await play(s,rate(),btn);if(btn&&my===seqId)btn.classList.add('playing');if(gap)await new Promise(r=>setTimeout(r,gap))}
  if(my===seqId&&btn)btn.classList.remove('playing')}
let slow=false;
const speedBtn=()=>`<button class="chip speed${slow?' on':''}" type="button" data-speed>🐢 ${slow?'Slow on':'Slow'}</button>`;
function bindSpeed(root){$$('[data-speed]',root).forEach(b=>b.onclick=()=>{slow=!slow;$$('[data-speed]').forEach(x=>{x.classList.toggle('on',slow);x.textContent='🐢 '+(slow?'Slow on':'Slow')})})}
const rate=()=>slow?.75:1;
const icoPlay='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

/* ---------- item runner ----------
   items: [{t:'mc'|'tf'|'type'|'order'|'dict'|'card', id, q, ...}]
   opts: {retry:true (wrong items come back once at the end), sk, mod, ctx, onDone(score)} */
function runItems(root,items,opts){
  const queue=items.map(it=>({it,first:true}));let ok=0,n=0,i=0;const total=items.length;
  const bar=()=>`<div class="ibar"><i style="width:${Math.round(100*Math.min(i,total)/total)}%"></i></div>`;
  function next(){busyItem=false;if(!queue.length){opts.onDone&&opts.onDone([ok,n]);return}
    const q=queue.shift();render(q)}
  function finish(q,res){busyItem=false;
    const it=q.it;if(q.first){n++;if(res.ok&&!res.typo)ok++;else if(res.ok&&res.typo)ok+=.5;logResult(it,res.ok&&!res.typo,opts)}
    if(!res.ok&&opts.retry&&q.first)queue.push({it,first:false});
    if(q.first)i++}
  function render(q){const it=q.it;busyItem=true;stopAudio();window.__curItem=it;
    const ctx=it.ctx?`<blockquote class="ctx">${md(it.ctx)}</blockquote>`:'';
    const lines=it.au&&it.au.length?`<div class="row"><button class="btn sm ghost" type="button" data-pl>${icoPlay} Listen</button>${speedBtn()}</div>`:'';
    root.innerHTML=bar()+`<div class="item">${q.first?'':'<p class="again">Try this one again</p>'}${it.kind?`<p class="kind">${esc(it.kind)}</p>`:''}${ctx}${lines}<div class="q">${md(it.q||'')}</div><div class="ans"></div><div class="fb" aria-live="polite"></div></div>`;
    bindSpeed(root);const pl=$('[data-pl]',root);if(pl){pl.onclick=()=>playSeq(it.au,pl);if(it.t==='dict')setTimeout(()=>pl.click(),250)}
    const A=$('.ans',root),F=$('.fb',root);let answered=false;
    const done=(res,shown)=>{if(answered)return;answered=true;finish(q,res);
      F.innerHTML=`<div class="fbx ${res.ok?(res.typo||res.note?'mid':'good'):'bad'}"><b>${res.ok?(res.typo?'Almost!':'Goed zo!'):'Niet helemaal.'}</b>${res.note?' '+md(res.note).replace(/^<p>|<\/p>$/g,''):''}${shown?'<div class="sol">'+shown+'</div>':''}${it.x?'<div class="x">'+md(it.x)+'</div>':''}</div>`;
      setAct('Continue',next,true);$$('input,textarea,button.opt,button.tok',A).forEach(e=>{e.disabled=true})};
    if(it.t==='mc'||it.t==='tf'){const o=it.t==='tf'?['Waar (true)','Niet waar (false)']:it.o;const ord=it.t==='tf'?[0,1]:(it.keep?o.map((_,k)=>k):shuffle(o.map((_,k)=>k)));const correct=it.t==='tf'?(it.a?0:1):it.a;
      A.innerHTML='<div class="opts">'+ord.map(k=>`<button class="opt" type="button" data-k="${k}">${md(o[k]).replace(/^<p>|<\/p>$/g,'')}</button>`).join('')+'</div>';
      $$('.opt',A).forEach(b=>b.onclick=()=>{if(answered)return;const k=+b.dataset.k,good=k===correct;b.classList.add(good?'good':'bad');$$('.opt',A).find(x=>+x.dataset.k===correct).classList.add('good');done({ok:good})});setAct(null)}
    else if(it.t==='type'||it.t==='dict'){const big=it.t==='dict'||(it.a[0]||'').length>28;
      A.innerHTML=(big?`<textarea rows="2" class="inp" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${it.t==='dict'?'Type what you hear…':'Type your answer…'}"></textarea>`:`<input class="inp" type="text" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${esc(it.ph||'Type your answer…')}">`)+
        `<div class="acc">${['é','ë','è','ï','ö','ü'].map(c=>`<button type="button" class="chip" data-c="${c}">${c}</button>`).join('')}${it.hint?`<button type="button" class="chip" data-h>💡 Hint</button>`:''}</div>`;
      const inp=$('.inp',A);$$('[data-c]',A).forEach(b=>b.onclick=()=>{const p=inp.selectionStart||inp.value.length;inp.value=inp.value.slice(0,p)+b.dataset.c+inp.value.slice(inp.selectionEnd||p);inp.focus();inp.setSelectionRange(p+1,p+1)});
      const hb=$('[data-h]',A);if(hb)hb.onclick=()=>{hb.outerHTML=`<span class="hint">${esc(it.hint)}</span>`};
      const check=()=>{if(answered)return;if(!inp.value.trim()){inp.focus();return}
        if(it.t==='dict'){const r=diffWords(inp.value,it.a[0]);done({ok:r.ok,typo:r.ok&&r.minor,note:r.ok?(r.minor?'Tiny slips only.':''):''},r.html);return}
        const r=judge(inp.value,it.a,{article:!!it.art});done(r,r.ok&&!r.note?'':'<b>'+esc(it.a[0])+'</b>')};
      inp.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();answered?next():check()}});
      setAct('Check',check);if(matchMedia('(pointer:fine)').matches)setTimeout(()=>inp.focus(),50)}
    else if(it.t==='order'){const target=it.a[0];const toks=target.replace(/[.?!]$/,'').split(' ');if(!it.keepCap)toks[0]=toks[0].toLowerCase();const end=(target.match(/[.?!]$/)||[''])[0];
      let pool=shuffle(toks.map((w,k)=>({w,k})));if(pool.map(p=>p.w).join(' ')===toks.join(' '))pool=pool.reverse();const built=[];
      const draw=()=>{A.innerHTML=`<div class="built">${built.length?built.map((p,j)=>`<button type="button" class="tok in" data-j="${j}">${esc(p.w)}</button>`).join(''):'<span class="mut small">Tap the words in the right order</span>'}<span class="end">${end}</span></div><div class="pool">${pool.map((p,j)=>`<button type="button" class="tok" data-p="${j}">${esc(p.w)}</button>`).join('')}</div>`;
        $$('[data-p]',A).forEach(b=>b.onclick=()=>{if(answered)return;built.push(pool.splice(+b.dataset.p,1)[0]);draw()});
        $$('[data-j]',A).forEach(b=>b.onclick=()=>{if(answered)return;pool.push(built.splice(+b.dataset.j,1)[0]);draw()})};draw();
      setAct('Check',()=>{if(answered)return;if(pool.length){return}const s=built.map(p=>p.w).join(' ');const good=it.a.some(a=>nrm(a)===nrm(s));done({ok:good},good?'':'<b>'+esc(target)+'</b>')})}
    else if(it.t==='card'){A.innerHTML='';setAct('Continue',()=>{answered=true;next()},true)}
  }
  next()}

/* word-level diff for dictation */
function diffWords(input,target){const a=nrm(input).split(' ').filter(Boolean),b=nrm(target).split(' ').filter(Boolean);
  const m=a.length,n=b.length,D=[...Array(m+1)].map(()=>Array(n+1).fill(0));for(let i=0;i<=m;i++)D[i][0]=i;for(let j=0;j<=n;j++)D[0][j]=j;
  const cost=(x,y)=>x===y?0:deacc(x)===deacc(y)||(y.length>4&&lev(x,y)===1)?.4:1;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)D[i][j]=Math.min(D[i-1][j]+1,D[i][j-1]+1,D[i-1][j-1]+cost(a[i-1],b[j-1]));
  let i=m,j=n;const ops=[];while(i||j){if(i&&j&&D[i][j]===D[i-1][j-1]+cost(a[i-1],b[j-1])){ops.unshift([cost(a[i-1],b[j-1])===0?'=':'~',a[i-1],b[j-1]]);i--;j--}else if(j&&D[i][j]===D[i][j-1]+1){ops.unshift(['-',null,b[j-1]]);j--}else{ops.unshift(['+',a[i-1],null]);i--}}
  const bad=ops.filter(o=>o[0]==='-'||o[0]==='+').length,minor=ops.filter(o=>o[0]==='~').length;
  const html='<div class="diff">'+ops.map(o=>o[0]==='='?`<span>${esc(o[1])}</span>`:o[0]==='~'?`<span class="dm" title="you: ${esc(o[1])}">${esc(o[2])}</span>`:o[0]==='-'?`<span class="dmiss">${esc(o[2])}</span>`:`<s>${esc(o[1])}</s>`).join(' ')+'</div><p class="small mut">Correct: <b>'+esc(target)+'</b></p>';
  return{ok:bad===0&&minor<=1,minor:minor>0,html:bad||minor?html:''}}

/* ---------- logging: error bank + SRS ---------- */
function snapshot(it){const o={};['t','q','o','a','x','ctx','au','art','hint','kind','keep','keepCap'].forEach(k=>{if(it[k]!=null)o[k]=it[k]});if(it.lau&&it.lau.length)o.au=it.lau;return o}
function logResult(it,ok,opts){if(!it.id)return;const d=today();
  if(opts.review){/* daily review handles its own bookkeeping */opts.review(it,ok);return}
  if(!ok){const e=S.errs[it.id]||{n:0};S.errs[it.id]={ts:Date.now(),it:snapshot(it),sk:opts.sk||it.sk,mod:opts.mod||it.mod,n:(e.n||0)+1,ok:0,due:d+1,res:false}}
  if(it.word){const w=S.srs[it.word.nl];if(w){w.ts=Date.now();if(!ok){w.w=(w.w||0)+1;w.b=1;w.due=d+1}}}
  save()}
const IV=[0,1,3,7,14,30,60,120];
/* intervals vary by about ±15%, so cards learned on the same day don't keep coming back together;
   cards and topics you got wrong 2+ times come back sooner (×0.7, from 3 times ×0.5) */
const jit=n=>n<=1?n:Math.max(1,Math.round(n*(0.85+Math.random()*0.3)));
const nextIv=(b,w)=>jit(Math.max(1,Math.round(IV[b]*((w||0)>=3?.5:(w||0)>=2?.7:1))));
const dayOf=ts=>Math.floor((ts-new Date(ts).getTimezoneOffset()*6e4)/DAYMS);
const glo=w=>{const f=w.form||(window.NL_WF||{})[w.nl];return '*('+w.en+(f&&f!=='-'?', '+f:'')+')*'};
const pastForms=w=>{const F=(w.say||'').split(', ');return /^past of /.test(w.en||'')&&F.length===3?F:null};
function pastItem(w,pl,base){const F=pastForms(w),gl=w.en.replace(/^past of \S+\s*/,'');
  return Object.assign({t:'type',kind:'Past tense · '+(pl?'plural':'singular'),q:'Past of **'+F[0]+'**, '+(pl?'plural: **wij / jullie / zij** _____':'singular: **ik / jij / hij / zij** _____')+'\n\n*'+gl+'*',a:[pl?F[2]:F[1]],x:xOf(w)},base)}
const xOf=w=>(w.ex||'')+(w.say&&w.say!==w.nl?'\n\n**'+w.say.replace(/, /g,' – ')+'**':'');
function addWords(modId,words){const d=today();words.forEach(w=>{if(!S.srs[w.nl])S.srs[w.nl]={ts:Date.now(),nl:w.nl,en:w.en,ex:w.ex,cz:w.cz,au:w.au,kind:w.kind,say:w.say,form:w.form,b:1,due:d+1,n:0,w:0,mod:modId}});save()}

/* review deck: open errors due + words due */
const isCheck=e=>e.res&&(e.cb===1||e.cb===2);
function dueErrs(){const d=today();return Object.entries(S.errs).filter(([k,e])=>(!e.res||isCheck(e))&&e.due<=d).map(([k,e])=>varyDict(Object.assign({},e.it,(window.NL_Q||{})[k]||{},{id:k,_err:1,_n:e.n||1,kind:(isCheck(e)?'Check-back: an old mistake · ':'From your mistakes · ')+(SKILL[e.sk]||'')}),e))}
/* most-missed first, then mixed up */
const pickErrs=(L,n)=>shuffle(shuffle(L).sort((a,b)=>b._n-a._n).slice(0,n));
(function(){const d=today();let ch=0;Object.values(S.errs).forEach(e=>{if(e.res&&e.cb==null){e.cb=1;e.due=Math.max(dayOf(e.ts||Date.now())+jit(14),d+1+Math.floor(Math.random()*7));ch=1}});if(ch)save()})();
/* grammar review deck: the grammar of every finished session comes back on the same spaced schedule as words,
   each time with a different question from that topic (preferring ones you got wrong before).
   A topic starts as 'hard' (shorter intervals) for each grammar mistake from it that is still open or was made 2+ times. */
function addGram(){const d=today(),P=window.NL_GP||{};
  const fresh=Object.keys(P).filter(id=>!S.gram[id]&&(S.mods[id]||{}).done).map(id=>({id,w:Object.values(S.errs).filter(e=>e.mod===id&&e.sk==='gram'&&(!e.res||e.n>=2)).length}));
  fresh.sort((a,b)=>b.w-a.w).forEach((t,k)=>{S.gram[t.id]={ts:Date.now(),b:1,due:d+1+k,n:0,w:Math.min(t.w,3),seen:[],miss:{}}});if(fresh.length)save()}
function gramItem(id){const g=S.gram[id],P=(window.NL_GP||{})[id],Q=window.NL_Q||{};if(!P)return null;
  const ids=P.ids.filter(x=>Q[x]);if(!ids.length)return null;
  const recent=new Set((g.seen||[]).slice(-Math.min(8,Math.floor(ids.length/2))));
  const c=ids.filter(x=>!recent.has(x)),pool=c.length?c:ids;
  const wt=x=>1+2*((g.miss||{})[x]||0)+((S.errs[x]||{}).n||0);let r=Math.random()*pool.reduce((a,x)=>a+wt(x),0),pick=pool[0];
  for(const x of pool){r-=wt(x);if(r<=0){pick=x;break}}
  return Object.assign({},Q[pick],{id:'gr:'+pick,_gram:id,_gid:pick,kind:'Grammar review · '+P.t})}
function dueGram(){addGram();const d=today();return Object.entries(S.gram).filter(([k,g])=>g.due<=d).sort((a,b)=>a[1].due-b[1].due||b[1].w-a[1].w).map(([k])=>gramItem(k)).filter(Boolean)}
/* a dictation mistake comes back as a different sentence from the same module (preferring ones that share words with
   the original), so you practise the sounds and spellings, not one memorised sentence; it never repeats the last one served */
function varyDict(it,e){const P=(window.NL_POOL||{})[e.mod||it.id.split('.')[0]];if(it.t!=='dict'||!P||!P.length)return it;
  const orig=it.a[0],words=t=>t.toLowerCase().replace(/[^a-zà-ÿ' ]/g,' ').split(/\s+/).filter(w=>w.length>2),ow=new Set(words(orig));
  const c=shuffle(P.filter(([t])=>t!==orig&&t!==e.last)).map(([t,au])=>({t,au,sc:words(t).filter(w=>ow.has(w)).length})).sort((a,b)=>b.sc-a.sc).slice(0,4);
  if(e.last&&e.last!==orig)c.push({t:orig,au:(it.au||[])[0]});const pick=c[Math.floor(Math.random()*c.length)];
  if(!pick||!pick.au)return it;return Object.assign(it,{a:[pick.t],au:[pick.au],_var:pick.t,kind:it.kind+' · new sentence, same sounds'})}
/* a preposition card blanks the whole word only (not 'op' inside 'opgeven') */
const gapWord=(ex,cz)=>ex.replace(new RegExp('(^|[^A-Za-zÀ-ÿ])'+cz.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-zÀ-ÿ])'),'$1_____');
function wordItem(w){const b=w.b||1;const ex=w.ex||'';const cz=w.cz&&ex.includes(w.cz)?w.cz:null;
  /* past-tense cards (Les 1, 3…) always say singular or plural, and alternate between them from one review to the next */
  if(pastForms(w))return pastItem(w,(w.n||0)%2===1,{id:'w:'+w.nl,_word:w.nl});
  if(w.kind==='prep'&&cz)return{t:'type',id:'w:'+w.nl,_word:w.nl,kind:'Preposition · '+(b<=1?'new':'box '+b),q:'**'+gapWord(ex,cz)+'**\n\n*('+w.en+')*',a:[cz],x:xOf(w)};
  if(b>=3&&cz)return{t:'type',id:'w:'+w.nl,_word:w.nl,kind:'Word · in context',q:'**'+ex.replace(cz,'_____')+'**\n\n'+glo(w),a:[cz],x:xOf(w)};
  if(b>=5&&w.au)return{t:'type',id:'w:'+w.nl,_word:w.nl,kind:'Word · listen and write',q:'Write the word you hear (with article if it has one).',au:[w.au],a:[w.nl],art:true};
  return{t:'type',id:'w:'+w.nl,_word:w.nl,kind:'Word · '+(b<=1?'new':'box '+b),q:'In Dutch: **'+w.en+'**',a:[w.nl],art:true,x:xOf(w)}}
function dueWords(){const d=today();return Object.values(S.srs).filter(w=>w.due<=d).sort((a,b)=>a.due-b.due||a.b-b.b).map(wordItem)}
function reviewHook(it,ok){const d=today();
  if(it._word){const w=S.srs[it._word];if(w){w.ts=Date.now();w.n=(w.n||0)+1;if(ok){w.b=Math.min(7,(w.b||1)+1);w.due=d+nextIv(w.b,w.w)}else{w.w=(w.w||0)+1;w.b=1;w.due=d+1}}}
  if(it._err){const e=S.errs[it.id];if(e){e.ts=Date.now();if(it.t==='dict')e.last=it._var||it.a[0];
    if(isCheck(e)){if(ok){if(e.cb===1){e.cb=2;e.due=d+jit(28)}else e.cb=3}else{e.res=false;e.cb=0;e.ok=0;e.n=(e.n||0)+1;e.due=d+1}}
    else if(ok){e.ok=(e.ok||0)+1;if(e.ok>=2){e.res=true;e.cb=1;e.due=d+jit(14)}else e.due=d+jit(3)}else{e.ok=0;e.n=(e.n||0)+1;e.due=d+1}}}
  if(it._gram){const g=S.gram[it._gram];if(g){g.ts=Date.now();g.n=(g.n||0)+1;g.seen=(g.seen||[]).concat(it._gid).slice(-12);
    if(ok){g.b=Math.min(7,(g.b||1)+1);g.due=d+nextIv(g.b,g.w)}else{g.w=(g.w||0)+1;g.b=1;g.due=d+1;g.miss=g.miss||{};g.miss[it._gid]=(g.miss[it._gid]||0)+1}}}
  save()}

/* ---------- action bar ---------- */
const act=$('#act');let actFn=null;
function setAct(label,fn,primary){if(!label){act.hidden=true;actFn=null;return}act.hidden=false;const b=$('button',act);b.textContent=label;b.className='btn wide'+(primary?' go':'');actFn=fn}
$('button',act).onclick=()=>actFn&&actFn();
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!act.hidden&&actFn&&!(e.target.matches&&e.target.matches('input,textarea,button')))actFn()});

/* ---------- helpers ---------- */
const DAY=['zo','ma','di','wo','do','vr','za'],MND=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
function planDate(n){const [y,m,d]=CO.start.split('-').map(Number);const s=new Date(y,m-1,d);const wk=Math.floor((n-1)/2),slot=(n-1)%2;const dt=new Date(s);dt.setDate(s.getDate()+wk*7+(CO.days[slot]-CO.days[0]));return dt}
const fmt=dt=>DAY[dt.getDay()]+' '+dt.getDate()+' '+MND[dt.getMonth()];
const pct=s=>s&&s[1]?Math.round(100*s[0]/s[1]):null;
function modScore(m){if(!m||!m.sc)return null;const v=Object.values(m.sc).filter(s=>s&&s[1]);if(!v.length)return null;return Math.round(100*v.reduce((a,s)=>a+s[0],0)/v.reduce((a,s)=>a+s[1],0))}
function streak(){let d=today(),n=0;if(!S.days[d])d--;while((S.days[d]||0)>=60){n++;d--}return n}
const mins=s=>Math.round((s||0)/60);
function weekMins(){const d=today(),dow=(new Date().getDay()+6)%7;let t=0;for(let k=0;k<=dow;k++)t+=S.days[d-k]||0;return mins(t)}
function nextModule(){return C.find(c=>READY.has(c.id)&&!(S.mods[c.id]||{}).done)}
function setNav(r){$$('nav.tabs a').forEach(a=>a.setAttribute('aria-current',a.dataset.r===r?'page':'false'))}
function loadModule(id){return new Promise((res,rej)=>{if(window.NL_MOD&&NL_MOD[id])return res(NL_MOD[id]);const s=document.createElement('script');s.src='modules/'+id+'.js?v='+VER;s.onload=()=>NL_MOD&&NL_MOD[id]?res(NL_MOD[id]):rej();s.onerror=rej;document.head.appendChild(s)})}

/* ---------- views ---------- */
let curMod=null;
function route(){stopAudio();ticking=false;curMod=null;setAct(null);busyItem=false;
  const h=location.hash.replace(/^#\/?/,'').split('/');
  if(h[0]==='m'&&h[1])return viewModule(h[1],h[2]==='end'?-1:h[2]!=null&&h[2]!==''?+h[2]:null);
  if(h[0]==='grammar')return viewGrammar();
  if(h[0]==='review')return viewReview();
  if(h[0]==='words')return viewWords();
  if(h[0]==='progress')return viewProgress();
  return viewHome()}
window.addEventListener('hashchange',route);
/* a tab or home-screen app left open keeps running old code: look for a newer version when the app comes back into view or changes page.
   Between exercises it updates straight away; in the middle of a step it shows a bar instead. */
let newV=null;
const goNew=()=>{location.href=location.pathname+'?u='+newV+location.hash};
function offerNew(){const h=location.hash.replace(/^#\/?/,'').split('/');
  if(!(h[0]==='m'&&h[2]!==undefined)&&h[0]!=='review')return goNew();
  if($('#upd'))return;const b=document.createElement('button');b.id='upd';b.textContent='A newer version of the course is ready · tap to update';b.onclick=goNew;document.body.appendChild(b)}
async function checkVer(){if(!newV){try{const t=await (await fetch('index.html?_='+Date.now(),{cache:'no-store'})).text();const m=/NL_VER='([^']+)'/.exec(t);if(m&&m[1]!==VER)newV=m[1]}catch(e){}}if(newV)offerNew()}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkVer()});
window.addEventListener('hashchange',checkVer);
setTimeout(checkVer,3000);

function viewHome(){setNav('home');const nm=nextModule(),due=dueErrs().length+dueWords().length;const wk=weekMins(),st=streak();
  const d0=today(),dow=(new Date().getDay()+6)%7;const strip=[0,1,2,3,4,5,6].map(k=>{const d=d0-dow+k,s=S.days[d]||0;return`<div class="dd${s>=60?' on':''}${d===d0?' now':''}"><span>${['M','T','W','T','F','S','S'][k]}</span><i></i></div>`}).join('');
  const doneN=Object.values(S.mods).filter(m=>m.done).length;
  let h=`<section class="hero"><p class="eyebrow">Nederlands · A2 → B2</p><h1>${greet()}</h1>
   <div class="stats"><div><b>${doneN}</b><span>of ${C.length} sessions</span></div><div><b>${Object.values(S.srs).filter(w=>w.b>=2).length}</b><span>words learning</span></div><div><b>${wk}</b><span>min this week</span></div><div><b>${st}</b><span>day streak</span></div></div>
   <div class="week">${strip}</div></section>`;
  if(nm){const id=nm.id,m=S.mods[id];const dt=planDate(nm.slot);
    h+=`<a class="card next" href="#/m/${id}"><p class="eyebrow">${m&&m.step?'Continue':nm.les?'Next: grammar lesson':'Next module'} · ${fmt(dt)}</p><h2><span class="num">${lab(nm)}</span> ${esc(nm.title)}</h2><p class="mut">${esc(nm.en)} · ${esc(nm.gram)}</p><span class="btn go">${m&&m.step?'Resume':'Start'} · ~${nm.les?15:20} min</span></a>`}
  else h+=`<div class="card"><h2>All built modules done 🎉</h2><p class="mut">The next module appears on its planned day. Keep your words fresh with the daily review.</p></div>`;
  h+=`<a class="card rev" href="#/review"><div><h3>Daily review</h3><p class="mut small">${due?due+' cards due: words + your past mistakes':'Nothing due. Come back tomorrow.'}</p></div><span class="badge${due?'':' zero'}">${due}</span></a>`;
  CO.phases.forEach(p=>{const mods=C.filter(c=>c.ph===p.id);const dn=mods.filter(c=>(S.mods[c.id]||{}).done).length;
    h+=`<details class="phase"${mods.some(c=>c===nm)||(!nm&&p.id===1)?' open':''}><summary><div><h2>${esc(p.name)}</h2><p class="small mut">${esc(p.goal)}</p></div><span class="pp">${dn}/${mods.length}</span></summary><ol class="mods">`+
     mods.map(c=>{const id=c.id,m=S.mods[id]||{},ready=READY.has(id),sc=modScore(m);
      return `<li class="${m.done?'done':ready?'ready':'later'}${c.les?' les':''}">${ready?`<a href="#/m/${id}">`:'<div>'}<span class="num">${lab(c)}</span><span class="t"><b>${esc(c.title)}</b><small>${esc(c.gram)}</small></span><span class="r">${m.done?'✓ '+(sc!=null?sc+'%':''):ready?(m.step?'in progress':fmt(planDate(c.slot))):fmt(planDate(c.slot))}</span>${ready?'</a>':'</div>'}</li>`}).join('')+'</ol></details>'});
  view.innerHTML=h;window.scrollTo(0,0)}
function greet(){const h=new Date().getHours();return h<12?'Goedemorgen!':h<18?'Goedemiddag!':'Goedenavond!'}

/* ----- module player ----- */
/* flow 1 (modules 1–5): grammar after the texts. flow 2 (from module 6): the new grammar is explained first ('intro', with a few easy
   checks), so nothing is tested before it is taught; the 'gram' step is then practice. Lessons (kind 'les') have their own steps. */
const ST1=[['warm','Opwarmen'],['words','Woorden'],['read','Lezen'],['listen','Luisteren'],['gram','Grammatica'],['write','Schrijven'],['speak','Spreken'],['end','Klaar']];
const ST2=[['warm','Opwarmen'],['intro','Uitleg'],['words','Woorden'],['read','Lezen'],['listen','Luisteren'],['gram','Oefenen'],['write','Schrijven'],['speak','Spreken'],['end','Klaar']];
const STL=[['disc','Ontdekken'],['learn','Uitleg'],['prac','Oefenen'],['words','Vormen'],['write','Gebruiken'],['end','Klaar']];
async function viewModule(id,stepArg){setNav('home');view.innerHTML='<p class="mut" style="padding:40px 0">Loading…</p>';let M;
  try{M=await loadModule(id)}catch(e){view.innerHTML='<div class="card"><h2>Module not available yet</h2><p><a href="#/">Back</a></p></div>';return}
  curMod=id;ticking=true;const st=S.mods[id]||(S.mods[id]={ts:Date.now(),step:0,sc:{},ms:0});
  const STEPS=M.kind==='les'?STL:M.flow===2?ST2:ST1;const CM=C.find(c=>c.id===id)||{n:M.n,les:M.les};
  let step=stepArg!=null?(stepArg<0?STEPS.length-1:Math.min(stepArg,STEPS.length-1)):(st.done?0:Math.min(st.step||0,STEPS.length-1));
  const nxt=()=>go(step+1),nxl='Next: '+(STEPS[step+1]||['',''])[1];
  const go=k=>{step=k;st.step=Math.max(st.step||0,k);if(k>=STEPS.length-1){st.done=st.done||Date.now()}st.ts=Date.now();save();location.hash='#/m/'+id+'/'+k};
  const head=()=>`<div class="mhead"><a href="#/" class="back" aria-label="Back to overview">←</a><div><p class="eyebrow">${nameOf(CM)} · ${esc(M.lvl)}</p><h1>${esc(M.title)}</h1></div></div>
    <ol class="steps">${STEPS.map((s,k)=>`<li class="${k<step?'ok':k===step?'cur':''}${k<=(st.step||0)||st.done?' reach':''}"><a href="#/m/${id}/${k}" ${k<=(st.step||0)||st.done?'':'tabindex="-1" aria-disabled="true"'}><i></i><span>${s[1]}</span></a></li>`).join('')}</ol>`;
  view.innerHTML=head()+'<section id="stage"></section>';const stage=$('#stage');window.scrollTo(0,0);
  const sc=(k,v)=>{st.sc[k]=v;st.ts=Date.now();save()};
  const kind=STEPS[step][0];
  if(kind==='warm'){
    const fb=M.feedback;const goals=M.goals||[];
    let h=`<div class="card"><h2>In this module</h2><ul class="goals">${goals.map(g=>'<li>'+esc(g)+'</li>').join('')}</ul><p class="small mut">${M.flow===2?'New grammar explained first · words · reading · listening + dictation · grammar practice · writing · speaking':'Words · reading · listening + dictation · grammar · writing · speaking'}. About 20 minutes; your place is saved at every step.</p></div>`;
    const corr=fb&&fb.items?fb.items.map(f=>`<div class="corr"><p class="you"><s>${esc(f.you)}</s></p><p class="better">${esc(f.better)}</p><p class="small mut">${md(f.why).replace(/^<p>|<\/p>$/g,'')}</p></div>`).join(''):'';
    if(fb&&fb.text){const plain=fb.text.replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g,'$1'),used=[...new Set([...fb.text.matchAll(/\[\[[^|\]]+\|([^\]]+)\]\]/g)].map(m=>m[1]))];
      const marked=esc(fb.text).replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g,(m,t,c)=>`<span class="ec">${t}<sup>${c}</sup></span>`).replace(/\n/g,'<br>');
      const prevW=(fb.for||[])[0],rev=prevW&&S.writing[prevW]&&S.writing[prevW].rev;
      h+=`<div class="card fbcard"><h2>Your writing, marked</h2>${fb.note?md(fb.note):''}<p class="small mut">Each code marks a mistake. Try to fix them yourself first: that's how you remember the rule. Then compare with the corrections.</p>
        <dl class="codes">${used.map(c=>`<div><dt>${esc(c)}</dt><dd>${esc(CODES[c]||'')}</dd></div>`).join('')}</dl><p class="mtext">${marked}</p>
        <textarea id="fbt" rows="6" lang="nl" spellcheck="false">${esc(rev||plain)}</textarea><div class="row"><button class="btn sm ghost" type="button" id="fbs">Show the corrections</button></div><div id="fbc" hidden>${corr}${fb.better?`<h3>A corrected version</h3><p class="wtext">${esc(fb.better)}</p>`:''}</div></div>`}
    else if(fb&&fb.items&&fb.items.length)h+=`<div class="card fbcard"><h2>Feedback on your writing</h2>${fb.note?md(fb.note):''}${corr}</div>`;
    const warm=pickErrs(dueErrs(),5).concat(dueGram().slice(0,2),shuffle(dueWords()).slice(0,5)).concat((M.personal||[]).map((p,k)=>Object.assign({id:id+'.p.'+k,kind:'Made for you'},p)));
    const bindFb=()=>{const b=$('#fbs');if(!b)return;b.onclick=()=>{const prevW=(fb.for||[])[0];if(prevW&&S.writing[prevW]){S.writing[prevW].rev=$('#fbt').value;S.writing[prevW].revts=Date.now();save()}$('#fbc').hidden=false;b.hidden=true;$('#fbc').scrollIntoView({behavior:'smooth'})}};
    if(warm.length){h+=`<div class="card"><h2>Warm-up</h2><p class="small mut">${warm.length} quick questions: your recent mistakes and words that are due. Retrieval first, new material after.</p><div id="run"></div></div>`;stage.innerHTML=h;bindFb();
      runItems($('#run'),warm,{retry:true,review:reviewHook,onDone:()=>{$('#run').innerHTML='<p class="good-t">✓ Warm-up done</p>';setAct(nxl,nxt,true)}})}
    else{stage.innerHTML=h;bindFb();setAct('Start: '+STEPS[1][1],nxt,true)}}
  else if(kind==='words'){const W=M.words,P=(M.preps||[]).map(x=>Object.assign({kind:'prep'},x));
    stage.innerHTML=`<div class="card"><h2>${M.kind==='les'?'The forms to remember':'New words'}</h2><p class="small mut">${M.kind==='les'?'Listen, say each form out loud with its example. Then recall them from memory: they also go into your daily review, so they come back until you know them.':'Listen, say each word out loud, and read the example. Then you\'ll recall them from memory.'}</p>${speedBtn()}<div class="wl">${W.map((w,k)=>`<div class="w"><button class="pbtn" type="button" data-a="${k}" aria-label="Listen">${icoPlay}</button><div><p><b>${esc(w.nl)}</b> <span class="mut">· ${esc(w.en)}</span></p>${w.say&&w.say!==w.nl?`<p class="small"><b>${esc(w.say.replace(/, /g,' – '))}</b></p>`:''}<p class="ex">${esc(w.ex)}</p></div></div>`).join('')}</div>${P.length?`<h3 class="vc">Vaste combinaties</h3><p class="small mut">Verbs and adjectives that always take the same preposition. Learn them as one block: you'll be asked for the preposition.</p><div class="wl">${P.map((w,k)=>`<div class="w"><button class="pbtn" type="button" data-q="${k}" aria-label="Listen">${icoPlay}</button><div><p><b>${esc(w.nl)}</b> <span class="mut">· ${esc(w.en)}</span></p>${w.say&&w.say!==w.nl?`<p class="small"><b>${esc(w.say.replace(/, /g,' – '))}</b></p>`:''}<p class="ex">${esc(w.ex)}</p></div></div>`).join('')}</div>`:''}</div><div class="card" id="runc" hidden><h2>Recall</h2><div id="run"></div></div>`;
    bindSpeed(stage);$$('[data-a]',stage).forEach(b=>b.onclick=async()=>{const w=W[+b.dataset.a];await play(w.au,rate(),b);if(w.aux)await play(w.aux,rate(),b)});
    $$('[data-q]',stage).forEach(b=>b.onclick=async()=>{const w=P[+b.dataset.q];await play(w.au,rate(),b);if(w.aux)await play(w.aux,rate(),b)});
    setAct('I\'ve studied these → recall',()=>{$('#runc').hidden=false;$('.wl',stage).closest('.card').classList.add('fold');$('#runc').scrollIntoView({behavior:'smooth'});
      const items=shuffle(W.map((w,k)=>{const cz=w.cz&&w.ex.includes(w.cz)?w.cz:null;
        return k%2&&cz?{t:'type',id:id+'.w.'+k,word:w,q:'**'+w.ex.replace(cz,'_____')+'**\n\n'+glo(w),a:[cz],x:xOf(w),kind:'Fill the gap'}
                     :{t:'type',id:id+'.w.'+k,word:w,q:'In Dutch: **'+w.en+'**',a:[w.nl],art:true,x:xOf(w),kind:'Recall'}}).map(it=>pastForms(it.word)&&it.kind==='Recall'?pastItem(it.word,false,{id:it.id,word:it.word}):it).concat(
        P.map((w,k)=>({t:'type',id:id+'.pr.'+k,word:w,q:'**'+gapWord(w.ex,w.cz)+'**\n\n*('+w.en+')*',a:[w.cz],x:w.ex,kind:'Preposition'}))));
      runItems($('#run'),items,{retry:true,sk:'words',mod:id,onDone:s=>{sc('words',s);addWords(id,W.concat(P));$('#run').innerHTML=`<p class="good-t">✓ ${Math.round(s[0])}/${s[1]} right first time. These words are now in your daily review.</p>`;setAct(nxl,nxt,true)}})})}
  else if(kind==='read'){const R=M.read;
    stage.innerHTML=`<div class="card read"><p class="eyebrow">${esc(R.type||'Text')}</p><h2>${esc(R.title)}</h2>${R.intro?`<p class="small mut">${esc(R.intro)}</p>`:''}<div class="row">${R.au?`<button class="btn sm ghost" type="button" id="rau">${icoPlay} Read along</button>${speedBtn()}`:''}<span class="small mut">Tap underlined words for a translation.</span></div><article class="txt">${md(R.text)}</article></div><div class="card"><h2>Questions</h2><p class="small mut">Answer from the text. You can scroll back up.</p><div id="run"></div></div>`;
    bindGloss(stage);bindSpeed(stage);const ra=$('#rau');if(ra)ra.onclick=()=>AUD?stopAudio():play(R.au,rate(),ra);
    runItems($('#run'),R.qs.map((q,k)=>Object.assign({id:id+'.r.'+k},q)),{sk:'read',mod:id,onDone:s=>{sc('read',s);$('#run').innerHTML=`<p class="good-t">✓ ${s[0]}/${s[1]} correct.</p>`+(R.after?md(R.after):'');setAct(nxl,nxt,true)}})}
  else if(kind==='listen'){const L=M.listen;
    stage.innerHTML=`<div class="card"><p class="eyebrow">${esc(L.type||'Listening')}</p><h2>${esc(L.title)}</h2>${L.intro?`<p class="small">${esc(L.intro)}</p>`:''}<p class="small mut">Listen once without reading, then a second time if you need it. The transcript appears after the questions.</p><div class="row"><button class="btn ghost" type="button" id="lall">${icoPlay} Play</button>${speedBtn()}<span class="small mut" id="lcount"></span></div><div id="tr" hidden></div></div><div class="card"><h2>Questions</h2><div id="run"></div></div>`;
    bindSpeed(stage);let plays=0;const lb=$('#lall');
    lb.onclick=()=>{if(!lb.classList.contains('playing')){plays++;$('#lcount').textContent='played '+plays+'×'}playSeq(L.lines.map(l=>l.au),lb,250)};
    const showTr=()=>{const t=$('#tr');t.hidden=false;t.innerHTML='<h3>Transcript</h3>'+L.lines.map((l,k)=>`<p class="tl"><button class="pbtn sm" type="button" data-l="${k}" aria-label="Replay">${icoPlay}</button>${l.who?`<b>${esc(l.who)}:</b> `:''}${inline(l.t)}</p>`).join('');bindGloss(t);$$('[data-l]',t).forEach(b=>b.onclick=()=>play(L.lines[+b.dataset.l].au,rate(),b))};
    /* in the module the whole recording is above; lau (the relevant lines) is kept so the error bank can replay just that part later */
    const qs=L.qs.map((q,k)=>Object.assign({id:id+'.l.'+k},q,{lau:(q.l||[]).map(n=>L.lines[n].au)}));
    runItems($('#run'),qs,{sk:'listen',mod:id,onDone:s=>{sc('listen',s);showTr();
      const D=(L.dict||[]).map((n,k)=>({t:'dict',id:id+'.d.'+k,au:[L.lines[n].au],a:[L.lines[n].t.replace(/\{([^{}|]+)\|[^{}]+\}/g,'$1')],kind:'Dictation · sentence '+(k+1)+' of '+L.dict.length,q:'Listen and write the sentence exactly. Replay as often as you need.'}));
      if(!D.length){setAct(nxl,nxt,true);return}
      $('#run').innerHTML=`<p class="good-t">✓ ${s[0]}/${s[1]} correct. Now a short dictation (dictee): it trains your ear and your spelling at the same time.</p><div id="run2"></div>`;
      runItems($('#run2'),D,{sk:'dict',mod:id,onDone:s2=>{sc('dict',s2);$('#run2').innerHTML=`<p class="good-t">✓ Dictation: ${Math.round(s2[0])}/${s2[1]}. Read the transcript above and replay any line you missed.</p>`;setAct(nxl,nxt,true)}})}})}
  else if(kind==='intro'){const G=M.gram;
    stage.innerHTML=`<div class="card gram"><p class="eyebrow">New grammar · read this first</p><h2>${esc(G.title)}</h2>${md(G.explain)}</div>${G.check&&G.check.length?`<div class="card"><h2>Quick check</h2><p class="small mut">Just to see if the rule landed. More practice follows after the texts.</p><div id="run"></div></div>`:''}`;
    if(G.check&&G.check.length)runItems($('#run'),G.check.map((q,k)=>Object.assign({id:id+'.c.'+k},q)),{retry:true,sk:'gram',mod:id,onDone:()=>{$('#run').innerHTML='<p class="good-t">✓ Got it. You\'ll meet this grammar in the texts now.</p>';setAct(nxl,nxt,true)}});else setAct(nxl,nxt,true)}
  else if(kind==='gram'||kind==='prac'){const G=kind==='prac'?{title:M.title,items:M.practice}:M.gram;const again=M.flow===2||kind==='prac';
    const rule=kind==='prac'?(M.chunks||[]).map(c=>`<h3>${esc(c.title)}</h3>${md(c.explain)}`).join(''):md(G.explain);
    stage.innerHTML=again?`<div class="card"><p class="eyebrow">Grammar practice</p><h2>${esc(G.title)}</h2><details class="useful"><summary>The rule again</summary><div class="gram">${rule}</div></details><p class="small mut">From easy to harder. Wrong answers come back at the end of the round.</p><div id="run"></div></div>`
      :`<div class="card gram"><p class="eyebrow">Grammar</p><h2>${esc(G.title)}</h2>${md(G.explain)}</div><div class="card"><h2>Practice</h2><p class="small mut">Wrong answers come back at the end of the round.</p><div id="run"></div></div>`;
    runItems($('#run'),G.items.map((q,k)=>Object.assign({id:id+'.g.'+k},q)),{retry:true,sk:'gram',mod:id,onDone:s=>{sc('gram',s);$('#run').innerHTML=`<p class="good-t">✓ ${Math.round(s[0])}/${s[1]} right first time.</p>`;setAct(nxl,nxt,true)}})}
  else if(kind==='disc'){const D=M.discover;
    stage.innerHTML=`<div class="card"><h2>In this lesson</h2><ul class="goals">${(M.goals||[]).map(g=>'<li>'+esc(g)+'</li>').join('')}</ul><p class="small mut">A focused grammar lesson: discover → explanation in small steps → practice → learn the forms → use them. About 15 minutes.</p></div>
      <div class="card read"><p class="eyebrow">Discover</p><h2>${esc(D.title)}</h2>${D.intro?`<p class="small mut">${esc(D.intro)}</p>`:''}<div class="row">${D.au?`<button class="btn sm ghost" type="button" id="rau">${icoPlay} Listen</button>${speedBtn()}`:''}</div><article class="txt">${md(D.text)}</article></div><div class="card"><h2>What do you notice?</h2><div id="run"></div></div>`;
    bindGloss(stage);bindSpeed(stage);const ra=$('#rau');if(ra)ra.onclick=()=>AUD?stopAudio():play(D.au,rate(),ra);
    runItems($('#run'),D.qs.map(q=>Object.assign({},q)),{onDone:()=>{$('#run').innerHTML='<p class="good-t">✓ Now the rule, step by step.</p>';setAct(nxl,nxt,true)}})}
  else if(kind==='learn'){const CH=M.chunks;
    stage.innerHTML=CH.map((c,k)=>`<div class="card gram" id="ch${k}" ${k?'hidden':''}><p class="eyebrow">Step ${k+1} of ${CH.length}</p><h2>${esc(c.title)}</h2>${md(c.explain)}<div class="chk" id="cr${k}"></div></div>`).join('');bindGloss(stage);
    const runC=k=>{const box=$('#ch'+k);box.hidden=false;if(k)box.scrollIntoView({behavior:'smooth'});
      runItems($('#cr'+k),CH[k].items.map((q,j)=>Object.assign({id:id+'.c'+k+'.'+j},q)),{retry:true,sk:'gram',mod:id,onDone:()=>{$('#cr'+k).innerHTML='<p class="good-t">✓ Step '+(k+1)+' done</p>';
        if(k+1<CH.length)setAct('Next step',()=>{setAct(null);runC(k+1)},true);else setAct(nxl,nxt,true)}})};runC(0)}
  else if(kind==='write'){const Wr=M.write,prev=S.writing[id];
    stage.innerHTML=`<div class="card"><p class="eyebrow">Writing · ${esc(Wr.type||'')}</p><h2>${esc(Wr.title||'Schrijfopdracht')}</h2><div class="task">${md(Wr.task)}</div>${Wr.en?`<p class="small mut">${esc(Wr.en)}</p>`:''}
      ${Wr.useful?`<details class="useful"><summary>Useful phrases</summary><ul>${Wr.useful.map(u=>'<li>'+esc(u)+'</li>').join('')}</ul></details>`:''}
      <textarea id="wt" rows="9" lang="nl" spellcheck="false" placeholder="Schrijf hier…">${esc(prev?prev.text:'')}</textarea><p class="small mut"><span id="wc">0</span> words · aim for ${Wr.min}–${Wr.max}. Write first, look things up after.</p>
      <div id="chk" hidden><h3>Check your own text</h3><ul class="checks">${Wr.check.map((c,k)=>`<li><label><input type="checkbox" data-k="${k}"> ${md(c).replace(/^<p>|<\/p>$/g,'')}</label></li>`).join('')}</ul><p class="small mut">Fix what you can, then compare with a model answer.</p></div>
      <div id="mdl" hidden><h3>Model answer</h3><div class="model">${md(Wr.model)}</div><p class="small">Your text is saved and synced. When Claude builds a new module from your synced progress, that module opens with personal feedback on it. Want feedback right now? <button class="linkbtn" type="button" id="cp">Copy a feedback request</button> and paste it into Claude.</p></div></div>`;
    const ta=$('#wt'),wc=()=>{const n=(ta.value.match(/\S+/g)||[]).length;const el=$('#wc');if(el)el.textContent=n;return n};wc();
    const store=()=>{S.writing[id]={ts:Date.now(),task:Wr.task,text:ta.value,words:wc()};save()};
    let t;ta.addEventListener('input',()=>{wc();clearTimeout(t);t=setTimeout(store,800)});
    let phase=prev&&prev.text?1:0;const adv=()=>{if(phase===0){if(wc()<Math.min(10,Wr.min)){ta.focus();return}store();$('#chk').hidden=false;phase=1;setAct('Compare with a model',adv,true);$('#chk').scrollIntoView({behavior:'smooth'})}
      else if(phase===1){store();$('#chk').hidden=false;$('#mdl').hidden=false;phase=2;setAct(nxl,nxt,true);$('#mdl').scrollIntoView({behavior:'smooth'})}};
    if(phase===1){$('#chk').hidden=false;setAct('Compare with a model',adv,true)}else setAct('I\'m done writing',adv);
    stage.addEventListener('click',e=>{if(e.target.id!=='cp')return;const p=`Ik leer Nederlands (A2 → B1). Wil je mijn tekst corrigeren? Geef per fout: wat ik schreef, de verbeterde versie, en een korte uitleg in het Engels. Geef daarna een verbeterde versie van de hele tekst en een schatting van het niveau (A2/B1/B2).\n\nOpdracht: ${Wr.task}\n\nMijn tekst:\n${ta.value}`;
      (navigator.clipboard?navigator.clipboard.writeText(p):Promise.reject()).then(()=>{e.target.textContent='Copied ✓'}).catch(()=>{ta.select()})})}
  else if(kind==='speak'){const Sp=M.speak;const lines=Sp.lines;
    stage.innerHTML=`<div class="card"><p class="eyebrow">Speaking · shadowing</p><h2>Say it like a Dutch speaker</h2>${md(Sp.tip||'')}<p class="small mut">For each sentence: listen → record yourself → compare. Copy the melody and rhythm, not just the words. Then do the speaking task out loud.</p>${speedBtn()}<div class="sh">${lines.map((l,k)=>`<div class="shl"><p>${inline(l.t)}</p><div class="row"><button class="btn sm ghost" type="button" data-p="${k}">${icoPlay} Listen</button><button class="btn sm ghost rec" type="button" data-r="${k}">● Record</button><button class="btn sm ghost" type="button" data-m="${k}" hidden>▶ Me</button></div></div>`).join('')}</div>
      ${Sp.func?`<div class="task func"><p class="eyebrow">Useful in real life</p><h3>${esc(Sp.func.title)}</h3>${Sp.func.tip?md(Sp.func.tip):''}<div class="wl">${Sp.func.phrases.map((f,k)=>`<div class="w"><button class="pbtn" type="button" data-f="${k}" aria-label="Listen">${icoPlay}</button><div><p><b>${esc(f.nl)}</b></p><p class="ex">${esc(f.en)}</p></div></div>`).join('')}</div></div>`:''}
      ${Sp.task?`<div class="task"><h3>Speaking task</h3>${md(Sp.task)}<div class="row"><button class="btn sm ghost rec" type="button" data-r="task">● Record (max 90 s)</button><button class="btn sm ghost" type="button" data-m="task" hidden>▶ Me</button></div></div>`:''}
      <div class="task"><h3>Practise the conversation with Claude</h3><p class="small mut">Copies a role-play prompt. Paste it into the Claude app and answer in Dutch (typing or by voice). Claude plays the other person and gives a short correction after each turn.</p><div class="row"><button class="btn sm ghost" type="button" id="rp">Copy role-play prompt</button></div></div></div>`;
    bindSpeed(stage);bindGloss(stage);const recs={};let mr=null,cur=null;
    if(Sp.func)$$('[data-f]',stage).forEach(b=>b.onclick=()=>play(Sp.func.phrases[+b.dataset.f].au,rate(),b));
    $('#rp').onclick=e=>{const role=Sp.role||('Een gesprek over dit onderwerp: '+String(Sp.task||M.title).replace(/[*=]/g,''));
      const ph=Sp.func?Sp.func.phrases.map(f=>'- '+f.nl).join('\n'):'';
      const p=`Ik leer Nederlands (niveau ${M.lvl}, doel B1). Doe een rollenspel met mij, in het Nederlands.\n\nSituatie: ${role}\n\nRegels:\n- Jij speelt de andere persoon. Begin jij het gesprek.\n- Spreek eenvoudig Nederlands op mijn niveau, 1 tot 3 zinnen per beurt, en wacht dan op mijn antwoord.\n- Als ik fouten maak: zet na je antwoord één korte regel in het Engels met de belangrijkste correctie.\n- Na ongeveer 8 beurten: stop en geef me 3 tips in het Engels.${ph?'\n\nLaat me deze zinnen gebruiken:\n'+ph:''}`;
      (navigator.clipboard?navigator.clipboard.writeText(p):Promise.reject()).then(()=>{e.target.textContent='Copied ✓'}).catch(()=>{e.target.textContent='Copy failed: allow clipboard access'})};
    $$('[data-p]',stage).forEach(b=>b.onclick=()=>play(lines[+b.dataset.p].au,rate(),b));
    $$('[data-m]',stage).forEach(b=>b.onclick=()=>recs[b.dataset.m]&&play(recs[b.dataset.m],1,b));
    $$('[data-r]',stage).forEach(b=>b.onclick=async()=>{const k=b.dataset.r;
      if(mr&&cur===k){mr.stop();return}if(mr)mr.stop();
      if(!navigator.mediaDevices||!window.MediaRecorder){b.textContent='Recording not supported here: say it aloud 3×';return}
      try{stopAudio();const s=await navigator.mediaDevices.getUserMedia({audio:true});const ch=[];mr=new MediaRecorder(s);cur=k;mr.ondataavailable=e=>ch.push(e.data);
        mr.onstop=()=>{s.getTracks().forEach(t=>t.stop());recs[k]=URL.createObjectURL(new Blob(ch,{type:mr.mimeType||'audio/mp4'}));mr=null;cur=null;b.classList.remove('on');b.textContent='● Again';$(`[data-m="${k}"]`,stage).hidden=false;play(recs[k],1,$(`[data-m="${k}"]`,stage))};
        mr.start();b.classList.add('on');b.textContent='■ Stop';setTimeout(()=>{if(mr&&cur===k)mr.stop()},k==='task'?90000:12000)}catch(e){b.textContent='Microphone blocked: say it aloud 3×'}});
    setAct('Finish module',()=>{st.sc.speak=[1,1];go(STEPS.length-1)},true)}
  else{ticking=false;const sc2=st.sc||{};const rows=Object.entries(sc2).filter(([k,v])=>k!=='speak'&&v&&v[1]).map(([k,v])=>`<tr><td>${SKILL[k]}</td><td><div class="meter"><i style="width:${pct(v)}%"></i></div></td><td>${pct(v)}%</td></tr>`).join('');
    const open=Object.values(S.errs).filter(e=>e.mod===id&&!e.res).length;const nx=C[C.findIndex(c=>c.id===id)+1];
    stage.innerHTML=`<div class="card"><h2>Klaar! ${nameOf(CM)} done 🎉</h2><p class="mut">${mins((st.ms||0)/1000)} minutes · score ${modScore(st)??'–'}%</p><table class="scores">${rows}</table>
      <p>${open?`<b>${open} mistakes</b> from this module went into your error bank. They come back in the daily review and the next warm-up until you get them right twice.`:'No mistakes to bank. Sterk!'}</p>
      ${M.extra?`<h3>Extra input (optional)</h3>${md(M.extra)}`:''}
      ${nx?`<p class="small mut">Next: ${nameOf(nx).toLowerCase()} · ${esc(nx.title)} (${fmt(planDate(nx.slot))}). In between: 5–10 min daily review.</p>`:''}</div>`;
    setAct('Back to overview',()=>{location.hash='#/'},true)}
}
function bindGloss(root){$$('.gl',root).forEach(b=>b.onclick=e=>{e.stopPropagation();$$('.gtip').forEach(t=>t.remove());const t=document.createElement('span');t.className='gtip';t.textContent=b.dataset.g;b.after(t);setTimeout(()=>document.addEventListener('click',()=>t.remove(),{once:true}),0)})}

/* ----- daily review ----- */
function viewReview(){setNav('review');ticking=true;
  const errs=pickErrs(dueErrs(),12),gram=dueGram().slice(0,5),words=dueWords().slice(0,Math.max(8,26-errs.length-gram.length));const items=[];
  while(errs.length||words.length||gram.length){if(words.length)items.push(words.shift());if(errs.length)items.push(errs.shift());if(gram.length)items.push(gram.shift());if(words.length)items.push(words.shift())}
  if(!items.length){ticking=false;const nx=Object.values(S.srs).map(w=>w.due).concat(Object.values(S.errs).filter(e=>!e.res||isCheck(e)).map(e=>e.due),Object.values(S.gram).map(g=>g.due)).sort((a,b)=>a-b)[0];
    view.innerHTML=`<div class="card"><h1>Daily review</h1><p>Nothing due right now. ${nx?'Next cards: '+fmt(dayDate(nx))+'.':'Finish a module to fill your review deck.'}</p><p class="small mut">Spacing works because you forget a little in between. Coming back tomorrow is the point.</p><a class="btn" href="#/">Back</a></div>`;return}
  view.innerHTML=`<div class="card"><p class="eyebrow">Spaced repetition</p><h1>Daily review</h1><p class="small mut">${items.length} cards. Words and grammar topics return after about 1, 3, 7, 14, 30… days when you know them (sooner if they gave you trouble); a mistake sends them back to tomorrow. Mistakes leave the deck after two correct answers on different days, then come back twice more as a check (after about 2 and 6 weeks).</p><div id="run"></div></div>`;
  runItems($('#run'),items,{retry:true,review:reviewHook,onDone:s=>{ticking=false;$('#run').innerHTML=`<p class="good-t">✓ Review done: ${Math.round(s[0])}/${s[1]} right first time.</p>`;setAct('Back to overview',()=>{location.hash='#/'},true)}})}

/* ----- word bank ----- */
function viewWords(){setNav('words');const W=Object.values(S.srs).sort((a,b)=>a.nl.replace(ART,'').localeCompare(b.nl.replace(ART,'')));
  const lbl=b=>b>=6?'known':b>=4?'strong':b>=2?'learning':'new';
  view.innerHTML=`<div class="card"><h1>Word bank</h1><p class="small mut">${W.length} words · ${W.filter(w=>w.b>=4).length} strong. Box = how many times in a row you recalled it.</p><input type="search" id="q" placeholder="Search Dutch or English…"><ul class="bank">${W.map((w,k)=>`<li data-s="${esc((w.nl+' '+w.en).toLowerCase())}"><button class="pbtn sm" type="button" data-a="${k}" aria-label="Listen">${icoPlay}</button><span><b>${esc(w.nl)}</b> <span class="mut">${esc(w.en)}${w.say&&w.say!==w.nl?' · '+esc(w.say):''}</span></span><span class="lv l${Math.min(6,w.b)}">${lbl(w.b)}</span></li>`).join('')||'<li class="mut">Your words appear here after your first module.</li>'}</ul></div>`;
  $('#q').oninput=e=>{const v=e.target.value.toLowerCase();$$('.bank li[data-s]').forEach(li=>li.hidden=!li.dataset.s.includes(v))};
  $$('[data-a]').forEach(b=>b.onclick=()=>play(W[+b.dataset.a].au,1,b))}

/* ----- grammar reference: every explanation from the sessions you have started ----- */
async function viewGrammar(){setNav('grammar');const L=C.filter(c=>READY.has(c.id)&&S.mods[c.id]);
  view.innerHTML='<p class="mut" style="padding:40px 0">Loading…</p>';const Ms=await Promise.all(L.map(c=>loadModule(c.id).catch(()=>null)));
  const title=M=>M.kind==='les'?M.title:M.gram.title,body=M=>M.kind==='les'?M.chunks.map(x=>`<h3>${esc(x.title)}</h3>${md(x.explain)}`).join(''):md(M.gram.explain);
  const txt=M=>M.kind==='les'?M.chunks.map(x=>x.title+' '+x.explain).join(' '):M.gram.title+' '+M.gram.explain;
  view.innerHTML=`<div class="card"><h1>Grammar</h1><p class="small mut">Every rule you have had so far, newest first. Tap a topic to open it.</p><input type="search" id="q" placeholder="Search (e.g. omdat, was, de/het)…">${L.length?'':'<p class="mut">Start a module and its grammar appears here.</p>'}</div>`+
    L.map((c,k)=>Ms[k]?`<details class="card gref" data-s="${esc((c.title+' '+c.gram+' '+txt(Ms[k])).toLowerCase())}"><summary><span class="num">${lab(c)}</span> <b>${esc(title(Ms[k]))}</b><br><span class="small mut">${esc(nameOf(c))} · ${esc(c.title)}</span></summary><div class="gram">${body(Ms[k])}</div></details>`:'').reverse().join('');
  bindGloss(view);$('#q').oninput=e=>{const v=e.target.value.toLowerCase();$$('.gref').forEach(d=>{d.hidden=!d.dataset.s.includes(v);if(v&&!d.hidden)d.open=true})}}

/* ----- progress ----- */
function viewProgress(){setNav('progress');const done=C.filter(c=>(S.mods[c.id]||{}).done);const W=Object.values(S.srs),E=Object.values(S.errs);
  const tot=mins(Object.values(S.days).reduce((a,b)=>a+b,0));
  const sk={};done.forEach(c=>{const m=S.mods[c.id];Object.entries(m.sc||{}).forEach(([k,v])=>{if(k==='speak'||!v||!v[1])return;(sk[k]=sk[k]||[]).push(v[0]/v[1])})});
  const avg=a=>Math.round(100*a.reduce((x,y)=>x+y,0)/a.length);
  const ph=CO.phases.map(p=>{const ms=C.filter(c=>c.ph===p.id);return{p,dn:ms.filter(c=>(S.mods[c.id]||{}).done).length,n:ms.length}});
  const weeks=[];const d0=today(),dow=(new Date().getDay()+6)%7;for(let w=7;w>=0;w--){let s=0;for(let k=0;k<7;k++)s+=S.days[d0-dow-w*7+k]||0;weeks.push(mins(s))}const wmax=Math.max(40,...weeks);
  view.innerHTML=`<div class="card"><h1>Progress</h1>
   <div class="path">${ph.map(x=>`<div><p class="small"><b>${esc(x.p.name)}</b> → ${esc(x.p.to)}</p><div class="meter"><i style="width:${Math.round(100*x.dn/x.n)}%"></i></div><p class="small mut">${x.dn}/${x.n} sessions</p></div>`).join('')}</div>
   <div class="stats"><div><b>${done.length}</b><span>sessions done</span></div><div><b>${tot}</b><span>minutes total</span></div><div><b>${W.filter(w=>w.b>=4).length}</b><span>strong words</span></div><div><b>${E.filter(e=>e.res).length}/${E.length}</b><span>mistakes fixed</span></div></div></div>
   <div class="card"><h2>Minutes per week</h2><div class="bars">${weeks.map((m,k)=>`<div title="${m} min"><i style="height:${Math.round(100*m/wmax)}%"></i><span>${k===7?'now':'-'+(7-k)}</span></div>`).join('')}</div><p class="small mut">Aim: 2 modules (40 min) + 5 days of review (35 min) ≈ 75 min a week.</p></div>
   <div class="card"><h2>Skills</h2>${Object.keys(sk).length?`<table class="scores">${Object.entries(SKILL).filter(([k])=>sk[k]).map(([k,l])=>`<tr><td>${l}</td><td><div class="meter"><i style="width:${avg(sk[k])}%"></i></div></td><td>${avg(sk[k])}%</td></tr>`).join('')}</table><p class="small mut">Average first-try score across finished modules.</p>`:'<p class="mut">Finish a module to see your skill profile.</p>'}</div>
   <div class="card"><h2>Open mistakes</h2>${E.filter(e=>!e.res).length?`<ul class="errs">${E.filter(e=>!e.res).sort((a,b)=>b.n-a.n).slice(0,15).map(e=>`<li><span class="small mut">${SKILL[e.sk]||''} · ${esc(e.mod)}${e.n>1?' · ×'+e.n:''}</span><br>${inline(String(e.it.q||'').replace(/\n+/g,' ').slice(0,120))} → <b>${esc((e.it.a&&(Array.isArray(e.it.a)?e.it.a[0]:typeof e.it.a==='number'&&e.it.o?e.it.o[e.it.a]:e.it.a===true?'waar':e.it.a===false?'niet waar':''))||'')}</b></li>`).join('')}</ul>`:'<p class="mut">None open. 👏</p>'}</div>
   <div class="card"><h2>Modules</h2><table class="mt"><tr><th>#</th><th>Module</th><th>Min</th><th>Score</th></tr>${done.map(c=>{const m=S.mods[c.id];return`<tr><td>${lab(c)}</td><td><a href="#/m/${c.id}/end">${esc(c.title)}</a></td><td>${mins((m.ms||0)/1000)}</td><td>${modScore(m)??'–'}%</td></tr>`}).join('')||'<tr><td colspan="4" class="mut">None yet</td></tr>'}</table></div>
   <div class="card"><h2>My writing</h2>${Object.entries(S.writing).sort().map(([k,w])=>`<details><summary>${esc(k)} · ${w.words} words</summary><p class="small mut">${esc(w.task)}</p><p class="wtext">${esc(w.text)}</p></details>`).join('')||'<p class="mut">Nothing yet.</p>'}</div>
   <section class="card" id="sync"></section>
   <div class="card"><h2>Backup</h2><p class="small mut">Sync already keeps a copy online. This is an extra file backup.</p><div class="row"><button class="btn sm ghost" id="exp" type="button">Download backup</button><label class="btn sm ghost">Restore<input type="file" id="imp" accept=".json" hidden></label></div></div>`;
  drawSync();
  $('#exp').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(S)],{type:'application/json'}));a.download='nederlands-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click()};
  $('#imp').onchange=e=>{const f=e.target.files[0];if(!f)return;f.text().then(t=>{const x=JSON.parse(t);S=window.NLSync?NLSync._merge(S,x):x;save();viewProgress()}).catch(()=>alert('Not a valid backup file'))}}

/* ----- sync box (same flow as the Studiehub) ----- */
function drawSync(){const box=$('#sync');if(!box)return;const SY=window.NLSync;if(!SY||!SY.enabled){box.hidden=true;return}const s=SY.status();
  const ago=t=>{if(!t)return 'not yet';const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?m+' min ago':Math.round(m/60)+' h ago'};
  if(!s.code){box.innerHTML=`<h2>🔄 Sync across devices</h2><p class="small mut">Same system as the Studiehub: one personal code, progress on phone and laptop. Dutch progress is stored separately, so you can safely use the same code as on the Studiehub.</p>
    ${s.hub?`<div class="btns"><button class="btn" id="sHub" type="button">Use my Studiehub code (${esc(s.hub)})</button></div>`:''}
    <p class="small"><b>Have a code?</b> Type it (your Studiehub code works too):</p><div class="btns"><input type="text" id="sIn" placeholder="your code" autocapitalize="off" autocomplete="off" spellcheck="false"><button class="btn ghost" id="sGo" type="button">Connect</button></div>
    <div class="btns"><button class="btn ghost" id="sNew" type="button">Make a new code for me</button></div><p class="small bad-t" id="sMsg"></p>`;
    const msg=e=>{$('#sMsg').textContent=e.message};const use=(v,m)=>{$('#sMsg').textContent='';SY.setCode(v,m).then(()=>{S=load();drawSync()}).catch(msg)};
    if(s.hub)$('#sHub').onclick=()=>use(s.hub,'any');$('#sGo').onclick=()=>use($('#sIn').value,'any');$('#sIn').addEventListener('keydown',e=>{if(e.key==='Enter')use(e.target.value,'any')});$('#sNew').onclick=()=>use(SY.newCode(),'new');return}
  const stt=s.busy?'Syncing…':s.error?'⚠️ Sync not working right now. Progress is safe in this browser and will upload when it works.':'✓ Synced '+ago(s.last);
  box.innerHTML=`<h2>🔄 Sync is on</h2><p class="small">Your code: <b class="code">${esc(s.code)}</b></p><p class="small"><b>${stt}</b></p><div class="btns"><button class="btn ghost sm" id="sNow" type="button">Sync now</button><button class="btn ghost sm" id="sOff" type="button">Disconnect this device</button></div>`;
  $('#sNow').onclick=()=>SY.syncNow().then(drawSync);$('#sOff').onclick=e=>{if(e.target.dataset.sure){SY.forget();drawSync()}else{e.target.dataset.sure=1;e.target.textContent='Sure? Tap again'}}}
if(window.NLSync)NLSync.onChange(()=>{if(location.hash.startsWith('#/progress'))drawSync()});

route();
})();
