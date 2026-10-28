// DSH plugin: project only the public reply tool's content, never reasoning or
// arbitrary terminal/model text. stdout is owned by this one scoped child.
export const name='ai-teacher-reply-stream';
const toolName='mcp__teacher_job__teacher_reply';
function stringAt(raw,start){
 if(raw[start]!== '"')return null;let value='';
 for(let i=start+1;i<raw.length;i++){
  const c=raw[i];if(c==='"')return {value,end:i+1,complete:true};
  if(c.charCodeAt(0)<32)return null;
  if(c!=='\\'){value+=c;continue;}
  if(++i>=raw.length)break;const e=raw[i],esc={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
  if(e==='u'){if(i+4>=raw.length)break;const hex=raw.slice(i+1,i+5);if(!/^[\da-f]{4}$/i.test(hex))return null;value+=String.fromCharCode(parseInt(hex,16));i+=4;}
  else if(Object.hasOwn(esc,e))value+=esc[e];else return null;
 }
 // A surrogate split across provider chunks must not be rendered as a broken glyph.
 if(/[\uD800-\uDBFF]$/.test(value))value=value.slice(0,-1);
 return {value,complete:false};
}
export function replyPrefix(raw){
 let i=0;const ws=()=>{while(/\s/.test(raw[i]||'')&&i<raw.length)i++;};ws();if(raw[i++]!=='{')return null;
 while(i<raw.length){ws();if(raw[i]==='}')return null;const key=stringAt(raw,i);if(!key?.complete)return null;i=key.end;ws();if(raw[i++]!==':')return null;ws();
  if(key.value==='content')return stringAt(raw,i)?.value??null;
  const start=i;let depth=0,quoted=false,escaped=false;
  for(;i<raw.length;i++){const c=raw[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){if(depth===0)break;depth--;}if(depth===0&&c===',')break;}
  if(i===raw.length)return null;try{JSON.parse(raw.slice(start,i));}catch{return null;}if(raw[i++]!==',')return null;
 }
 return null;
}
export function replyProjector(emit,{delay=40}={}){
 let owner,attempt,blocks=new Map(),chosen=null,sent='',pending='',timer,sequence=0;
 const write=(kind,extra={})=>emit({type:'teacher_reply_stream',kind,attempt,sequence:++sequence,...extra});
 function flush(){clearTimeout(timer);timer=null;if(pending!==sent){if(!pending.startsWith(sent))write('reset');const delta=pending.startsWith(sent)?pending.slice(sent.length):pending;sent=pending;if(delta)write('delta',{delta});}}
 function clear(){clearTimeout(timer);timer=null;blocks.clear();chosen=null;sent='';pending='';}
 function handle({agent,frame}){
  if(!agent?.id||!frame)return;if(owner&&owner!==agent.id)return;
  if(frame.type==='start'){owner??=agent.id;clear();attempt=frame.attemptId;write('reset');return;}
  if(frame.attemptId!==attempt)return;
  if(frame.type==='end'){flush();if(frame.outcome?.kind!=='committed'||frame.outcome?.eventType!=='assistant/message'){write('discard');clear();}return;}
  const chunk=frame.chunk;if(frame.type!=='chunk'||chunk?.type!=='tool-call-delta')return;
  let block=blocks.get(chunk.index);if(!block){if(blocks.size>=32)return;block={name:'',raw:''};blocks.set(chunk.index,block);}if(chunk.name)block.name=chunk.name;
  if(typeof chunk.argumentsDelta!=='string'||block.raw.length+chunk.argumentsDelta.length>200000)return;
  block.raw+=chunk.argumentsDelta;if(block.name!==toolName)return;if(chosen!==null&&chosen!==chunk.index)return;chosen=chunk.index;
  const prefix=replyPrefix(block.raw);if(prefix===null||prefix.length>20000)return;pending=prefix;if(!timer){timer=setTimeout(flush,delay);timer.unref?.();}
 }
 return {handle,dispose(){flush();clear();}};
}
export function apply(ctx){
 const projector=replyProjector(event=>process.stdout.write(JSON.stringify(event)+'\n'));
 ctx.on('agent/assistant-stream',projector.handle);
 ctx.effect(()=>()=>projector.dispose());
}
