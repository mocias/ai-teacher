// Pending files belong to the conversation, never to a transient composer DOM.
export const CHAT_FILE_LIMIT=20*1024*1024;
export const CHAT_FILE_COUNT=5;
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const readBase64=file=>new Promise((resolve,reject)=>{
 const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('无法读取附件，请重新选择'));reader.onabort=()=>reject(Error('附件读取已取消'));reader.readAsDataURL(file);
});
export function createChatAttachments({api,onChange=()=>{},onError=()=>{},readFile=readBase64}={}){
 const queues=new Map();let sequence=0;
 const queue=conversation=>queues.get(conversation)||[];
 const changed=conversation=>onChange(conversation);
 function add(conversation,files){
  const incoming=Array.from(files||[]),existing=queue(conversation);if(!incoming.length)return [];
  if(existing.length+incoming.length>CHAT_FILE_COUNT)throw Error('每条消息最多添加 5 个附件');
  for(const file of incoming){if(!file||typeof file.name!=='string'||!file.name.trim()||/[\\/\x00-\x1f]/.test(file.name)||file.name.length>255)throw Error('附件文件名无效');if(!Number.isSafeInteger(file.size)||file.size<=0)throw Error('请选择非空文件');if(file.size>CHAT_FILE_LIMIT)throw Error('单个附件不能超过 20 MB');}
  if([...existing.map(entry=>entry.file),...incoming].reduce((total,file)=>total+file.size,0)>CHAT_FILE_LIMIT)throw Error('每条消息的附件总大小不能超过 20 MB');
  const entries=incoming.map(file=>({token:String(++sequence),uploadRequestId:crypto.randomUUID(),file,status:'ready',resourceId:null,error:'',operation:null}));queues.set(conversation,[...existing,...entries]);changed(conversation);return entries.map(entry=>entry.token);
 }
 function remove(conversation,token){queues.set(conversation,queue(conversation).filter(entry=>entry.token!==token));changed(conversation);}
 function snapshot(conversation){return queue(conversation).map(entry=>entry.token);}
 function clearSent(conversation,tokens){const sent=new Set(tokens);queues.set(conversation,queue(conversation).filter(entry=>!sent.has(entry.token)));changed(conversation);}
 function move(from,to){if(from===to||!queues.has(from))return;if(queue(to).length)throw Error('目标对话已有待发送附件');queues.set(to,queues.get(from));queues.delete(from);changed(to);}
 async function prepare(conversation,tokens=snapshot(conversation)){
  const resource_ids=[],sent=[];
  for(const token of tokens){
   const entry=queue(conversation).find(value=>value.token===token);if(!entry)continue;
   if(!entry.resourceId){
    if(!entry.operation){entry.status='uploading';entry.error='';changed(conversation);
     entry.operation=(async()=>{const base64=await readFile(entry.file);if(!queue(conversation).includes(entry))return;const result=await api('resources',{request_id:entry.uploadRequestId,title:entry.file.name.slice(0,200),file:{name:entry.file.name,base64},role:'REFERENCE'});if(!result?.id)throw Error('附件未保存，请重试');entry.resourceId=result.id;entry.status='saved';})().catch(error=>{entry.status='error';entry.error=error.message;throw error;}).finally(()=>{entry.operation=null;changed(conversation);});
    }
    try{await entry.operation;}catch(error){if(queue(conversation).includes(entry))throw error;}
   }
   if(queue(conversation).includes(entry)&&entry.resourceId){resource_ids.push(entry.resourceId);sent.push(token);}
  }
  return {resource_ids,tokens:sent};
 }
 function view(conversation,{disabled=false}={}){
  const entries=queue(conversation);return `<div class="chat-attachments" data-chat-attachments><div class="attachment-tools"><button type="button" data-attachment-pick ${disabled?'disabled':''} aria-label="添加附件" title="选择文件，或拖入对话">＋ 附件</button><input type="file" multiple hidden data-attachment-input aria-label="选择对话附件" ${disabled?'disabled':''}><small class="help">可拖入文件 · 最多 5 个，共 20 MB</small></div><div class="attachment-list" aria-live="polite">${entries.map(entry=>`<div class="attachment-item"><span>${escape(entry.file.name)}</span> <small>${(entry.file.size/1024).toFixed(1)} KB · ${entry.status==='uploading'?'正在保存…':entry.status==='error'?'保存未确认，可重试':entry.status==='saved'?'已保存，待发送':'待发送'}</small> <button type="button" data-attachment-remove="${entry.token}" ${disabled?'disabled':''} aria-label="移除附件 ${escape(entry.file.name)}">移除</button>${entry.error?`<span role="alert">${escape(entry.error)}</span>`:''}</div>`).join('')}</div></div>`;
 }
 function bind(root,conversation,{dropTarget=root,disabled=false}={}){
  if(!root)return;const controls=root.querySelector('[data-chat-attachments]');
  if(controls){const input=controls.querySelector('[data-attachment-input]');controls.onclick=event=>{if(disabled)return;const removeButton=event.target.closest('[data-attachment-remove]');if(removeButton){event.preventDefault();remove(conversation,removeButton.dataset.attachmentRemove);}else if(event.target.closest('[data-attachment-pick]'))input?.click();};if(input)input.onchange=()=>{try{if(!disabled)add(conversation,input.files);}catch(error){onError(error.message);}finally{input.value='';}};}
  if(!dropTarget)return;
  const hasFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
  dropTarget.ondragover=event=>{if(!hasFiles(event))return;event.preventDefault();event.dataTransfer.dropEffect=disabled?'none':'copy';};
  dropTarget.ondrop=event=>{if(!hasFiles(event))return;event.preventDefault();event.stopPropagation();if(disabled){onError('当前对话暂不能添加附件');return;}try{add(conversation,event.dataTransfer.files);}catch(error){onError(error.message);}};
 }
 return {add,remove,snapshot,clearSent,move,prepare,view,bind,count:conversation=>queue(conversation).length};
}
