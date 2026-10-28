import {icon,agentNavigation,enhanceComposer,enhanceMessages,setSendButton,resizeComposer} from './chat-ui.js';
import {bindDshModelPicker} from './dsh-model-picker.js';
import {watchUpdates} from './live-events.js';
import {bindReplyStream} from './reply-stream.js';
import {messageContent,escapeText as esc} from './message-content.js';
const $=s=>document.querySelector(s);
$('#agent-navigation').innerHTML=agentNavigation();
const api=async(p,a)=>{const r=await fetch('/api/'+p,a===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)}),v=await r.json();if(!r.ok)throw Error(v.error);return v;};
let cid,request,busy=false,refreshing=false,queued=false,first=true,lastHTML='';
const showError=e=>{$('#error').textContent=e?.message||'';$('#error').hidden=!e;};
const bottom=()=>{const list=$('#messages');return list.scrollHeight-list.scrollTop-list.clientHeight<100;};
function jump(){const list=$('#messages');list.scrollTop=list.scrollHeight;$('#jump-latest').hidden=true;}
function persistDraft(){try{localStorage.setItem('teacher-master-draft:'+cid,$('#content').value);}catch{$('#draft-status').textContent='当前无法保存草稿，请发送前保留副本';}}
function sessionInfo(state){
 const session=state.agents?.dsh_sessions?.find(s=>s.conversation_id===cid),route=state.agents?.routes?.find(r=>r.role==='master');
 const labels={NEW:'待创建',RUNNING:'执行中',READY:'可继续',FAILED:'执行失败',INTERRUPTED:'已中断，可恢复',RECOVERY_REQUIRED:'需要检查恢复'};
 $('#session-info').innerHTML='<dl><dt>站内对话</dt><dd>'+esc(cid)+'</dd><dt>执行方式</dt><dd>'+esc(route?.mode==='MCP'?route.harness:route?.mode||'尚未配置')+'</dd>'+(route?.harness==='DSH'&&route.mode==='MCP'?'<dt>DSH 会话</dt><dd>'+esc(session?.session_id||'发送第一条消息后创建')+' · '+esc(labels[session?.state]||'待创建')+'</dd><dt>共享工作区</dt><dd>'+esc(session?.cwd||state.agents?.dsh_workspace)+'</dd><dt>会话位置</dt><dd>站内管理的 DSH headless 会话。当前不在 DSH Desktop 列表中；工作目录相同不会自动登记桌面会话。</dd>':'')+'</dl><a href="/?view=models#dsh-sessions">管理连接与会话恢复 →</a>';
}
async function refresh(){
 if(!cid)return;if(refreshing){queued=true;return;}refreshing=true;
 try{do{queued=false;const [state,messages]=await Promise.all([api('state'),api('messages?conversation_id='+encodeURIComponent(cid))]);
 const list=$('#messages'),follow=first||bottom(),html=messages.map(m=>'<article class="message '+(m.role==='user'?'user':'assistant')+'"><div class="avatar" aria-hidden="true">'+(m.role==='user'?'我':'A')+'</div><div class="bubble"><div class="messageheader"><strong>'+(m.role==='user'?'你':'主 Agent')+'</strong><time>'+esc(new Date(m.created_at).toLocaleString('zh-CN',{hour12:false}))+'</time></div><div class="messagetext">'+messageContent(m)+'</div></div></article>').join('')||`<div class="agent-empty"><div class="welcome-emblem">${icon('compass')}</div><h2>一起配好你的学习空间</h2><p>从了解工作台开始，找到适合你的模型和学习方式。</p><div class="agent-starters"><button type="button" data-prompt="介绍一下站点有哪些功能">${icon('grid')}<strong>了解工作台</strong><span>从目标、资料到学习反馈</span></button><button type="button" data-prompt="帮我按低成本选择各个功能的模型配置">${icon('settings')}<strong>搭配学习模型</strong><span>按预算和用途选择 AI</span></button><button type="button" data-prompt="API 和 MCP 宿主有什么区别？">${icon('book')}<strong>了解连接方式</strong><span>理清 API 与 MCP 的区别</span></button></div></div>`;
 if(lastHTML!==html){const oldTop=list.scrollTop;list.innerHTML=html;enhanceMessages(list);lastHTML=html;if(follow)jump();else{list.scrollTop=oldTop;$('#jump-latest').hidden=false;}}first=false;
 $('#status').innerHTML=state.jobs.filter(j=>j.conversation_id===cid&&['QUEUED','RUNNING'].includes(j.status)).map(j=>{
  const task=state.models.tasks.find(t=>t.job_id===j.id),runs=task?.mode==='API'?state.models.runs:state.agents?.runs||[],run=runs.find(r=>r.job_id===j.id&&r.status==='RUNNING'),failure=runs.find(r=>r.job_id===j.id&&r.status==='FAILED');
  const model=run?.model_name||run?.model||'',label=j.status==='RUNNING'?'正在处理':task?.blocked?(failure?.error||'未能完成，请检查配置后重试'):'等待处理';
  return `<div class="agent-job ${task?.blocked?'blocked':''}"><span class="status-dot" aria-hidden="true"></span><div class="job-description"><span>${esc(label)}</span>${run?`<span class="job-timing" aria-live="off" data-elapsed-start="${esc(run.created_at)}">${Math.max(0,Math.floor((Date.now()-Date.parse(run.created_at))/1000))} 秒</span>`:''}${model?`<small title="${esc((run.model_provider||'')+'/'+model)}">${esc(model)}</small>`:''}${run?.tool_calls?`<small>已调用 ${run.tool_calls} 次工具</small>`:''}</div><div class="row"><button class="small ghost" data-cancel="${j.id}">停止</button>${task?.blocked?`<button class="small" data-retry="${j.id}">重试</button>`:''}</div></div>`;
 }).join('');
 $('#agent-version').textContent='V'+state.version;sessionInfo(state);bindDshModelPicker($('#agent-chat'),state,cid,'master');enhanceComposer($('#agent-chat'));bindReplyStream(list,cid,messages,'master');
 }while(queued);}finally{refreshing=false;}
}
$('#content').oninput=()=>{request=null;persistDraft();};
$('#content').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('#agent-chat').requestSubmit();}};
$('#agent-chat').onsubmit=async e=>{e.preventDefault();const input=$('#content'),content=input.value.trim();if(busy||!cid||!content)return;busy=true;$('#send').disabled=true;setSendButton($('#send'),true);showError(null);
 try{request??=crypto.randomUUID();const submitted=input.value;await api('messages',{conversation_id:cid,content,request_id:request});request=null;if(input.value===submitted){input.value='';persistDraft();}first=true;await refresh();input.focus();}catch(error){showError(error);}finally{busy=false;$('#send').disabled=false;setSendButton($('#send'));resizeComposer($('#content'));}};
$('#messages').addEventListener('reply-stream-painted',()=>{$('#jump-latest').hidden=bottom();});
$('#messages').onscroll=()=>{$('#jump-latest').hidden=bottom();};$('#jump-latest').onclick=jump;
$('#session-toggle').onclick=()=>{const show=$('#session-info').hidden;$('#session-info').hidden=!show;$('#session-toggle').setAttribute('aria-expanded',String(show));};
document.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button)return;if(button.dataset.prompt){$('#content').value=button.dataset.prompt;persistDraft();resizeComposer($('#content'));$('#content').focus();return;}if(!button.dataset.cancel&&!button.dataset.retry)return;button.disabled=true;try{showError(null);if(button.dataset.cancel)await api('jobs/cancel',{id:button.dataset.cancel});else await api('agents/retry',{job_id:button.dataset.retry});await refresh();}catch(error){showError(error);button.disabled=false;}});
try{const c=await api('agents/conversation',{});cid=c.conversation_id;try{$('#content').value=localStorage.getItem('teacher-master-draft:'+cid)||'';}catch{}await refresh();$('#send').disabled=false;watchUpdates(refresh,{onError:()=>{$('#draft-status').textContent='连接正在恢复，草稿保存在本机';},onOpen:()=>{$('#draft-status').textContent='Enter 发送，Shift + Enter 换行';}});}catch(error){showError(error);$('#send').disabled=true;}

window.addEventListener('dsh-model-changed',()=>refresh().catch(showError));
