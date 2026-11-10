// Opt-in: two brief real model turns in a new isolated learning database.
// Uses the existing DSH login and app proxy without changing either.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {startServer} from '../server/index.mjs';
import {dshNetwork} from '../server/dsh-network.mjs';

assert.ok(process.argv.includes('--real-model'),'Pass --real-model to authorize two short inference turns');
const output=resolve('outputs/runtime-v0180/live-'+Date.now());mkdirSync(output,{recursive:true});
const network=dshNetwork(join(process.env.APPDATA||homedir(),'AI Teacher','data'));
const app=startServer({port:0,dataDir:join(output,'data'),executorOptions:{intervalMs:1e9},hostOptions:{intervalMs:1e9},harnessOptions:{intervalMs:1e9,timeoutMs:180000,dshEnv:()=>network.env()}});
const report={checkedAt:new Date().toISOString(),isolated:true,model:'qoder-cn/DeepSeek-Flash',turns:[]};
try{
 await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port;
 const cookie=(await fetch(base+'/')).headers.get('set-cookie').split(';')[0];
 const catalog=await (await fetch(base+'/api/agents/dsh-models?refresh=1',{headers:{cookie}})).json();
 assert.ok(catalog.models.some(m=>m.id===report.model),'Requested real model exists in native registry');
 app.store.agents.configure({role:'chat',mode:'MCP',harness:'DSH',model:report.model});
 const fixture=app.store.createGoal({title:'隔离连接验收',domain:'开发验证',scope:'仅验证两轮宿主连接与公开搜索'}),cid=fixture.conversation.id;
 for(const content of ['这是隔离连接验收，不需要规划。先读取当前上下文，再使用 web_search 查询 Python official documentation。请仅用一两句话告知实际找到的 Python 官网链接；不要修改学习目标或路线。','继续这段连接验收。无需再次搜索，请依据上一轮实际搜索结果，用一句话重复 Python 官网链接。不要调用规划工具。']){
  const sent=app.store.send(cid,content,crypto.randomUUID());app.store.models.tag(sent.job_id);app.harnessDriver.tick();
  const started=Date.now();let run;
  while(Date.now()-started<200000){run=app.store.db.prepare('SELECT status,error,tool_calls,dsh_session_id FROM harness_runs WHERE job_id=? ORDER BY rowid DESC LIMIT 1').get(sent.job_id);if(run&&run.status!=='RUNNING')break;await new Promise(r=>setTimeout(r,500));}
  const resident=app.harnessDriver.residentState().find(w=>w.conversation_id===cid),reply=app.store.messages(cid).filter(m=>m.role==='assistant').at(-1),progress=app.harnessDriver.runProgress().find(r=>r.job_id===sent.job_id);
  const item={status:run?.status,error:run?.error||null,pid:resident?.pid,alive:resident?.alive,turns:resident?.turns,sessionId:run?.dsh_session_id,seconds:(Date.now()-started)/1000,replyCharacters:reply?.content.length||0,sourceUrls:reply?.content.match(/https?:\/\/[^\s)）]+/g)||[],tools:progress?.tools.map(t=>({name:t.name,status:t.status}))||[]};report.turns.push(item);console.log(JSON.stringify(item));
  assert.equal(item.status,'COMPLETED');assert.ok(item.alive&&item.replyCharacters>0);assert.match(reply.content,/python\.org/i);
 }
 assert.equal(report.turns[0].pid,report.turns[1].pid);assert.equal(report.turns[0].sessionId,report.turns[1].sessionId);assert.equal(report.turns[1].turns,2);
 assert.ok(report.turns[0].tools.some(t=>t.name==='web_search'&&t.status==='COMPLETED'));
 report.sameProcess=true;report.sameSession=true;report.searchSucceeded=true;report.ok=true;
}finally{
 await app.close();report.hostStopped=report.turns.every(t=>{try{process.kill(t.pid,0);return false;}catch{return true;}});
 writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));console.log('Resident live result: '+join(output,'result.json'));
}
