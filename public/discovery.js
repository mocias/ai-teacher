import {icon} from './chat-ui.js';
import {messageContent} from './message-content.js';
import {executionBanner} from './models.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields={direction:'学习方向',background:'当前基础',level:'期望达到的层级',outcome:'具体能做什么',exclusions:'本次暂不涉及的内容'};
let selected=localStorage.getItem('teacher-discussion'),messages=[],error='',pending=false;
const sendKeys=new Map();
const edits=new Map(),inputs=new Map(),timers=new Map(),chains=new Map();
export function discussionId(state){if(!selected||!state.discussions?.some(d=>d.conversation_id===selected))selected=state.discussions?.find(d=>!d.goal_id)?.conversation_id||state.discussions?.[0]?.conversation_id||null;if(selected)localStorage.setItem('teacher-discussion',selected);return selected;}
export function discussionMessages(value){messages=value;}
const editing=d=>edits.get(d.conversation_id);
const button=(action,label,extra='')=>`<button type="button" data-action="discovery-${action}" ${extra}>${label}</button>`;
export function discoveryView(state){const id=discussionId(state),d=state.discussions?.find(d=>d.conversation_id===id),local=d&&editing(d),draft={...d?.draft,...local?.draft},waiting=state.jobs.filter(j=>j.conversation_id===id&&['QUEUED','RUNNING'].includes(j.status)),complete=Object.keys(fields).every(k=>draft[k]?.trim());
 return `<section class="panel discovery"><div class="panelhead"><div><h2>从一个想法开始</h2><p class="help">聊聊你想学什么，一起找到具体的方向。</p></div>${button('new','＋ 新讨论','class="small"')}</div><div class="discussion-toolbar"><label class="sr-only" for="discussion-select">目标讨论记录</label><select id="discussion-select" aria-label="目标讨论记录">${(state.discussions||[]).map(x=>`<option value="${x.conversation_id}" ${x.conversation_id===id?'selected':''}>${esc(x.draft.direction||'新的目标讨论')} · ${x.goal_id?'已创建目标':'未完成'}</option>`).join('')}</select>${Object.values(draft).some(Boolean)?button('review',d?.suggestion?'查看修改建议':'查看目标草案','class="small"'):''}</div><div class="discovery-chat"><div class="discovery-messages" role="log" tabindex="0" aria-label="目标讨论记录" aria-live="polite">${messages.length?messages.map(m=>`<article class="message ${m.role}" data-reply-to="${esc(m.reply_to||'')}"><div class="avatar">${m.role==='user'?'我':'T'}</div><div class="bubble"><strong>${m.role==='user'?'你':'Teacher'}</strong><div class="messagetext">${messageContent(m)}</div></div></article>`).join(''):`<div class="empty discovery-empty"><div class="welcome-emblem">${icon('book')}</div><h3>今天，想弄懂什么？</h3><p>一个问题，也可以是一段新学习的开始。</p><div class="discovery-starters"><button type="button" data-discovery-prompt="我有一个想学习的方向，帮我把目标梳理清楚">梳理学习目标</button><button type="button" data-discovery-prompt="我想学习一个新领域，帮我找到适合的起点">找到学习起点</button></div></div>`}</div>${id?executionBanner(state,id):''}${waiting.length?`<div class="discovery-wait"><span>${waiting.some(j=>j.status==='RUNNING')?'Teacher 正在回复…':'消息已保存，等待模型或宿主处理。'}</span>${waiting.map(j=>`<button class="small ghost" data-action="cancel-job" data-id="${j.id}">取消</button>`).join('')}</div>`:''}${d?.goal_id?`<div class="draft-ready"><span>目标已创建，探索记录保留。</span>${button('open','进入 Teacher 对话','class="primary small"')}</div>`:`${complete?`<div class="draft-ready"><span>目标草案已就绪</span>${button('review','查看并确认','class="small"')}${button('confirm','确认创建',`class="primary small" ${pending||waiting.length?'disabled':''}`)}</div>`:''}<form id="discovery-composer"><label class="sr-only" for="discovery-input">与 AI 讨论学习目标</label><textarea id="discovery-input" maxlength="20000" rows="2" placeholder="说说你的想法，或希望自己能做到什么…">${esc(inputs.get(id)??d?.unsent??'')}</textarea><div class="composerbar"><small>讨论自动保存</small><button class="primary" type="submit" ${pending?'disabled':''}>${pending?'正在保存…':'发送消息 ↑'}</button></div></form>`}</div><p class="formerror" role="alert">${esc(error)}</p></section>`;
}
function queue(id,fn){const next=(chains.get(id)||Promise.resolve()).catch(()=>{}).then(fn);chains.set(id,next);return next;}
async function flush(id,env){clearTimeout(timers.get(id));return queue(id,async()=>{
 const local=edits.get(id);if(local){try{const saved=await env.api('discussions/draft',{conversation_id:id,revision:local.revision,draft:local.draft});if(edits.get(id)===local)edits.delete(id);else if(edits.has(id))edits.get(id).revision=saved.revision;env.updateDiscussion(saved);}catch(e){error=e.message;throw e;}}
 if(inputs.has(id))await env.api('discussions/input',{conversation_id:id,content:inputs.get(id)});
 });}
export function discoveryInput(event,env){const id=discussionId(env.state);if(!id)return;const d=env.state.discussions.find(x=>x.conversation_id===id);
 if(event.target.dataset.draftField){const existing=edits.get(id);edits.set(id,{revision:existing?.revision??d.revision,draft:{...existing?.draft,[event.target.dataset.draftField]:event.target.value}});document.querySelector('#draft-save-status').textContent='正在自动保存…';}
 else if(event.target.id==='discovery-input')inputs.set(id,event.target.value);else return;
 clearTimeout(timers.get(id));timers.set(id,setTimeout(()=>flush(id,env).then(()=>{error='';const status=document.querySelector('#draft-save-status');if(status)status.textContent='已自动保存';env.refresh();}).catch(e=>{error=e.message;env.toast('自动保存未完成：'+e.message);}),500));
}
export async function discoveryAction(action,node,env){error='';try{
 let id=discussionId(env.state),d=env.state.discussions.find(x=>x.conversation_id===id);
 if(action==='review'){
  env.dialog(d.goal_id?'已确认的目标':'目标草案',`<p class="help">${d.goal_id?'探索记录已保留。':'可在这里调整草案，保存后再确认创建目标。'}</p>${Object.entries(fields).map(([key,label])=>`<label for="review-${key}">${label}</label><textarea id="review-${key}" name="${key}" rows="2" maxlength="${key==='direction'?150:1000}" ${d.goal_id?'disabled':''}>${esc(d.draft[key]||'')}</textarea>`).join('')}${d.suggestion?`<div class="draft-suggestion"><h3>AI 的修改建议</h3>${Object.entries(d.suggestion).map(([key,value])=>`<p><strong>${fields[key]}</strong>：${esc(value)}</p>`).join('')}<p class="help">如需采用某项建议，可将它填入对应字段后保存。</p></div>`:''}`,async data=>{if(d.goal_id)return;const saved=await env.api('discussions/draft',{conversation_id:id,revision:d.revision,draft:data});env.updateDiscussion(saved);env.toast('目标草案已保存');});if(d.goal_id)document.querySelector('#dialog-form button[type=submit]').hidden=true;return;
 }
 if(action==='new'){if(id)await flush(id,env);const created=await env.api('discussions',{request_id:crypto.randomUUID()});selected=created.conversation_id;messages=[];await env.refresh();return;}
 if(action==='select'){if(id)await flush(id,env);selected=node.value;messages=[];await env.refresh();return;}
 if(action==='history'){if(id)await flush(id,env);selected=node.dataset.id;messages=[];env.home();await env.refresh();return;}
 if(action==='send'){
  const content=document.querySelector('#discovery-input').value.trim();if(!content||pending)return;pending=true;
  try{if(!id){const created=await env.api('discussions',{request_id:crypto.randomUUID()});id=selected=created.conversation_id;}await flush(id,env);const prior=sendKeys.get(id),key=prior?.content===content?prior.key:crypto.randomUUID();sendKeys.set(id,{content,key});await env.api('messages',{conversation_id:id,content,task_kind:'chat',request_id:key});sendKeys.delete(id);inputs.set(id,'');await env.api('discussions/input',{conversation_id:id,content:''});document.querySelector('#discovery-input').value='';document.querySelector('#discovery-input').blur();}finally{pending=false;}
 }else if(action==='confirm'){await flush(id,env);d=env.currentDiscussion(id);const result=await env.api('discussions/confirm',{conversation_id:id,revision:d.revision,request_id:crypto.randomUUID()});await env.openChat(result.conversation_id);return;
 }else if(action==='accept'||action==='reject'){await flush(id,env);d=env.currentDiscussion(id);await env.api('discussions/suggestion',{conversation_id:id,revision:d.revision,accept:action==='accept'});
 }else if(action==='open'){await env.openChat(d.target_conversation_id);return;}
 await env.refresh();
 }catch(e){error=e.message;env.toast(e.message);}
}
window.addEventListener('pagehide',()=>{
 for(const [id,local] of edits)navigator.sendBeacon('/api/discussions/draft',new Blob([JSON.stringify({conversation_id:id,revision:local.revision,draft:local.draft})],{type:'application/json'}));
 for(const [id,content] of inputs)navigator.sendBeacon('/api/discussions/input',new Blob([JSON.stringify({conversation_id:id,content})],{type:'application/json'}));
});
