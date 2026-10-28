import {messageContent} from './message-content.js';
import {liveEvents as events} from './live-events.js';
const streams=new Map(),bindings=new Map();let scheduled=false;
function paint(){
 scheduled=false;
 for(const [container,binding] of bindings){
  if(!container.isConnected){bindings.delete(container);continue;}
  const follow=container.scrollHeight-container.scrollTop-container.clientHeight<100,top=container.scrollTop,keep=new Set();
  const latest=new Map();for(const row of streams.values())if(!latest.has(row.job_id)||latest.get(row.job_id).revision<row.revision)latest.set(row.job_id,row);
  for(const row of latest.values()){
   if(row.conversation_id!==binding.cid||!row.content||row.status==='DISCARDED')continue;
   const saved=binding.messages.some(m=>m.role==='assistant'&&(m.id===row.message_id||m.reply_to===row.reply_to))||[...container.querySelectorAll('[data-reply-to]')].some(el=>el.dataset.replyTo===row.reply_to);
   if(saved)continue;keep.add(row.run_id);
   let element=[...container.querySelectorAll('[data-reply-preview]')].find(el=>el.dataset.replyPreview===row.run_id);
   if(!element){element=document.createElement('article');element.dataset.replyPreview=row.run_id;element.className=binding.variant==='personal'?'conversation-line assistant reply-preview':binding.variant==='reader'?'bubble assistant reply-preview':'message assistant reply-preview';container.querySelector('.agent-empty,.conversation-empty,.empty')?.remove();container.append(element);}
   const label=row.status==='GENERATING'?'正在生成 · 尚未保存':row.status==='COMPLETED'?'已保存，正在同步记录':row.status==='CANCELLED'?'已取消 · 此片段未保存':'回复中断 · 此片段未保存';
   const signature=row.revision+':'+row.status;if(element.dataset.signature===signature)continue;element.dataset.signature=signature;element.dataset.streamStatus=row.status;
   const content=messageContent({role:'assistant',content:row.content}),title=binding.variant==='master'?'主 Agent':'Teacher';
   if(binding.variant==='personal')element.innerHTML='<div class="conversation-bubble"><small>AI Teacher</small>'+content+'<div class="reply-stream-label" role="status">'+label+'</div></div>';
   else if(binding.variant==='reader')element.innerHTML='<small>Teacher</small>'+content+'<div class="reply-stream-label" role="status">'+label+'</div>';
   else element.innerHTML='<div class="avatar" aria-hidden="true">'+(binding.variant==='master'?'A':'T')+'</div><div class="bubble"><div class="messageheader"><strong>'+title+'</strong></div><div class="messagetext">'+content+'</div><div class="reply-stream-label" role="status">'+label+'</div></div>';
  }
  for(const element of container.querySelectorAll('[data-reply-preview]'))if(!keep.has(element.dataset.replyPreview))element.remove();
  if(follow)container.scrollTop=container.scrollHeight;else container.scrollTop=top;
  container.dispatchEvent(new CustomEvent('reply-stream-painted',{detail:{following:follow}}));
 }
}
function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(paint);}}
export function bindReplyStream(container,cid,messages=[],variant='chat'){
 if(!container||!cid)return;bindings.set(container,{cid,messages,variant});schedule();
}
events.addEventListener('open',()=>{streams.clear();schedule();});
events.addEventListener('reply-stream',event=>{
 let row;try{row=JSON.parse(event.data);}catch{return;}
 if(typeof row.run_id!=='string'||typeof row.content!=='string'||row.content.length>20000||!Number.isSafeInteger(row.revision))return;
 if((streams.get(row.run_id)?.revision||0)>=row.revision)return;streams.set(row.run_id,row);while(streams.size>100)streams.delete(streams.keys().next().value);schedule();
});
