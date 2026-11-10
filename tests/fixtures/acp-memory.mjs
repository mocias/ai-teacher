import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';
import {randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// In-process ACP transport. Each resumed session receives fresh MCP credentials;
// the process stays alive until the resident pool ends stdin or kills it.
export function acpMemoryProcess(options,{onPrompt,onComplete=()=>{},onError=()=>{}}){
 const child=new EventEmitter(),sessions=new Map(),decoder=new StringDecoder('utf8');
 child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
 let buffer='',queue=Promise.resolve(),closed=false;
 const close=code=>{if(!closed){closed=true;child.emit('close',code);}};
 const send=value=>child.stdout.write(JSON.stringify(value)+'\n');
 child.kill=()=>{close(1);return true;};
 async function handle(request){
  const {id,method,params={}}=request;let result={};
  try{
   if(method==='initialize')result={protocolVersion:1,agentCapabilities:{sessionCapabilities:{resume:{},close:{}}}};
   else if(method==='session/new'||method==='session/resume'){
    const sessionId=params.sessionId||randomUUID(),directory=join(options.env.DSH_HOME,'sessions',sessionId),log=join(directory,'session.jsonl');
    sessions.set(sessionId,{...params,log});mkdirSync(directory,{recursive:true});
    if(!existsSync(log))writeFileSync(log,JSON.stringify({type:'session',id:sessionId,cwd:params.cwd})+'\n');
    result={sessionId};
   }else if(method==='session/prompt'){
    const session=sessions.get(params.sessionId);if(!session)throw Error('Unknown ACP session');
    const server=session.mcpServers.find(server=>server.name==='teacher_job'),env=Object.fromEntries(server.env.map(entry=>[entry.name,entry.value]));
    const prompt=params.prompt.filter(item=>item.type==='text').map(item=>item.text).join('\n');
    await onPrompt({prompt,token:env.TEACHER_HOST_TOKEN,sessionId:params.sessionId,session,params,child});
    appendFileSync(session.log,JSON.stringify({type:'turn/end',data:{reason:{kind:'completed'}}})+'\n');
    send({type:'status',phase:'turn_end',sessionId:params.sessionId,reason:{kind:'completed'}});result={stopReason:'end_turn'};
   }else if(method==='session/close')sessions.delete(params.sessionId);
   else if(method!=='session/set_config_option')throw Error('Unsupported ACP method: '+method);
   send({jsonrpc:'2.0',id,result});
   if(method==='session/close')setImmediate(()=>onComplete(params.sessionId));
  }catch(error){send({jsonrpc:'2.0',id,error:{code:-32603,message:error.message}});onError(error);}
 }
 child.stdin.on('data',chunk=>{
  buffer+=decoder.write(chunk);let end;
  while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line)queue=queue.then(()=>handle(JSON.parse(line)));}
 });
 child.stdin.on('finish',()=>{void queue.then(()=>close(0));});
 return child;
}
