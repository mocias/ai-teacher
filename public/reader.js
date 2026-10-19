const bridge=window.teacherDesktop||window.parent.teacherDesktop,$=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,data)=>{const r=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),v=await r.json();if(!r.ok)throw Error(v.error);return v;};
let readerVisible=window.parent===window;
let state,tabs=[],active=null,current=null,selected='',sequence=0,busy=false,pendingRequest=null;
const tabData=new Map(),drafts=new Map();
const jobActions=new Set();let messageRefresh=0;
const error=e=>{console.error('READER_ERROR',e.message);$('#status').textContent=e.message;};
function run(fn){return async e=>{try{await fn(e);}catch(err){error(err);}};}
async function openResource(id){const r=state.resources.find(r=>r.id===id),file=state.resource_files.find(f=>f.resource_id===id),progress=state.study?.progress.find(p=>p.resource_id===id);if(!r)throw Error('资料不存在');await bridge.command('new',file?{resourceId:id,title:r.title}:{url:progress?.url||r.url,title:r.title,location:progress?.location||''});}
async function refreshMessages(){
 if(!current)return;const cid=current.conversation_id,version=++messageRefresh;
 const [rows,latest]=await Promise.all([api('messages?conversation_id='+encodeURIComponent(cid)),api('state')]);
 if(current?.conversation_id!==cid||version!==messageRefresh)return;state=latest;
 $('#messages').innerHTML=rows.map(m=>`<article class="bubble ${m.role}"><small>${m.role==='user'?'你':'Teacher'}</small>${esc(m.content)}${m.role==='user'&&state.jobs.some(j=>j.message_id===m.id&&j.status==='CANCELLED')?'<small>已取消处理 · 问题记录保留</small>':''}</article>`).join('');
 $('#reading-jobs').innerHTML=state.jobs.filter(j=>j.conversation_id===cid&&['QUEUED','RUNNING'].includes(j.status)).map(j=>{
  const task=state.models.tasks.find(t=>t.job_id===j.id),running=j.status==='RUNNING',unconfigured=task?.mode==='UNCONFIGURED',blocked=!!task?.blocked;
  const runs=task?.mode==='API'?state.models.runs:task?.agent_role?state.agents?.runs:state.hostAutomation?.runs;
  const latestRun=runs?.find(r=>r.job_id===j.id),failure=latestRun?.status==='FAILED'?latestRun.error:null;
  const paused=task?.mode==='API'&&!state.models.enabled;
  const text=running?'正在回答…':unconfigured?'阅读答疑尚未配置，请配置后重试这条问题。':blocked?(failure||'处理未完成，请检查连接后重试。'):paused?'API 已暂停，请在模型与分工中启用。':'问题已保存，等待所选 AI 处理。';
  const message=rows.find(m=>m.id===j.message_id)?.content||'阅读问题',disabled=jobActions.has(j.id)?'disabled':'';
  return `<section class="reading-job" data-job="${esc(j.id)}"><p class="job-question">${esc(message.slice(0,80))}${message.length>80?'…':''}</p><p role="status">${esc(text)}</p><div class="job-actions">${!running&&(blocked||unconfigured)?`<button type="button" data-job-action="retry" data-id="${esc(j.id)}" ${disabled}>重试回答</button>`:''}${!running&&(blocked||unconfigured||paused)?'<button type="button" data-job-action="configure">配置阅读答疑</button>':''}<button type="button" data-job-action="cancel" data-id="${esc(j.id)}" ${disabled}>取消处理</button></div></section>`;
 }).join('');
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
 const previous=active;if(previous!==value.active){if(previous)drafts.set(previous,$('#question').value);$('#question').value=drafts.get(value.active)||'';selected='';$('#selection').textContent='';$('#clear-selection').hidden=true;pendingRequest=null;current=null;messageRefresh++;$('#reading-jobs').innerHTML='';$('#status').textContent='';}
 tabs=value.tabs;active=value.active;const n=++sequence;$('#tabs').innerHTML=tabs.map(t=>`<span><button data-tab="${t.id}" class="${t.id===active?'active':''}">${esc(t.title.slice(0,22))}</button><button data-close="${t.id}" aria-label="关闭标签页">×</button></span>`).join('');
 const t=tabs.find(t=>t.id===active);if(!t){current=null;$('#messages').innerHTML='';$('#reading-title').textContent='阅读答疑';return;}$('#address').value=t.local?'':t.url;$('#reading-title').textContent=t.title;$('#position').textContent=t.location||'正在打开';if(t.error)$('#status').textContent=t.error;
 if(!t.local&&!/^https?:/.test(t.url))return;
 const key=t.local?t.resourceId:t.url.split('#')[0];let data=tabData.get(t.id);if(!data||data.key!==key){data={key,...await api('study/open',t.local?{resource_id:t.resourceId}:{url:t.url,title:t.title})};tabData.set(t.id,data);}
 if(n!==sequence||active!==t.id)return;current=data;
 if(readerVisible&&t.location)await api('study/progress',{resource_id:data.resource.id,location:t.location,title:t.title,url:t.local?'':t.url});if(n!==sequence)return;
 $('#goal').innerHTML=state.goals.map(g=>`<option value="${g.id}">${esc(g.title)}</option>`).join('');await refreshMessages();if(n===sequence){await showAnnotations();$('#links').textContent=state.study.links.filter(l=>l.resource_id===data.resource.id).map(l=>state.goals.find(g=>g.id===l.goal_id)?.title).join('、');}
}
async function getSelection(){if(!current)throw Error('请先打开资料');const text=await bridge.command('selection',{tabId:active});if(text)selected=text;$('#selection').textContent=selected;$('#clear-selection').hidden=!selected;return selected;}
$('#global-profile').onclick=run(()=>bridge.command('workspace'));
$('#clear-selection').onclick=()=>{selected='';$('#selection').textContent='';$('#clear-selection').hidden=true;};
$('#tabs').onclick=run(async e=>{const t=e.target.closest('[data-tab]'),c=e.target.closest('[data-close]');if(t)await bridge.command('switch',{id:t.dataset.tab});if(c)await bridge.command('close',{id:c.dataset.close});});
$('#address-form').onsubmit=run(async e=>{e.preventDefault();let url=$('#address').value.trim();if(!/^https?:\/\//i.test(url))url='https://'+url;await bridge.command('new',{url});});
for(const name of ['back','forward','reload'])$('#'+name).onclick=run(()=>bridge.command(name));
$('#library').onclick=run(async()=>{state=await api('state');$('#resource-list').innerHTML=state.resources.map(r=>`<button data-resource="${r.id}">${esc(r.title)}</button>`).join('')||'<p>还没有资料，可用“打开文件”导入。</p>';await bridge.command('overlay',{visible:true});$('#picker').showModal();});
$('#close-picker').onclick=()=>$('#picker').close();$('#picker').addEventListener('close',()=>bridge.command('overlay',{visible:false}));$('#resource-list').onclick=run(async e=>{const b=e.target.closest('[data-resource]');if(b){$('#picker').close();await openResource(b.dataset.resource);}});
$('#import').onclick=()=>$('#file').click();$('#file').onchange=run(async()=>{const f=$('#file').files[0];if(!f)return;if(f.size>20*1024*1024)throw Error('单个文件最多 20 MB');const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});const r=await api('resources',{title:f.name,file:{name:f.name,base64}});state=await api('state');await openResource(r.id);$('#file').value='';});
$('#select-ask').onclick=run(async()=>{if(!await getSelection())throw Error('请先在正文中选择文字');$('#question').focus();});
for(const kind of ['highlight','underline','note'])$('#'+kind).onclick=run(async()=>{if(!current)throw Error('请先打开资料');const id=active,c=current,t=tabs.find(t=>t.id===id);const quote=await getSelection();let note='';if(kind==='note'){note=await noteDialog();if(!note?.trim())return;}if(active!==id)throw Error('标签页已变化');await api('study/annotate',{resource_id:c.resource.id,location:t.location||'正文',quote,kind,note,title:c.resource.title+' · '+(t.location||'阅读笔记')});await showAnnotations();});
$('#link').onclick=run(async()=>{if(!current||!$('#goal').value)return;await api('study/link',{resource_id:current.resource.id,goal_id:$('#goal').value});state=await api('state');$('#links').textContent=state.study.links.filter(l=>l.resource_id===current.resource.id).map(l=>state.goals.find(g=>g.id===l.goal_id)?.title).join('、');});
$('#question').oninput=()=>{pendingRequest=null;};
$('#ask-form').onsubmit=run(async e=>{e.preventDefault();if(busy||!current)return;const content=$('#question').value.trim();if(!content)return;busy=true;$('#send').disabled=true;try{const id=active,c=current,snapshot=await bridge.command('snapshot',{tabId:id});if(active!==id||current!==c)throw Error('阅读位置已变化，请重新提问');if(!snapshot)throw Error('资料尚未就绪，请等待页面加载后提问');pendingRequest??=crypto.randomUUID();await api('study/ask',{conversation_id:c.conversation_id,content,request_id:pendingRequest,location:snapshot.location||'',url:snapshot.url||'',title:snapshot.title||'',selection:selected||snapshot.selection||'',page_content:snapshot.content||''});pendingRequest=null;$('#question').value='';drafts.delete(id);selected='';$('#selection').textContent='';await refreshMessages();}finally{busy=false;$('#send').disabled=false;}});
try{if(!bridge)throw Error('内置阅读器仅在桌面软件中提供。');state=await api('state');bridge.onState(v=>changed(v).catch(error));bridge.onSelection(run(async v=>{if(v.openResource){state=await api('state');await openResource(v.openResource);return;}if(v.tabId!==active)return;selected=v.text;$('#selection').textContent=selected;$('#clear-selection').hidden=false;$('#question').focus();}));await bridge.command('state');const initial=new URLSearchParams(location.search).get('resource');if(initial)await openResource(initial);const events=new EventSource('/api/events');events.onmessage=()=>refreshMessages().catch(error);window.parent.postMessage({readerReady:true},location.origin);}catch(e){error(e);}

async function noteDialog(){await bridge.command('overlay',{visible:true});return new Promise(resolve=>{const d=$('#note-dialog');let finished=false;const finish=async value=>{if(finished)return;finished=true;d.close();await bridge.command('overlay',{visible:false});resolve(value);};$('#note-text').value='';d.showModal();$('#cancel-note').onclick=()=>finish(null);$('#note-form').onsubmit=e=>{e.preventDefault();finish($('#note-text').value);};d.oncancel=e=>{e.preventDefault();finish(null);};});}

window.addEventListener('message',e=>{if(e.source!==window.parent||e.origin!==location.origin)return;if(typeof e.data?.readerVisibility==='boolean'){const entering=!readerVisible&&e.data.readerVisibility;readerVisible=e.data.readerVisibility;if(entering)bridge?.command('state').catch(error);}if(e.data?.openResource)(async()=>{state=await api('state');await openResource(e.data.openResource);})().catch(error);});

$('#formal-goal').onclick=run(()=>{if(!current)throw Error('请先打开资料');window.parent.postMessage({readerGoal:current.resource.id},location.origin);});
