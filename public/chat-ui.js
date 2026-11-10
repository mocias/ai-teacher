const paths={book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z M13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2',home:'m3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9',chat:'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2z M7 9h10 M7 13h6',compass:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z m4-16-2 8-8 2 2-8z',settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',folder:'M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',arrow:'M12 19V5 m-6 6 6-6 6 6',copy:'M9 9h11v12H9z M15 9V3H3v12h6',check:'m5 12 4 4L19 6',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3a8 8 0 0 1 16 0v3',route:'M4 5h12a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h12 M4 2v6 M20 18v6',clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',note:'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5'};
export const icon=name=>`<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.chat}"/></svg>`;
export function agentNavigation(){return `<a class="brand" href="/" aria-label="返回学习概览"><span class="brandmark">${icon('book')}</span><span>AI Teacher<small>个人学习工作台</small></span></a><div class="navlabel">工作空间</div><nav class="agent-navigation" aria-label="工作空间导航"><a href="/">${icon('home')}<span>学习概览</span></a><a href="/?view=chat">${icon('chat')}<span>Teacher 对话</span></a><a href="/agents.html" class="active" aria-current="page">${icon('compass')}<span>AI 设置助手</span></a><div class="navlabel">学习管理</div><a href="/?view=journey">${icon('route')}<span>目标进度</span></a><a href="/?view=resources">${icon('folder')}<span>资料库</span></a><a href="/?view=notes">${icon('note')}<span>我的笔记</span></a></nav><div class="agent-rail-footer"><a href="/?view=models">${icon('settings')}<span>模型与分工</span></a><span class="localtag">学习记录保存在本机</span><span class="workspace-version" id="agent-version"></span></div>`;}
export function setSendButton(button,busy=false){if(!button)return;button.innerHTML=icon(busy?'clock':'arrow')+`<span class="sr-only">${busy?'正在保存…':'发送消息'}</span>`;button.classList.add('chat-send');button.setAttribute('aria-label',busy?'正在保存消息':'发送消息');button.title='发送消息 (Enter)';}
export function resizeComposer(input){if(!input)return;const top=input.scrollTop,formStyle=input.closest('form')?.style,maximum=Number.parseFloat(formStyle?.getPropertyValue('--composer-editor-height'))||160;if(formStyle?.getPropertyValue('--composer-editor-auto')!=='0')formStyle?.setProperty('--composer-editor-auto','1');input.style.height='auto';input.style.height=Math.min(maximum,Math.max(48,input.scrollHeight))+'px';input.style.overflowY=input.scrollHeight>maximum?'auto':'hidden';input.scrollTop=top;}
const keyboardForms=new WeakSet();
export function bindComposerKeys(form){if(keyboardForms.has(form))return;keyboardForms.add(form);form.addEventListener('keydown',event=>{
 if(!event.target.matches('textarea')||event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||event.isComposing||event.keyCode===229||event.defaultPrevented)return;
 event.preventDefault();event.stopPropagation();const send=form.querySelector('button[type=submit],#send');if(!send?.disabled&&(event.target.value.trim()||Number(form.dataset.attachmentCount)>0))form.requestSubmit(send||undefined);
 },true);}
export function enhanceComposer(form){
 if(!form)return;bindComposerKeys(form);form.classList.add('conversation-composer');const input=form.querySelector('textarea');if(input){input.rows=1;input.autocomplete='off';resizeComposer(input);}
 let bar=form.querySelector('.composerbar,.composer-actions');if(!bar){bar=document.createElement('div');bar.className='composerbar';form.append(bar);const send=form.querySelector('button[type=submit],#send');if(send)bar.append(send);}
 bar.classList.add('composerbar');let tools=bar.querySelector('.composer-tools');if(!tools){tools=document.createElement('div');tools.className='composer-tools';bar.prepend(tools);}
 const picker=form.querySelector('.dsh-model-picker');if(picker)tools.prepend(picker);
 const kind=form.querySelector('#task-kind');if(kind&&!tools.contains(kind)){const label=form.querySelector('label[for=task-kind]');if(label){label.className='sr-only';tools.append(label);}tools.append(kind);}
 setSendButton(form.querySelector('button[type=submit],#send'));
}
export function enhanceMessages(container){if(!container)return;for(const reply of container.querySelectorAll('.message.assistant:not(.reply-preview),.conversation-line.assistant:not(.reply-preview),article.bubble.assistant:not(.reply-preview)')){const content=reply.querySelector('.markdown-body');if(!content||reply.querySelector('[data-copy-reply]'))continue;const actions=document.createElement('div');actions.className='message-actions';actions.innerHTML=`<button type="button" data-copy-reply aria-label="复制回复" title="复制回复">${icon('copy')}<span>复制</span></button>`;(reply.querySelector('.bubble,.conversation-bubble')||reply).append(actions);}}
function tick(){if(document.hidden)return;for(const node of document.querySelectorAll('[data-elapsed-start]')){const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(node.dataset.elapsedStart))/1000));node.textContent=seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;}}
if(globalThis.document){document.addEventListener('input',event=>{if(event.target.matches('.conversation-composer textarea'))resizeComposer(event.target);});document.addEventListener('click',async event=>{const copy=event.target.closest('[data-copy-reply]');if(!copy)return;const content=copy.closest('.message,.conversation-line,article.bubble')?.querySelector('.markdown-body');if(!content)return;try{await navigator.clipboard.writeText(content.innerText);copy.innerHTML=icon('check')+'<span>已复制</span>';copy.setAttribute('aria-label','回复已复制');}catch{copy.innerHTML=icon('copy')+'<span>请选中文字复制</span>';}});const timer=setInterval(tick,1000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});}

// null means the reader was following the latest turn. A numeric offset (even
// zero) means they were reading history when the list was about to change.
export function readingPosition(list){
 if(!list||list.scrollHeight-list.clientHeight-list.scrollTop<80)return null;
 return list.scrollTop;
}
export function restoreReadingPosition(list,position=null){
 if(list)list.scrollTo({top:position??list.scrollHeight,behavior:'instant'});
}

// Keep the live editor and every ancestor attached: moving even the same textarea
// out of the document cancels Chromium's native IME session and undo history.
export function renderKeepingInput(root,html,selector){
 const live=selector&&root.querySelector(selector),template=document.createElement('template');template.innerHTML=html;
 const fresh=selector&&template.content.querySelector(selector);
 if(!live||!fresh){root.replaceChildren(template.content);return;}
 const attributes=(old,next)=>{for(const a of [...old.attributes])if(!next.hasAttribute(a.name)&&!(old.tagName==='DETAILS'&&a.name==='open'))old.removeAttribute(a.name);for(const a of next.attributes)if(old.getAttribute(a.name)!==a.value)old.setAttribute(a.name,a.value);};
 function patch(old,next){
  if(old===live){attributes(old,next);return;}
  const branch=[...old.children].find(n=>n===live||n.contains(live));
  const nextBranch=[...next.children].find(n=>n===fresh||n.contains(fresh));
  attributes(old,next);
  if(!branch||!nextBranch)throw Error('Editor ancestor missing');
  for(const n of [...old.childNodes])if(n!==branch)n.remove();
  for(const n of [...next.childNodes]){if(n===nextBranch)break;old.insertBefore(n,branch);}
  for(const n of [...nextBranch.parentNode.childNodes].slice([...nextBranch.parentNode.childNodes].indexOf(nextBranch)+1))old.append(n);
  patch(branch,nextBranch);
 }
 // A fragment has no attributes, so patch through an unattached matching shell.
 const shell=document.createElement(root.tagName);shell.append(template.content);
 for(const a of root.attributes)shell.setAttribute(a.name,a.value);
 patch(root,shell);
}

// File names and identifiers are untrusted message content.
export function messageAttachments(message){
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 return message.attachments?.length?`<div class="message-attachments" aria-label="消息附件">${message.attachments.map(file=>`<div class="message-attachment"><strong>${esc(file.name)}</strong><small>${Number.isFinite(file.size)?(file.size/1024).toFixed(1)+' KB · ':''}${file.content_status==='READABLE'?'文字已提取，Teacher 按上下文限额读取摘录':esc(file.unavailable_reason||file.extraction_reason||'未提取文字，Teacher 只能看到文件信息')}</small><div>${file.resource_id?`<button type="button" class="small ghost" data-action="reader-open" data-id="${esc(file.resource_id)}">打开资料</button><a href="/api/resource-file?id=${encodeURIComponent(file.resource_id)}" download="${esc(file.name)}">下载原文件</a>`:''}</div></div>`).join('')}</div>`:'';
}
