import {readingPosition,restoreReadingPosition,enhanceComposer,enhanceMessages} from './chat-ui.js';
import {bindDshModelPicker} from './dsh-model-picker.js';
import {watchUpdates} from './live-events.js';
import {bindReplyStream} from './reply-stream.js';
import {messageContent} from './message-content.js';
import {knowledgeProfileView} from './knowledge-profile.js';
import {bindComposerResize} from './layout-resize.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const api=async(path,body)=>{const response=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};
const kickoff='请用2～3分钟的对话了解我的背景、学习方向、基础、时间和偏好，每轮一个问题。';
history.scrollRestoration='manual';
const params=new URLSearchParams(location.search),embedded=params.get('embedded')==='1',embeddedDraft='teacher.home.profile.draft';
let state,cid=params.get('conversation'),active=embedded||!!cid,busy=false,request=null,refreshing=false,knowledgeProfileFull=null,knowledgeProfileSignature='';
if(embedded){document.body.classList.add('personal-embedded');try{$('#message').value=sessionStorage.getItem(embeddedDraft)||'';}catch{}}
const drafts=new Map();
let lastMessages='';
const showError=error=>{$('#error').textContent=error.message;};

function showSection(){
 $('#overview').hidden=active;
 $('#conversation-view').hidden=!active;
 $('#conversation').hidden=!active||(!cid&&!embedded);
 document.body.classList.toggle('conversation-open',active);
}
function routeReady(){
 const s=state.study.settings;
 const role=state.agents?.routes.find(route=>route.role==='onboarding');
 const legacy=state.models.routes.find(route=>route.module==='chat');
 return state.agents?.enabled?(role?.mode==='MCP'||(role?.mode==='API'&&state.models.enabled)):(state.models.enabled&&legacy?.profile_id)||state.hostAutomation.settings.enabled;
}
function renderOverview(){
 const settings=state.study.settings;
 $('#profile').textContent=settings.profile||'尚无已确认的整体画像。完成简短对话后，你可以先检查建议，再决定是否采用。';
 const introFinished=['DONE','EXISTING'].includes(settings.onboarding);
 const canContinue=settings.onboarding!=='EXISTING'&&state.study.chats.some(chat=>chat.kind==='ONBOARDING');
 const action=introFinished?(canContinue?'<button class="personal-primary" data-action="open-intro">继续对话修正画像</button>':''):
   routeReady()?'<button class="personal-primary" data-action="start">开始 / 继续自我介绍 <span aria-hidden="true">→</span></button>':
   '<p class="notice">请先在“模型与分工”中为首次画像引导配置 API 或宿主。</p><a class="personal-config-link" href="/?view=models">前往配置 AI →</a>';
 $('#intro').innerHTML=`<p class="card-kicker">首次引导</p><h2>用 2～3 分钟认识你</h2><p>聊聊你的背景、学习方向、基础、时间和偏好。每轮只问一个问题。</p><div class="personal-card-actions">${action}${!introFinished?'<button class="personal-text-button" data-action="skip-intro">暂时跳过</button>':''}</div>`;
 const progress=state.study.progress.slice(0,5);
 $('#reading').innerHTML=progress.length?progress.map(item=>`<div class="reading-item"><strong>${esc(item.title)}</strong><span>${esc(item.location)}</span></div>`).join(''):'<p class="empty-note">还没有阅读记录。</p>';
 $('#knowledge-profile').innerHTML=knowledgeProfileView(state);
}
function jobStatus(job){
 const task=state.models.tasks.find(item=>item.job_id===job.id);
 const runs=task?.agent_role?state.agents?.runs||[]:task?.mode==='API'?state.models.runs:state.hostAutomation?.runs||[];
 const failed=(runs||[]).find(run=>run.job_id===job.id&&run.status==='FAILED');
 const olderFailure=state.hostAutomation?.runs.find(run=>run.job_id===job.id&&run.status==='FAILED')||state.models.runs.find(run=>run.job_id===job.id&&run.status==='FAILED');
 const error=failed?.error||olderFailure?.error;
 let message=job.status==='RUNNING'?'正在处理，回复会自动显示…':task?.blocked?(error||'处理未完成，请检查连接后重试。'):task?.mode==='UNCONFIGURED'?'请先配置首次画像引导，再重试此条消息。':task?.mode==='MCP'?'已保存，等待所选宿主处理…':task?.mode==='API'?'已保存，等待模型回答…':'已保存，等待宿主回答…';
 const actions=job.status==='QUEUED'?`${task?.blocked?`<button data-action="retry" data-id="${esc(job.id)}">重试</button>`:''}<button data-action="cancel" data-id="${esc(job.id)}">取消处理</button>`:'';
 return `<div class="conversation-status ${task?.blocked?'is-blocked':''}" data-job-status="${esc(job.id)}" role="status"><span class="status-dot" aria-hidden="true"></span><div><span>${esc(message)}</span>${actions?`<div class="status-actions">${actions}</div>`:''}</div></div>`;
}
function renderMessages(messages){
 const list=$('#messages'),position=list.dataset.rendered===cid?readingPosition(list):null;
 const byMessage=new Map(state.jobs.filter(job=>job.conversation_id===cid).map(job=>[job.message_id,job]));
 const html=messages.map(message=>{
  const job=byMessage.get(message.id);
  const waiting=job&&['QUEUED','RUNNING'].includes(job.status)?jobStatus(job):'';
  if(message.role==='user'&&message.content===kickoff)return waiting;
  const sender=message.role==='user'?'你':'AI Teacher';
  return `<div class="conversation-line ${message.role}" data-message-id="${esc(message.id)}"><article class="conversation-bubble"><small>${sender}</small><div class="personal-message-content">${messageContent(message)}</div></article></div>${waiting}`;
 }).join('');
 const signature=cid+':'+html;
 if(lastMessages!==signature){lastMessages=signature;list.innerHTML=html||'<div class="conversation-empty">'+(embedded?'可以先说说你的学习方向、已有基础或平时的学习习惯。':'开始后，AI 会在这里向你提问。')+'</div>';}
 enhanceMessages(list);list.dataset.rendered=cid;restoreReadingPosition(list,position);bindReplyStream(list,cid,messages,'personal');
}
function renderExtra(){
 $('#suggestions').innerHTML=state.study.suggestions.map(item=>`<section class="panel suggestion-card"><p class="card-kicker">等待你确认</p><h2>画像建议</h2><div class="profile-text">${esc(item.content)}</div><p>${esc(item.reason)}</p><div class="row"><button data-action="confirm" data-id="${esc(item.id)}">确认采用</button><button data-action="chat" data-id="${esc(item.conversation_id)}">继续对话修正</button><button data-action="reject" data-id="${esc(item.id)}">暂不采用</button></div></section>`).join('');
 const changes=state.study.changes.filter(item=>['WAITING_REASON','EXPLAINED','REVIEWING'].includes(item.status));
 $('#changes').hidden=!changes.length;
 $('#changes').innerHTML=changes.length?'<h2>关于最近的调整</h2>'+changes.map(item=>`<div class="change-item"><p>${esc(item.status==='REVIEWING'?'AI 正在判断这轮修改是否需要询问原因。':item.question||'这轮修改的解释已保存。')}</p>${item.status==='EXPLAINED'?`<p>${esc(item.reason)}</p>`:''}<button data-action="chat" data-id="${esc(item.conversation_id)}">解释 / 继续交流</button><button data-action="skip-change" data-id="${esc(item.id)}">跳过本次</button></div>`).join(''):'';
 $('#ability').hidden=!state.profiles.length;
 $('#ability').innerHTML=state.profiles.length?'<h2>有证据的目标能力画像</h2>'+state.profiles.map(item=>`<h3>${esc(state.goals.find(goal=>goal.id===item.goal_id)?.title)}</h3><p class="profile-text">${esc(item.content)}</p>`).join(''):'';
}
async function refresh(){
 if(refreshing)return;
 refreshing=true;
 try{
  state=await api('state');
  if(embedded){
   cid=state.study.chats.find(item=>item.kind==='ONBOARDING')?.conversation_id||cid;
   showSection();
   $('#chat-title').textContent='让 AI 了解我';
   renderMessages(cid?await api('messages?conversation_id='+encodeURIComponent(cid)):[]);
   if(cid)bindDshModelPicker($('#chat-form'),state,cid,'onboarding');
   enhanceComposer($('#chat-form'));bindComposerResize($('#chat-form'),'personalComposer');
   renderExtra();return;
  }
  const summary=state.learning?.knowledge_profile||{domains:[],nodes:[],proposals:[],topic_lineage:[],topic_proposals:[],curations:[]};
  const signature=JSON.stringify({nodes:summary.nodes.map(n=>[n.id,n.topic_id,n.total_judgments,n.conflicted,n.judgments.map(j=>j.id),n.explicit_references.map(r=>r.requirement_id),n.curations.map(c=>c.id)]),proposals:summary.proposals.map(p=>[p.id,p.status]),topics:summary.domains.flatMap(d=>d.topics.map(t=>[t.id,t.status,t.nodes.map(n=>n.id)])),topic_lineage:summary.topic_lineage.map(x=>x.id),topic_proposals:summary.topic_proposals.map(p=>[p.id,p.status])});
  if(!knowledgeProfileFull||signature!==knowledgeProfileSignature){knowledgeProfileFull=await api('knowledge-profile?full=1');knowledgeProfileSignature=signature;}
  state.learning.knowledge_profile=knowledgeProfileFull;
  renderOverview();showSection();
  if(active&&cid){
   const chat=state.study.chats.find(item=>item.conversation_id===cid);
   if(!chat){cid=null;active=false;showSection();return;}
   $('#chat-title').textContent=chat.kind==='ONBOARDING'?'认识你 · 可继续对话修正':'理解这次调整';
   renderMessages(await api('messages?conversation_id='+encodeURIComponent(cid)));bindDshModelPicker($('#message').closest('form'),state,cid);enhanceComposer($('#chat-form'));bindComposerResize($('#chat-form'),'personalComposer');
   renderExtra();
  }
 }finally{refreshing=false;}
}
async function openConversation(conversationId){
 cid=conversationId;active=true;request=null;
 history.replaceState(null,'','/personal.html?conversation='+encodeURIComponent(cid));
 showSection();await refresh();$('#conversation-view').scrollIntoView({behavior:'smooth',block:'start'});
}

document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-action]');if(!button)return;
 try{
  const action=button.dataset.action,id=button.dataset.id;$('#error').textContent='';
  if(action==='start'){const result=await api('study/onboarding',{action:'start',request_id:crypto.randomUUID()});await openConversation(result.conversation_id);return;}
  if(action==='open-intro'){const chat=state.study.chats.find(item=>item.kind==='ONBOARDING');if(chat)await openConversation(chat.conversation_id);return;}
  if(action==='knowledge-organize'){const nodeId=button.dataset.node,goalId=button.dataset.goal;let conversation=state.conversations.find(c=>c.goal_id===goalId&&c.kind==='PLANNING');if(!conversation)conversation=await api('conversations',{goal_id:goalId,title:'长期知识画像整理'});const node=state.learning.knowledge_profile.nodes.find(n=>n.id===nodeId),judgments=node?.judgments||[];await api('messages',{conversation_id:conversation.id,task_kind:'chat',learning_intent:'KNOWLEDGE_PROFILE',subject_id:nodeId,content:`请整理知识点 ${node?.name}（node_id=${nodeId}）的长期自然语言判断。只根据目录中该节点已有的实际作答判断与来源整理，不新增掌握分数，不删除或改写任何原判断。若 judgments 有相反关系，引用所有冲突 judgment_id，说明差异来自什么要求、目标或情境，并用 teacher_propose_knowledge_profile 提出一个保留语义差异的综合版本，等待我在画像页确认。来源 judgment_id：${judgments.map(j=>j.id).join(', ')}`,request_id:crypto.randomUUID()});location.href='/?view=chat&goal_id='+encodeURIComponent(goalId)+'&conversation_id='+encodeURIComponent(conversation.id);return;}
  if(action==='knowledge-topic-organize'){const topicId=button.dataset.topic,goalId=button.dataset.goal;let conversation=state.conversations.find(c=>c.goal_id===goalId&&c.kind==='PLANNING');if(!conversation)conversation=await api('conversations',{goal_id:goalId,title:'主题结构整理'});const topic=state.learning.knowledge_profile.domains.flatMap(d=>d.topics).find(t=>t.id===topicId);await api('messages',{conversation_id:conversation.id,task_kind:'chat',learning_intent:'TOPIC_REORGANIZATION',subject_id:topicId,content:`请检查主题「${topic?.name}」（topic_id=${topicId}）是否有清楚的语义边界。若拆分或合并确有必要，只能调用 teacher_propose_topic_reorganization 提交建议：拆分时将该主题所有现有 node_id 恰好分配一次到至少两个有意义的新主题；合并时只选择同一领域的目标主题，并保留所有 Node ID。说明语义理由，不改写要求、证据或回答；如果当前主题结构已经合适，请直接说明无需整理。`,request_id:crypto.randomUUID()});location.href='/?view=chat&goal_id='+encodeURIComponent(goalId)+'&conversation_id='+encodeURIComponent(conversation.id);return;}
  if(action==='knowledge-curation-accept'||action==='knowledge-curation-reject'){await api('knowledge-profile/decide',{proposal_id:id,accept:action==='knowledge-curation-accept',request_id:crypto.randomUUID()});await refresh();return;}
  if(action==='topic-reorganization-accept'||action==='topic-reorganization-reject'){await api('knowledge-profile/topic-decide',{proposal_id:id,accept:action==='topic-reorganization-accept',request_id:crypto.randomUUID()});await refresh();return;}
  if(action==='skip-intro'){await api('study/onboarding',{action:'skip'});await refresh();return;}
  if(action==='chat'){if(cid)drafts.set(cid,$('#message').value);await openConversation(id);$('#message').value=drafts.get(cid)||'';return;}
  if(action==='confirm'||action==='reject')await api('study/confirm',{id,accept:action==='confirm',request_id:crypto.randomUUID()});
  if(action==='skip-change')await api('study/skip',{id});
  if(action==='cancel')await api('jobs/cancel',{id});
  if(action==='retry'){
   const task=state.models.tasks.find(item=>item.job_id===id);
   await api(task?.agent_role?'agents/retry':'models/retry',task?.agent_role?{job_id:id}:{job_id:id,mode:task?.mode||'HOST'});
  }
  await refresh();
 }catch(error){showError(error);}
});
document.addEventListener('submit',async event=>{const topic=event.target.closest('.knowledge-topic-form');if(topic){event.preventDefault();const data=Object.fromEntries(new FormData(topic));await api('knowledge-profile/topics',{domain:topic.dataset.topicDomain,name:data.name,description:data.description,request_id:crypto.randomUUID()});await refresh();return;}const assignment=event.target.closest('.knowledge-node-topic-form');if(assignment){event.preventDefault();const data=Object.fromEntries(new FormData(assignment));await api('knowledge-profile/node-topic',{node_id:assignment.dataset.nodeTopic,topic_id:data.topic_id,reason:data.reason,request_id:crypto.randomUUID()});await refresh();}});
$('#overview-button').onclick=()=>{active=false;showSection();window.scrollTo({top:0,behavior:'smooth'});};
$('#message').oninput=()=>{request=null;if(cid)drafts.set(cid,$('#message').value);if(embedded)try{sessionStorage.setItem(embeddedDraft,$('#message').value);}catch{}};
$('#chat-form').onsubmit=async event=>{
 event.preventDefault();const submitted=$('#message').value;if(busy||!submitted.trim()||(!cid&&!embedded))return;restoreReadingPosition($('#messages'));busy=true;$('#send').disabled=true;
 try{if(!cid)cid=(await api('study/onboarding',{action:'open',request_id:crypto.randomUUID()})).conversation_id;
  const target=cid,kind=state.agents?.enabled?(state.study.chats.find(item=>item.conversation_id===target)?.kind||'ONBOARDING').toLowerCase():'chat',payload=JSON.stringify([target,submitted,kind]);const key=request?.payload===payload?request.key:crypto.randomUUID();request={payload,key};await api('messages',{conversation_id:target,content:submitted,request_id:key,task_kind:kind});if(request?.key===key)request=null;
  if(cid===target&&$('#message').value===submitted){drafts.delete(target);$('#message').value='';if(embedded)try{sessionStorage.removeItem(embeddedDraft);}catch{}}
  await refresh();
 }catch(error){showError(error);}finally{busy=false;$('#send').disabled=false;}
};
try{await refresh();window.scrollTo(0,0);watchUpdates(refresh,{onError:showError});}catch(error){showError(error);}

window.addEventListener('dsh-model-changed',()=>refresh().catch(showError));
