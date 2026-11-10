import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// One isolated ACP process per conversation. Agents and MCP clients are scoped
// to a single job; session/close drains persistence without stopping this process.
export function dshResidentPool({spawnProcess=spawn,requestTimeoutMs=300000,shutdownMs=3000}={}){
 const workers=new Map();let stopped=false;
 async function discard(key){const worker=workers.get(key);if(!worker)return;workers.delete(key);await worker.stop();}
 async function compatible(key,fingerprint){const worker=workers.get(key);if(worker&&(worker.dead||worker.fingerprint!==fingerprint))await discard(key);return workers.get(key);}
 async function acquire(key,fingerprint,{command,args,cwd,env,patchPath,onSpawn=()=>{},onEvent=()=>{}}){
  if(stopped)throw Error('DSH 宿主已停止');let worker=await compatible(key,fingerprint);if(worker)return worker;
  const directory=mkdtempSync(join(tmpdir(),'teacher-dsh-resident-')),patch=join(directory,'patch.json');copyFileSync(patchPath,patch);
  args=args.map(value=>value===patchPath?patch:value);
  const child=spawnProcess(command,args,{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map();let seq=0,line='',bytes=0,turnHandler=onEvent,closing,closedResolve;const decoder=new StringDecoder('utf8');
  const closed=new Promise(resolve=>closedResolve=resolve);
  const fail=error=>{worker.dead=true;for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
  worker={child,fingerprint,dead:false,busy:false,turns:0,startedAt:new Date().toISOString(),
   request(method,params){if(worker.dead)return Promise.reject(Error('DSH 常驻进程已退出'));return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('DSH 协议请求超时'));child.kill();},requestTimeoutMs);timer.unref?.();pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});},
   async run({sessionId,cwd,mcpServers,prompt,selection,onEvent=()=>{},onSession=()=>{}}){if(worker.busy||worker.dead)throw Error('DSH 常驻进程不可用');worker.busy=true;turnHandler=onEvent;bytes=0;let clean=false;
    try{const session=await worker.request(sessionId?'session/resume':'session/new',{...(sessionId?{sessionId}:{}),cwd,mcpServers});sessionId=sessionId||session.sessionId;onSession(sessionId);
     if(selection){const config=session.configOptions?.find(option=>option.id==='model');if(!config)throw Error('DSH 未返回本轮模型配置');const desired=JSON.stringify([selection.provider,selection.model]);if(config&&config.currentValue!==desired){const choices=(config.options||[]).flatMap(option=>option.options||[option]);if(!choices.some(option=>option.value===desired))throw Error('DSH 未提供本轮选定模型，请刷新模型目录');await worker.request('session/set_config_option',{sessionId,configId:'model',value:desired});}}
     const result=await worker.request('session/prompt',{sessionId,prompt:[{type:'text',text:prompt}]});await worker.request('session/close',{sessionId});clean=true;worker.turns++;return result;}
    finally{turnHandler=null;worker.busy=false;if(!clean)await discard(key);}
   },
   stop(){if(closing)return closing;closing=(async()=>{worker.dead=true;child.stdin.end();const timer=setTimeout(()=>child.kill(),shutdownMs);timer.unref?.();await closed;clearTimeout(timer);rmSync(directory,{recursive:true,force:true});})();return closing;}
  };
  child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
  const inspect=value=>{let event;try{event=JSON.parse(value);}catch{return;}if(event.jsonrpc==='2.0'){
   if(Object.hasOwn(event,'id')&&!event.method){const item=pending.get(event.id);if(!item)return;pending.delete(event.id);clearTimeout(item.timer);if(event.error)item.reject(Error('DSH 协议执行失败，请检查模型、凭据或会话恢复状态'));else item.resolve(event.result);}
   else if(event.method&&Object.hasOwn(event,'id'))child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:event.id,error:{code:-32601,message:'Client method unavailable'}})+'\n');
   return;
  }turnHandler?.(event);};
  child.stdout.on('data',chunk=>{if(turnHandler){bytes+=chunk.length;if(bytes>4_000_000){fail(Error('宿主输出超过限制'));child.kill();return;}}line+=decoder.write(chunk);let end;while((end=line.indexOf('\n'))>=0){inspect(line.slice(0,end));line=line.slice(end+1);}if(line.length>1_000_000){fail(Error('DSH 协议输出超过限制'));child.kill();}});
  child.once('error',()=>{fail(Error('无法启动 DSH，请检查可执行文件和登录状态'));closedResolve();rmSync(directory,{recursive:true,force:true});});
  child.once('close',()=>{fail(Error('DSH 常驻进程已退出'));closedResolve();rmSync(directory,{recursive:true,force:true});});
  workers.set(key,worker);onSpawn(child);
  try{const info=await worker.request('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'ai-teacher',version:'1'}});if(info.protocolVersion!==1||!info.agentCapabilities?.sessionCapabilities?.resume||!info.agentCapabilities?.sessionCapabilities?.close)throw Error('本机 DSH 不支持常驻 ACP 会话，请升级 DSH');turnHandler=null;return worker;}catch(error){await discard(key);throw error;}
 }
 return {compatible,acquire,discard,state:()=>[...workers].map(([conversation_id,w])=>({conversation_id,pid:w.child.pid,busy:w.busy,alive:!w.dead,turns:w.turns,started_at:w.startedAt})),async stop(){stopped=true;await Promise.allSettled([...workers.keys()].map(discard));}};
}
