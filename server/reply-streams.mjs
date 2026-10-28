// Volatile previews only. SQLite messages remain the authority after writeback.
export function replyStreams({publish=()=>{},clock=Date.now,ttlMs=120000,maxEntries=100}={}){
 const rows=new Map();let revision=0;
 const trim=()=>{for(const [id,row] of rows)if(row.status!=='GENERATING'&&clock()-row.updated_ms>ttlMs)rows.delete(id);while(rows.size>maxEntries)rows.delete(rows.keys().next().value);};
 const expose=row=>{const {updated_ms,...value}=row;return value;};
 function send(row){row.revision=++revision;row.updated_ms=clock();publish(expose(row));}
 function update(run,event){
  trim();if(!event||!['reset','delta','discard'].includes(event.kind)||typeof event.attempt!=='string'||event.attempt.length>300||!Number.isSafeInteger(event.sequence)||event.sequence<1)return false;
  let row=rows.get(run.runId);if(row&&event.sequence<=row.sequence)return false;
  if(event.kind==='reset'){
   row={run_id:run.runId,conversation_id:run.job.conversation_id,job_id:run.job.id,reply_to:run.job.message_id,role:run.role,attempt:event.attempt,sequence:event.sequence,content:'',status:'GENERATING',message_id:null};rows.set(run.runId,row);
  }else{
   if(!row||row.attempt!==event.attempt||row.status!=='GENERATING')return false;
   if(event.sequence!==row.sequence+1){row.status='INTERRUPTED';row.sequence=event.sequence;send(row);return false;}
   if(event.kind==='delta'){if(typeof event.delta!=='string'||row.content.length+event.delta.length>20000)return false;row.content+=event.delta;row.status='GENERATING';}else{row.content='';row.status='DISCARDED';}
   row.sequence=event.sequence;
  }
  send(row);trim();return true;
 }
 function finish(runId,status,message){const row=rows.get(runId);if(!row)return;if(message){row.content=message.content;row.message_id=message.id;row.status='COMPLETED';}else row.status=status;send(row);}
 function list(){trim();return [...rows.values()].map(expose);}
 return {update,finish,list};
}
