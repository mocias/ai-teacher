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
 return `<section class="panel discovery"><div class="panelhead"><div><h2>从一个想法开始</h2><p class="help">还没想清楚学什么，也可以先聊聊。一起明确范围和层级，再整理成学习目标。</p></div>${button('new','＋ 新的目标讨论')}</div>${state.discussions?.length?`<label for="discussion-select">目标讨论记录</label><select id="discussion-select">${state.discussions.map(x=>`<option value="${x.conversation_id}" ${x.conversation_id===id?'selected':''}>${esc(x.draft.direction||state.conversations.find(c=>c.id===x.conversation_id)?.title||'新的目标讨论')} · ${x.goal_id?'已创建目标':'未完成'}</option>`).join('')}</select>`:''}<div class="discovery-grid"><div class="discovery-chat"><div class="discovery-messages" aria-live="polite">${messages.length?messages.map(m=>`<article class="message ${m.role}"><div class="avatar">${m.role==='user'?'我':'T'}</div><div class="bubble"><strong>${m.role==='user'?'你':'Teacher'}</strong><div class="messagetext">${esc(m.content)}</div></div></article>`).join(''):'<div class="empty"><h3>你最近想学些什么？</h3><p>可以说说想解决的问题，或希望自己能够做到的事。每次先聊清一个关键问题。</p></div>'}</div>${id?executionBanner(state,id):''}${waiting.length?`<p class="help">${waiting.some(j=>j.status==='RUNNING')?'Teacher 正在回复…':'消息已保存，等待普通对话的模型或宿主处理。'}</p><div class="row">${waiting.map(j=>`<button data-action="cancel-job" data-id="${j.id}">取消本条处理</button>`).join('')}</div>`:''}${d?.goal_id?`<p class="help">目标已创建，探索记录保留为只读。</p>${button('open','进入目标的 Teacher 对话','class="primary"')}`:`<form id="discovery-composer"><label for="discovery-input">与 AI 讨论学习目标</label><textarea id="discovery-input" maxlength="20000" rows="3" placeholder="例如：我想学大模型推理，但还不清楚应该学到什么程度…">${esc(inputs.get(id)??d?.unsent??'')}</textarea><div class="composerbar"><small>复用“普通对话”配置 · 讨论自动保存</small><button class="primary" type="submit" ${pending?'disabled':''}>${pending?'正在保存…':'发送消息 ↑'}</button></div></form>`}</div><aside class="discovery-draft"><h3>可编辑的目标草案</h3><p class="help">${Object.keys(draft).length?'可直接修改，也可以通过对话调整。':'随着讨论逐步补全，确认前不会创建正式目标。'}</p>${Object.entries(fields).map(([k,label])=>`<label for="draft-${k}">${label}</label><textarea id="draft-${k}" data-draft-field="${k}" rows="${k==='direction'?2:3}" maxlength="${k==='direction'?150:1000}" ${!d||d.goal_id?'disabled':''} placeholder="待讨论明确">${esc(draft[k]||'')}</textarea>`).join('')}<p class="help" id="draft-save-status">${local?'修改待保存':'已自动保存'}</p>${d?.suggestion?`<div class="draft-suggestion"><h3>AI 的修改建议</h3><p class="help">涉及你手动编辑过的内容，接受后才会更新。</p>${Object.entries(d.suggestion).map(([k,v])=>`<p><strong>${fields[k]}</strong><br>${esc(v)}</p>`).join('')}<div class="row">${button('accept','接受建议')}${button('reject','保留我的内容')}</div></div>`:''}${d&&!d.goal_id?button('confirm','确认并创建目标',`class="primary" ${!complete||pending||waiting.length?'disabled':''}`):''}<p class="help">已有目标名称、状态和画像摘要可作为背景；本次不关联材料。</p></aside></div><p class="formerror" role="alert">${esc(error)}</p></section>`;
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
