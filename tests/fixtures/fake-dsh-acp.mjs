import {createInterface} from 'node:readline';
import {mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const sessions=new Map(),send=value=>process.stdout.write(JSON.stringify(value)+'\n');
for await(const line of createInterface({input:process.stdin})){
 let request;try{request=JSON.parse(line);}catch{continue;}const {id,method,params={}}=request;
 try{let result={};
 if(method==='initialize')result={protocolVersion:1,agentCapabilities:{sessionCapabilities:{resume:{},close:{}}}};
 else if(method==='session/new'||method==='session/resume'){
  const sessionId=params.sessionId||randomUUID();sessions.set(sessionId,params);result={sessionId};
  const dir=join(process.env.DSH_HOME,'sessions',sessionId);mkdirSync(dir,{recursive:true});if(!params.sessionId)writeFileSync(join(dir,'session.jsonl'),JSON.stringify({type:'session',id:sessionId,cwd:params.cwd})+'\n');
 }else if(method==='session/prompt'){
  const session=sessions.get(params.sessionId),server=session.mcpServers[0],env=Object.fromEntries(server.env.map(e=>[e.name,e.value]));
  const client=new Client({name:'fake-acp',version:'1'});await client.connect(new StdioClientTransport({command:server.command,args:server.args,env:{...process.env,...env},stderr:'pipe'}));
  try{if(process.env.FAKE_REQUIRE_CONTEXT_TEST){const stale=await client.callTool({name:'teacher_reply',arguments:{content:'旧轮次不应写入'}});if(!stale.isError)throw Error('stale accepted');}
   const context=await client.callTool({name:'teacher_get_context',arguments:{}});if(context.isError)throw Error('context failed');
   const reply=await client.callTool({name:'teacher_reply',arguments:{content:'通过任务专属 MCP 回写的测试回答'}});if(reply.isError)throw Error('reply failed');
   if(process.env.FAKE_HARNESS_EXIT_DELAY)await new Promise(resolve=>setTimeout(resolve,Number(process.env.FAKE_HARNESS_EXIT_DELAY)));
   appendFileSync(join(process.env.DSH_HOME,'sessions',params.sessionId,'session.jsonl'),JSON.stringify({type:'turn/end',data:{reason:{kind:'completed'}}})+'\n');
   send({type:'status',phase:'turn_end',sessionId:params.sessionId,reason:{kind:process.env.FAKE_DSH_STOP_KIND||'completed'}});result={stopReason:'end_turn'};
  }finally{await client.close();}
 }else if(method==='session/set_config_option'){result={};}else if(method==='session/close'){sessions.delete(params.sessionId);}else throw Error('unknown method');
 send({jsonrpc:'2.0',id,result});
 }catch{send({jsonrpc:'2.0',id,error:{code:-32603,message:'fixture error'}});}
}
