import { compilePlan, createPreviewSession, normalizeProfile, ROUTINES } from '../../src/core/presence.js';

const $ = (selector) => document.querySelector(selector);
const KEY = 'instaToolboxPresencePreviewV1';
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let plan = null;
let session = null;
let timer = null;
const announce = (text) => { $('#status').textContent = text; };
const timeMinute = (value) => { const [h,m] = value.split(':').map(Number); return h * 60 + m; };
const formatTime = (minute) => `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
const topics = (value) => value.split(',').map((x) => x.trim()).filter(Boolean);
$('#timezone').textContent = `Time zone: ${zone}. This is a planning window, not a background scheduler.`;

function readProfile() {
  const goal = $('input[name="goal"]:checked').value;
  const limit = Number($('#limit').value);
  return normalizeProfile({
    accountId: '100', username: 'demo_owner', goal, timezone: zone,
    topics: topics($('#topics').value), excludedTopics: topics($('#excluded').value),
    followLimit: goal === 'curate' ? 0 : limit, unfollowLimit: goal === 'curate' ? limit : 0,
    waitDays: Number($('#wait-days').value), skipPrivate: $('#skip-private').checked,
    protectedIds: $('#protect-demo').checked ? ['205'] : [],
    window: {start:timeMinute($('#window-start').value),end:timeMinute($('#window-end').value)},
  });
}
function sampleData(now) {
  const base={accountId:'100',source:'manual',relation:'not-following',isPrivate:false,observedAt:now,topics:['photography']};
  return {
    candidates:[
      {...base,targetId:'201',username:'demo_outdoors',topics:['photography','travel']},
      {...base,targetId:'202',username:'demo_studio',followsMe:true,followsMeEvidence:'direct'},
      {...base,targetId:'203',username:'demo_past_follow',relation:'following',followsMe:false,followsMeEvidence:'direct',source:'managed-history'},
      {...base,targetId:'204',username:'demo_partial',relation:'following',followsMe:false,followsMeEvidence:'partial-list',source:'mutual-checker'},
      {...base,targetId:'205',username:'demo_friend'},
      {...base,targetId:'206',username:'demo_requested',relation:'requested'},
      {...base,targetId:'207',username:'demo_recent',relation:'following',followsMe:false,followsMeEvidence:'direct',source:'managed-history'},
    ],
    history:[203,204,207].map((id)=>({accountId:'100',targetId:String(id),origin:'presence',outcome:'verified',followedAt:now-(id===207?2:9)*86_400_000})),
  };
}
function clearTimer() { if(timer!==null) clearTimeout(timer); timer=null; }
function invalidate() {
  clearTimer(); if(session) session.dispatch('stop'); session=null; plan=null;
  $('.review').hidden=true; announce('Preferences changed. Build a fresh plan.');
}
function controls() {
  const s=session?.snapshot();
  const active=s?.state==='previewing';
  $('#start-preview').textContent=s?.state==='paused'?'Resume preview':'Preview session';
  $('#start-preview').disabled=active||['simulated','stopped','expired'].includes(s?.state)||!plan?.targets.length;
  $('#pause-preview').hidden=!active;
  $('#stop-preview').hidden=!s||!['ready','previewing','paused'].includes(s.state);
  $('#progress').hidden=!s;
  $('#progress').max=Math.max(1,s?.total||0); $('#progress').value=s?.simulated||0;
}
function drawPlan() {
  $('.review').hidden=false;
  const held=plan.decisions.filter((d)=>d.state!=='planned').length;
  $('#plan-summary').textContent=`${plan.targets.length} suggestion${plan.targets.length===1?'':'s'} · ${held} held, waiting, or protected · demo data`;
  const list=$('#decisions'); list.replaceChildren();
  for(const d of plan.decisions) {
    const row=document.createElement('div'); row.className='decision'; row.dataset.state=d.state;
    const copy=document.createElement('div'); const name=document.createElement('strong'); name.textContent=`@${d.username}`;
    const reason=document.createElement('p'); reason.textContent=d.reason;
    if(d.state==='waiting'&&d.dueAt) reason.textContent+=` · due ${new Date(d.dueAt).toLocaleDateString()}`;
    const label=document.createElement('span'); label.textContent=d.state==='planned'?d.action:d.state;
    copy.append(name,reason); row.append(copy,label); list.append(row);
  }
  controls(); announce('Plan ready to preview. Nothing on Instagram will change.');
}
function tick() {
  timer=null;
  if(session?.snapshot().state!=='previewing') return;
  const s=session.dispatch('step',{accountId:'100'}); controls();
  announce(s.state==='simulated'?`Preview finished. ${s.simulated} simulated actions. No Instagram changes.`:s.state==='previewing'?`Preview only · ${s.simulated} of ${s.total} simulated.`:s.reason);
  if(s.state==='previewing') timer=setTimeout(tick,650);
}
$('#routine-form').addEventListener('submit',(event)=>{
  event.preventDefault(); clearTimer();
  try {const now=Date.now(); plan=compilePlan({profile:readProfile(),...sampleData(now),now});session=null;drawPlan();}
  catch(error){plan=null;session=null;$('.review').hidden=true;announce(error.message);}
});
$('#routine-form').addEventListener('input',(event)=>{
  if(event.target.name==='goal') $('#limit').value=String(ROUTINES[event.target.value][event.target.value==='curate'?'unfollowLimit':'followLimit']);
  invalidate();
});
$('#start-preview').addEventListener('click',()=>{
  try {
    if(!session){session=createPreviewSession(plan);session.dispatch('review',{accountId:'100'});}
    if(session.snapshot().state==='paused') session.dispatch('resume',{accountId:'100'});
    const state=session.dispatch('start',{accountId:'100'});controls();
    announce(state.state==='previewing'?'Simulating your reviewed plan. No live actions.':state.reason);
    clearTimer();if(state.state==='previewing')timer=setTimeout(tick,650);
  }catch(error){announce(error.message);controls();}
});
$('#pause-preview').addEventListener('click',()=>{clearTimer();session?.dispatch('pause');controls();announce('Preview paused.');});
$('#stop-preview').addEventListener('click',()=>{clearTimer();session?.dispatch('stop');controls();announce('Preview stopped. Build a new plan to begin again.');});
$('#save-profile').addEventListener('click',()=>{
  try{if(!$('#routine-form').reportValidity())return;localStorage.setItem(KEY,JSON.stringify(readProfile()));announce('Preferences saved in this browser only. No targets or session authority saved.');}
  catch(error){announce(`Preferences not saved: ${error.message}`);}
});
$('#reset').addEventListener('click',()=>{
  clearTimer();session?.dispatch('stop');session=null;plan=null;
  try{localStorage.removeItem(KEY);}catch{announce('Could not clear browser preferences.');return;}
  $('#routine-form').reset();$('.review').hidden=true;announce('Concept reset. Other toolbox data was not changed.');
});
$('#export-plan').addEventListener('click',()=>{
  if(!plan)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='presence-review-demo.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);announce('Demo planning manifest exported. It is not an executable job.');
});
$('#theme').addEventListener('click',()=>{
  const dark=document.documentElement.dataset.theme!=='dark';
  document.documentElement.dataset.theme=dark?'dark':'light';$('#theme').textContent=dark?'Light theme':'Dark theme';
});
$('#ghost-info').addEventListener('click',()=>{
  clearTimer();if(session)session.dispatch('ghost');controls();$('#ghost-dialog').showModal();
});
$('#close-ghost').addEventListener('click',()=>{$('#ghost-dialog').close();$('#ghost-info').focus();});
window.addEventListener('pagehide',clearTimer);
try{
  const raw=localStorage.getItem(KEY);
  if(raw){
    const p=normalizeProfile(JSON.parse(raw));
    if(p.accountId!=='100'||p.username!=='demo_owner')throw new Error('This concept only restores demo preferences.');
    $(`input[name="goal"][value="${p.goal}"]`).checked=true;
    $('#topics').value=p.topics.join(', ');$('#excluded').value=p.excludedTopics.join(', ');
    $('#limit').value=String(p.goal==='curate'?p.unfollowLimit:p.followLimit);$('#wait-days').value=String(p.waitDays);
    $('#skip-private').checked=p.skipPrivate;$('#protect-demo').checked=p.protectedIds.includes('205');
    $('#window-start').value=formatTime(p.window.start);$('#window-end').value=formatTime(p.window.end);
    announce('Preferences restored. Build a new plan; no session was resumed.');
  }
}catch{announce('Saved preferences could not be read. Defaults remain available.');}
