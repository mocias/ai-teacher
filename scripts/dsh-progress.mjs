export const name='teacher-execution-progress';
export function progressProjector(emit,{clock=Date.now,heartbeatMs=3000}={}){
 let owner,sequence=0,lastPhase='',lastSignal=0;const accept=agent=>{if(!agent?.id)return false;owner??=agent.id;return owner===agent.id;};
 const send=data=>emit({type:'teacher_run_progress',sequence:++sequence,...data});
 const phase=value=>{if(lastPhase!==value||clock()-lastSignal>=heartbeatMs){lastPhase=value;lastSignal=clock();send({kind:'phase',phase:value});}};
 return {
  begin(agent){if(!agent?.id||agent.session?.header?.origin==='subagent')return;owner=agent.id;sequence=0;lastPhase='';lastSignal=0;},
  stream({agent,frame}){if(!accept(agent))return;if(frame.type==='start'){lastPhase='';phase('waiting');}else if(frame.type==='chunk'){const kind=frame.chunk?.type;if(kind==='reasoning-delta'||kind==='thinking-delta')phase('reasoning');else if(kind==='text-delta')phase('generating');else if(kind==='tool-call-delta'&&frame.chunk.name==='mcp__teacher_job__teacher_reply')phase('reply');}},
  toolStart(exec){if(accept(exec.agent))send({kind:'tool_start',name:exec.name,call_id:exec.callId});},
  toolEnd(exec,result){if(accept(exec.agent))send({kind:'tool_end',name:exec.name,call_id:exec.callId,failed:!!result.isError,code:typeof result.error?.info?.code==='string'?result.error.info.code.slice(0,80):undefined});}
 };
}
export function apply(ctx){const reporter=progressProjector(value=>process.stdout.write(JSON.stringify(value)+'\n'));ctx.on('session/event',(session,event)=>{if(event.type==='turn/end')process.stdout.write(JSON.stringify({type:'status',phase:'turn_end',sessionId:session.header.id,reason:{kind:event.data.reason.kind,...event.data.reason.kind==='error'?{error:{code:event.data.reason.error?.code}}:{}}})+'\n');});ctx.on('agent/inbox/claimed',({agent})=>reporter.begin(agent));ctx.on('agent/assistant-stream',reporter.stream);ctx.on('tools/execute',(exec,next)=>{reporter.toolStart(exec);return next();});ctx.on('tools/result',reporter.toolEnd);}
