// Opt-in integration check. Uses an isolated temporary database and a real logged-in CLI.
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {startServer} from '../server/index.mjs';
const harness=process.argv[2]==='claude'?'CLAUDE':'CODEX';
const dir=mkdtempSync(join(tmpdir(),'ai-teacher-real-harness-'));
const app=startServer({port:0,dataDir:dir,executorOptions:{intervalMs:1e9},hostOptions:{intervalMs:1e9},harnessOptions:{intervalMs:1e9,timeoutMs:120000}});
try{
 await once(app.server,'listening');
 app.store.agents.configure({role:'onboarding',mode:'MCP',harness});
 const intro=app.store.study.onboarding({action:'start',request_id:'real-harness-smoke'});
 app.harnessDriver.tick();
 let run;
 for(let attempt=0;attempt<250;attempt++){
  run=app.store.db.prepare('SELECT status,error,tool_calls FROM harness_runs ORDER BY rowid DESC LIMIT 1').get();
  if(run&&run.status!=='RUNNING')break;
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 const messages=app.store.messages(intro.conversation_id);
 console.log(JSON.stringify({harness,run,assistantReply:messages.some(message=>message.role==='assistant')},null,2));
 if(run?.status!=='COMPLETED'||!messages.some(message=>message.role==='assistant'))process.exitCode=1;
}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
