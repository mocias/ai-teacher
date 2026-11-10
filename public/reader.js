import {readingPosition,restoreReadingPosition,enhanceComposer,enhanceMessages} from './chat-ui.js';
import {bindDshModelPicker} from './dsh-model-picker.js';
import {watchUpdates} from './live-events.js';
import {bindReplyStream} from './reply-stream.js';
import {messageContent} from './message-content.js';
import {bindReaderLayout} from './layout-resize.js';
const bridge=window.teacherDesktop||window.parent.teacherDesktop,$=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,data)=>{const r=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),v=await r.json();if(!r.ok)throw Error(v.error);return v;};
const sidebarStorageKey='ai-teacher.reader.sidebar-collapsed';
let sidebarCollapsed=false,layoutFrame=0;
function notifyReaderLayout(){
 if(layoutFrame)return;
 layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;const header=$('#reader-header');document.body.style.setProperty('--reader-sidebar-top',header.getBoundingClientRect().bottom+'px');window.parent.postMessage({readerLayout:true},location.origin);});
}
function setSidebarCollapsed(collapsed,{persist=true}={}){
 const side=$('#reader-side'),toggle=$('#reader-side-toggle');
 if(collapsed&&side.contains(document.activeElement))toggle.focus();
 sidebarCollapsed=collapsed;side.hidden=collapsed;document.body.classList.toggle('reader-side-collapsed',collapsed);
 toggle.setAttribute('aria-expanded',String(!collapsed));toggle.textContent=collapsed?'‹ 展开侧栏':'收起侧栏 ›';
 toggle.setAttribute('aria-label',(collapsed?'展开':'收起')+'阅读侧栏');
 if(persist)try{localStorage.setItem(sidebarStorageKey,collapsed?'1':'0');}catch{}
 notifyReaderLayout();
}
try{sidebarCollapsed=localStorage.getItem(sidebarStorageKey)==='1';}catch{}
setSidebarCollapsed(sidebarCollapsed,{persist:false});
$('#reader-side-toggle').onclick=()=>setSidebarCollapsed(!sidebarCollapsed);
$('#reader-network-status').onclick=()=>{setSidebarCollapsed(false);$('#reader-network').open=true;$('#reader-network').scrollIntoView({block:'nearest'});$('#reader-network summary').focus();};
// Keep every pane mounted: changing tools must preserve editors and their ancestry.
const readerPaneKey='ai-teacher.reader.tool-pane',readerPanes=['chat','marks','goals'];
function setReaderPane(pane,{persist=true,focus=false}={}){
 if(!readerPanes.includes(pane))pane='chat';
 const tab=$('#reader-tab-'+pane);
 for(const name of readerPanes){
  const selected=name===pane,button=$('#reader-tab-'+name);
  button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  $('#reader-pane-'+name).hidden=!selected;
 }
 if(pane==='marks')$('#reader-annotations').open=true;
 if(pane==='goals')$('#reader-goals').open=true;
 if(focus)tab.focus();
 if(persist)try{localStorage.setItem(readerPaneKey,pane);}catch{}
 updateReaderJobSummary();
}
let initialReaderPane='chat';try{initialReaderPane=localStorage.getItem(readerPaneKey)||'chat';}catch{}
setReaderPane(initialReaderPane,{persist:false});
$('.reader-tool-tabs').addEventListener('click',e=>{const tab=e.target.closest('[data-reader-pane]');if(tab)setReaderPane(tab.dataset.readerPane);});
$('.reader-tool-tabs').addEventListener('keydown',e=>{
 const tab=e.target.closest('[data-reader-pane]');if(!tab)return;
 const index=readerPanes.indexOf(tab.dataset.readerPane);
 const next=e.key==='Home'?0:e.key==='End'?2:e.key==='ArrowRight'?(index+1)%3:e.key==='ArrowLeft'?(index+2)%3:null;
 if(next===null)return;e.preventDefault();setReaderPane(readerPanes[next],{focus:true});
});
function openReaderQuestion(){setSidebarCollapsed(false);setReaderPane('chat');$('#question').focus();}
$('#reader-job-summary').onclick=openReaderQuestion;
function updateReaderJobSummary(){
 const summary=$('#reader-job-summary'),jobs=[...$('#reading-jobs').children],needsAttention=jobs.some(j=>j.querySelector('[data-job-action="retry"]'));
 summary.hidden=!jobs.length||$('#reader-tab-chat').getAttribute('aria-selected')==='true';summary.textContent=jobs.length?(needsAttention?'答疑需要处理 · 查看':'答疑状态 · '+jobs.length+' 项未完成'):'';
 summary.classList.toggle('has-error',needsAttention);
}
new MutationObserver(updateReaderJobSummary).observe($('#reading-jobs'),{childList:true,subtree:true});
const readerLayoutObserver=new ResizeObserver(notifyReaderLayout);
readerLayoutObserver.observe($('#reader-header'));readerLayoutObserver.observe($('#reader-side'));
bindReaderLayout(document);
document.addEventListener('pane-resized',notifyReaderLayout);
window.addEventListener('resize',notifyReaderLayout);
let readerVisible=window.parent===window,readerState={proxyEnabled:false,proxyAvailable:false};
let state,tabs=[],active=null,current=null,selected='',sequence=0,busy=false,pendingRequest=null;
const tabData=new Map(),drafts=new Map();
let lastMessages='';
const jobActions=new Set();let messageRefresh=0;
const error=e=>{console.error('READER_ERROR',e.message);$('#status').textContent=e.message;};
function run(fn){return async e=>{$('#status').textContent='';try{await fn(e);}catch(err){error(err);}};}
async function openResource(id){const r=state.resources.find(r=>r.id===id),file=state.resource_files.find(f=>f.resource_id===id),progress=state.study?.progress.find(p=>p.resource_id===id);if(!r)throw Error('资料不存在');await bridge.command('new',file?{resourceId:id,title:r.title}:{url:progress?.url||r.url,title:r.title,location:progress?.location||''});}
async function refreshMessages(){
 if(!current)return;const cid=current.conversation_id,version=++messageRefresh;
 const [rows,latest]=await Promise.all([api('messages?conversation_id='+encodeURIComponent(cid)),api('state')]);
 if(current?.conversation_id!==cid||version!==messageRefresh)return;state=latest;
 const list=$('#messages'),thread=$('.reader-thread'),position=list.dataset.rendered===cid?readingPosition(thread):null;
 const html=rows.map(m=>`<article class="bubble ${m.role}"><small>${m.role==='user'?'你':'Teacher'}</small>${messageContent(m)}${m.role==='user'&&state.jobs.some(j=>j.message_id===m.id&&j.status==='CANCELLED')?'<small>已取消处理 · 问题记录保留</small>':''}</article>`).join('');
 const signature=cid+':'+html;if(lastMessages!==signature){lastMessages=signature;list.innerHTML=html;list.dataset.rendered=cid;}
 bindReplyStream(list,cid,rows,'reader',thread);bindDshModelPicker($('#ask-form'),state,cid,'reading');enhanceComposer($('#ask-form'));enhanceMessages(list);
 $('#reading-jobs').innerHTML=state.jobs.filter(j=>j.conversation_id===cid&&['QUEUED','RUNNING'].includes(j.status)).map(j=>{
  const task=state.models.tasks.find(t=>t.job_id===j.id),running=j.status==='RUNNING',unconfigured=task?.mode==='UNCONFIGURED',blocked=!!task?.blocked;
  const runs=task?.mode==='API'?state.models.runs:task?.agent_role?state.agents?.runs:state.hostAutomation?.runs;
  const latestRun=runs?.find(r=>r.job_id===j.id),failure=latestRun?.status==='FAILED'?latestRun.error:null;
  const paused=task?.mode==='API'&&!state.models.enabled;
  const text=running?'正在回答…':unconfigured?'阅读答疑尚未配置，请配置后重试这条问题。':blocked?(failure||'处理未完成，请检查连接后重试。'):paused?'API 已暂停，请在模型与分工中启用。':'问题已保存，等待所选 AI 处理。';
  const message=rows.find(m=>m.id===j.message_id)?.content||'阅读问题',disabled=jobActions.has(j.id)?'disabled':'';
  return `<section class="reading-job" data-job-status="${esc(j.id)}" data-job="${esc(j.id)}"><p class="job-question">${esc(message.slice(0,80))}${message.length>80?'…':''}</p><p role="status">${esc(text)}</p><div class="job-actions">${!running&&(blocked||unconfigured)?`<button type="button" data-job-action="retry" data-id="${esc(j.id)}" ${disabled}>重试回答</button>`:''}${!running&&(blocked||unconfigured||paused)?'<button type="button" data-job-action="configure">配置阅读答疑</button>':''}<button type="button" data-job-action="cancel" data-id="${esc(j.id)}" ${disabled}>取消处理</button></div></section>`;
 }).join('');
 restoreReadingPosition(thread,position);
}
$('#reading-jobs').onclick=run(async e=>{
 const button=e.target.closest('[data-job-action]');if(!button)return;
 if(button.dataset.jobAction==='configure'){window.parent.postMessage({readerConfigure:true},location.origin);return;}
 const id=button.dataset.id,cid=current?.conversation_id;if(jobActions.has(id)||!cid)return;
 jobActions.add(id);button.disabled=true;$('#status').textContent='';
 try{
  const latest=await api('state'),job=latest.jobs.find(j=>j.id===id&&j.conversation_id===cid);
  if(!job||!['QUEUED','RUNNING'].includes(job.status))return;
  if(button.dataset.jobAction==='cancel')await api('jobs/cancel',{id});
  else if(job.status==='QUEUED'){
   const task=latest.models.tasks.find(t=>t.job_id===id);
   await api(task?.agent_role?'agents/retry':'models/retry',task?.agent_role?{job_id:id}:{job_id:id,mode:task?.mode||'HOST'});
  }
 }finally{jobActions.delete(id);await refreshMessages();}
});
async function showAnnotations(){if(!current)return;const id=current.resource.id,items=await api('reading-annotations?id='+encodeURIComponent(id));if(current?.resource.id!==id)return;$('#annotations').innerHTML=items.map(a=>`<div class="annotation"><small>${esc(a.location)} · ${a.kind==='note'?'笔记':a.kind==='highlight'?'高亮':'划线'}</small><div>${esc(a.quote)}</div>${a.note?`<div>${esc(a.note)}</div>`:''}</div>`).join('')||'<p>暂无标记</p>';const tab=tabs.find(t=>t.id===active);for(const a of items.filter(a=>a.kind!=='note'&&a.location===tab?.location))await bridge.command('mark',{tabId:active,quote:a.quote,kind:a.kind});}
async function changed(value){
 const last=tabs.find(t=>t.id===active);
 readerState=value;
 const previous=active;if(previous!==value.active){if(previous)drafts.set(previous,$('#question').value);$('#question').value=drafts.get(value.active)||'';selected='';$('#selection').textContent='';$('#clear-selection').hidden=true;pendingRequest=null;current=null;messageRefresh++;$('#reading-jobs').innerHTML='';$('#status').textContent='';}
 tabs=value.tabs;active=value.active;const n=++sequence;$('#tabs').innerHTML=tabs.map(t=>`<span><button data-tab="${t.id}" class="${t.id===active?'active':''}">${esc(t.title.slice(0,22))}</button><button data-close="${t.id}" aria-label="关闭标签页">×</button></span>`).join('');
 const t=tabs.find(t=>t.id===active),networkError=$('#reader-network-error'),proxy=$('#reader-proxy');
 networkError.textContent=t?.error?String(t.error)+(!t.local&&!value.proxyAvailable?'\n可检查网络后刷新。若需代理，请在「模型与分工 → DSH 联网」设置本机代理地址，然后回到这里刷新。':''):'';networkError.hidden=!t?.error;
 proxy.hidden=!t||t.local||!(value.proxyEnabled||(t.error&&value.proxyAvailable));proxy.textContent=value.proxyEnabled?'阅读器切回系统网络并重试':'阅读器使用本机代理并重试';$('#reader-network-scope').hidden=proxy.hidden;
 const networkMode=value.proxyEnabled?'本机代理':'系统网络',networkStatus=$('#reader-network-status'),networkDetails=$('#reader-network');
 networkStatus.textContent=networkMode+(t?.error?' · 加载失败':'');networkStatus.classList.toggle('has-error',!!t?.error);
 networkStatus.setAttribute('aria-label','阅读器使用'+networkMode+(t?.error?'，网页加载失败，查看详情':'，查看网络设置'));
 networkStatus.title=t?.error?String(t.error):'阅读器使用'+networkMode+'，点击查看网络设置';
 $('#reader-network-mode').textContent=t?.local?'本地资料无需联网；网页使用'+networkMode:'网页使用'+networkMode;
 networkDetails.classList.toggle('has-error',!!t?.error);if(t?.error)networkDetails.open=true;
 const key=t&&(t.local?t.resourceId:t.url.split('#')[0]);
 if(!t?.ready||t.error||current?.key!==key){
  current=null;lastMessages='';selected='';pendingRequest=null;
  for(const id of ['messages','selection','reading-jobs','annotations','links'])$('#'+id).textContent='';
  $('#clear-selection').hidden=true;
 }
 $('#address').value=t&&!t.local?t.url:'';$('#reading-title').textContent=t?.title||'阅读答疑';
 $('#position').textContent=t?.error?'网页未加载':t?.location||(t?'正在打开':'');
 if(!t?.ready||t.error||(!t.local&&!t.location))return;
 if(last?.id===active&&last.error)$('#status').textContent='';
 if(!t.local&&!/^https?:/.test(t.url))return;
 let data=tabData.get(t.id);if(!data||data.key!==key){data={key,...await api('study/open',t.local?{resource_id:t.resourceId}:{url:t.url,title:t.title})};if(n!==sequence)return;tabData.set(t.id,data);}
 if(n!==sequence||active!==t.id)return;current=data;if(!readerVisible)return;
 if(readerVisible&&t.ready&&!t.error&&t.location)await api('study/progress',{resource_id:data.resource.id,location:t.location,title:t.title,url:t.local?'':t.url});if(n!==sequence)return;
 $('#goal').innerHTML=state.goals.map(g=>`<option value="${g.id}">${esc(g.title)}</option>`).join('');await refreshMessages();if(n===sequence){await showAnnotations();$('#links').textContent=state.study.links.filter(l=>l.resource_id===data.resource.id).map(l=>state.goals.find(g=>g.id===l.goal_id)?.title).join('、');}
}
async function readSelection(){
 if(!current)throw Error('请先打开资料');
 const id=active,resource=current,text=await bridge.command('selection',{tabId:id});
 if(active!==id||current!==resource)throw Error('阅读位置已变化，请重新选择文字');
 return text||'';
}
function setQuestionSelection(text){
 selected=text;pendingRequest=null;
 $('#selection').textContent=text;
 $('#clear-selection').hidden=!text;
}
$('#global-profile').onclick=run(()=>bridge.command('workspace'));
$('#reader-proxy').onclick=run(async()=>{const tabId=active;await bridge.command('proxy',{enabled:!readerState.proxyEnabled,tabId});});
$('#clear-selection').onclick=()=>setQuestionSelection('');
$('#tabs').onclick=run(async e=>{const t=e.target.closest('[data-tab]'),c=e.target.closest('[data-close]');if(t)await bridge.command('switch',{id:t.dataset.tab});if(c)await bridge.command('close',{id:c.dataset.close});});
$('#address-form').onsubmit=run(async e=>{e.preventDefault();let url=$('#address').value.trim();if(!/^https?:\/\//i.test(url))url='https://'+url;await bridge.command('new',{url});});
for(const name of ['back','forward','reload'])$('#'+name).onclick=run(()=>bridge.command(name));
$('#library').onclick=run(async()=>{state=await api('state');$('#resource-list').innerHTML=state.resources.map(r=>`<button data-resource="${r.id}">${esc(r.title)}</button>`).join('')||'<p>还没有资料，可用“打开文件”导入。</p>';await bridge.command('overlay',{visible:true});$('#picker').showModal();});
$('#close-picker').onclick=()=>$('#picker').close();$('#picker').addEventListener('close',()=>bridge.command('overlay',{visible:false}));$('#resource-list').onclick=run(async e=>{const b=e.target.closest('[data-resource]');if(b){$('#picker').close();await openResource(b.dataset.resource);}});
$('#import').onclick=()=>$('#file').click();$('#file').onchange=run(async()=>{const f=$('#file').files[0];if(!f)return;if(f.size>20*1024*1024)throw Error('单个文件最多 20 MB');const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});const r=await api('resources',{title:f.name,file:{name:f.name,base64}});state=await api('state');await openResource(r.id);$('#file').value='';});
$('#select-ask').onclick=run(async()=>{
 const text=await readSelection();
 if(!text.trim())throw Error('请先在正文中选择文字');
 setQuestionSelection(text);openReaderQuestion();
});
for(const kind of ['highlight','underline','note'])$('#'+kind).onclick=run(async()=>{
 if(!current)throw Error('请先打开资料');
 const id=active,c=current,t=tabs.find(t=>t.id===id),quote=await readSelection();
 if(kind!=='note'&&!quote.trim())throw Error('请先在正文中选择文字');
 let note='';
 if(kind==='note'){note=await noteDialog();if(!note?.trim())return;}
 if(active!==id||current!==c)throw Error('阅读位置已变化，请重试');
 await api('study/annotate',{resource_id:c.resource.id,location:t.location||'正文',quote,kind,note,title:c.resource.title+' · '+(t.location||'阅读笔记')});
 await showAnnotations();
});
$('#link').onclick=run(async()=>{if(!current||!$('#goal').value)return;await api('study/link',{resource_id:current.resource.id,goal_id:$('#goal').value});state=await api('state');$('#links').textContent=state.study.links.filter(l=>l.resource_id===current.resource.id).map(l=>state.goals.find(g=>g.id===l.goal_id)?.title).join('、');});
$('#question').oninput=()=>{pendingRequest=null;if(active)drafts.set(active,$('#question').value);};
$('#ask-form').onsubmit=run(async e=>{e.preventDefault();if(busy||!current)return;const submitted=$('#question').value,content=submitted.trim();if(!content)return;restoreReadingPosition($('.reader-thread'));busy=true;$('#send').disabled=true;try{const id=active,c=current,quote=selected,snapshot=await bridge.command('snapshot',{tabId:id});if(active!==id||current!==c)throw Error('阅读位置已变化，请重新提问');if(!snapshot||snapshot.error||snapshot.ready===false||!tabs.find(t=>t.id===id&&t.ready&&!t.error))throw Error('资料尚未就绪，请等待页面加载成功后提问');pendingRequest??=crypto.randomUUID();await api('study/ask',{conversation_id:c.conversation_id,content,request_id:pendingRequest,location:snapshot.location||'',url:snapshot.url||'',title:snapshot.title||'',selection:quote,page_content:snapshot.content||''});pendingRequest=null;if((drafts.get(id)??submitted)===submitted){drafts.delete(id);if(active===id&&current===c&&$('#question').value===submitted){$('#question').value='';if(selected===quote)setQuestionSelection('');}}await refreshMessages();}finally{busy=false;$('#send').disabled=false;}});
try{if(!bridge)throw Error('内置阅读器仅在桌面软件中提供。');state=await api('state');bridge.onState(v=>changed(v).catch(error));bridge.onSelection(run(async v=>{if(v.openResource){state=await api('state');await openResource(v.openResource);return;}if(v.tabId!==active)return;setQuestionSelection(v.text);openReaderQuestion();}));await bridge.command('state');const initial=new URLSearchParams(location.search).get('resource');if(initial)await openResource(initial);watchUpdates(refreshMessages,{onError:error,active:()=>readerVisible&&!document.hidden});window.parent.postMessage({readerReady:true},location.origin);}catch(e){error(e);}

async function noteDialog(){await bridge.command('overlay',{visible:true});return new Promise(resolve=>{const d=$('#note-dialog');let finished=false;const finish=async value=>{if(finished)return;finished=true;d.close();await bridge.command('overlay',{visible:false});resolve(value);};$('#note-text').value='';d.showModal();$('#cancel-note').onclick=()=>finish(null);$('#note-form').onsubmit=e=>{e.preventDefault();finish($('#note-text').value);};d.oncancel=e=>{e.preventDefault();finish(null);};});}

window.addEventListener('message',e=>{if(e.source!==window.parent||e.origin!==location.origin)return;if(typeof e.data?.readerVisibility==='boolean'){const entering=!readerVisible&&e.data.readerVisibility;readerVisible=e.data.readerVisibility;if(entering)bridge?.command('state').catch(error);}if(e.data?.openResource)(async()=>{state=await api('state');await openResource(e.data.openResource);})().catch(error);});

$('#formal-goal').onclick=run(()=>{if(!current)throw Error('请先打开资料');window.parent.postMessage({readerGoal:current.resource.id},location.origin);});

window.addEventListener('dsh-model-changed',()=>refreshMessages().catch(error));
