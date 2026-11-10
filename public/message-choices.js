const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=value=>Array.from(String(value),c=>c.codePointAt(0).toString(16)).join('-');
const keyFor=message=>JSON.stringify([message.conversation_id,message.id]);
function valid(message){
 const choice=message?.choice;
 return message?.role==='assistant'&&message.id&&message.conversation_id&&choice&&['SINGLE','MULTIPLE'].includes(choice.type)&&['OPEN','ANSWERED','STALE','DISABLED'].includes(choice.status)&&Array.isArray(choice.options)&&choice.options.length>=2&&choice.options.length<=8&&choice.options.every(o=>o&&typeof o.id==='string'&&o.id&&typeof o.text==='string'&&o.text.trim())&&new Set(choice.options.map(o=>o.id)).size===choice.options.length;
}

// State belongs to a question, not to the current route or the message composer.
export function createChoiceController({api,onChange=()=>{},onError=()=>{},onSuccess=()=>{},requestId=()=>crypto.randomUUID()}={}){
 const entries=new Map(),bound=new WeakSet();
 function remember(message,{disabled=false}={}){
  if(!valid(message))return null;
  const key=keyFor(message),signature=JSON.stringify([message.choice.type,message.choice.options]);
  let entry=entries.get(key);
  if(!entry){entry={key,selected:[],requests:new Map(),pending:false,submitted:false,error:''};entries.set(key,entry);}
  if(entry.signature!==signature){entry.selected=[];entry.requests.clear();entry.signature=signature;}
  entry.message=message;entry.disabled=disabled;
  if(message.choice.status!=='OPEN'){
   entry.selected=message.choice.selected_option_ids?.filter(id=>message.choice.options.some(o=>o.id===id))||[];
   entry.error='';
  }
  return entry;
 }
 const editable=entry=>entry&&entry.message.choice.status==='OPEN'&&!entry.disabled&&!entry.pending&&!entry.submitted;
 function html(entry){
  const {message,selected,pending,error}=entry,choice=message.choice,open=editable(entry),multiple=choice.type==='MULTIPLE';
  const prefix='choice-'+token(entry.key),statusId=prefix+'-status';
  let status=multiple?'可选择多项，选好后点击“提交选择”。':'单选题，点击一个选项即可提交。';
  if(choice.status==='ANSWERED')status=selected.length?'已提交选择，原始作答已保留。':'已通过文字作答，原始回答已保留。';
  else if(choice.status==='STALE')status='这道题已不是当前问题，保留供回看。';
  else if(choice.status==='DISABLED'||entry.disabled)status='当前记录只读，不能提交选择。';
  else if(pending)status='正在提交选择…';
  else if(entry.submitted)status='选择已保存，等待 Teacher 回复。';
  return `<section class="message-choices" data-choice-card="${escape(entry.key)}" data-choice-status="${escape(choice.status)}" aria-label="${multiple?'多选题':'单选题'}选项" aria-describedby="${statusId}" aria-busy="${pending}"><div class="message-choice-options" role="group" aria-label="${multiple?'可多选':'点击选项直接提交'}">${choice.options.map((option,i)=>`<button type="button" id="${prefix}-option-${i}" class="message-choice-option${selected.includes(option.id)?' is-selected':''}" data-choice-option="${escape(option.id)}" ${multiple?`aria-pressed="${selected.includes(option.id)}"`:''} ${open?'':'disabled'}><span class="message-choice-mark" aria-hidden="true">${selected.includes(option.id)?'✓':''}</span><span class="message-choice-label">${escape(option.id)}</span><span class="message-choice-text">${escape(option.text)}</span>${!multiple&&selected.includes(option.id)?'<span class="message-choice-selected">已选</span>':''}</button>`).join('')}</div><p class="message-choice-status" id="${statusId}" role="status">${status}</p>${error?`<p class="message-choice-error" role="alert">${escape(error)}；请重试提交。</p>`:''}${multiple?`<button type="button" id="${prefix}-submit" class="primary message-choice-submit" data-choice-submit ${open&&selected.length?'':'disabled'}>${pending?'正在提交…':entry.submitted||choice.status==='ANSWERED'?'已提交':'提交选择'}</button>`:''}</section>`;
 }
 function view(message,options){const entry=remember(message,options);return entry?html(entry):'';}
 function patch(root,key){
  const entry=entries.get(key);if(!entry||!root)return;
  const card=[...root.querySelectorAll('[data-choice-card]')].find(node=>node.dataset.choiceCard===key);if(!card)return;
  const document=card.ownerDocument,active=document.activeElement,focusId=card.contains(active)?active.id:null;
  const template=document.createElement('template');template.innerHTML=html(entry);const next=template.content.firstElementChild;card.replaceWith(next);
  if(focusId){const replacement=document.getElementById(focusId);if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});}
 }
 async function submit(key){
  const entry=entries.get(key);if(!editable(entry)||!entry.selected.length)return false;
  const {message}=entry,option_ids=message.choice.options.filter(o=>entry.selected.includes(o.id)).map(o=>o.id);
  const fingerprint=JSON.stringify(option_ids);if(!entry.requests.has(fingerprint))entry.requests.set(fingerprint,requestId());
  const request_id=entry.requests.get(fingerprint);
  entry.pending=true;entry.error='';onChange(key);
  let result;
  try{result=await api('messages',{conversation_id:message.conversation_id,choice_answer:{question_message_id:message.id,option_ids},request_id});}
  catch(error){entry.pending=false;entry.error=error.message||'提交未确认';onChange(key);onError(entry.error);return false;}
  entry.pending=false;entry.submitted=true;onChange(key);
  try{await onSuccess(result,{conversation_id:message.conversation_id,question_message_id:message.id});}catch(error){onError(error.message||'刷新记录失败');}
  return true;
 }
 async function choose(key,optionId){
  const entry=entries.get(key);if(!editable(entry)||!entry.message.choice.options.some(o=>o.id===optionId))return false;
  if(entry.message.choice.type==='SINGLE'){entry.selected=[optionId];return submit(key);}
  entry.selected=entry.selected.includes(optionId)?entry.selected.filter(id=>id!==optionId):[...entry.selected,optionId];entry.error='';onChange(key);return true;
 }
 function bind(root){
  if(!root||bound.has(root))return;bound.add(root);
  root.addEventListener('click',event=>{
   const button=event.target.closest?.('[data-choice-option],[data-choice-submit]');if(!button||button.disabled||!root.contains(button))return;
   const card=button.closest('[data-choice-card]');if(!card)return;event.preventDefault();
   if(button.hasAttribute('data-choice-option'))void choose(card.dataset.choiceCard,button.dataset.choiceOption);
   else void submit(card.dataset.choiceCard);
  });
 }
 return {view,bind,patch,choose,submit};
}
