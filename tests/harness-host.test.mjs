import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../server/index.mjs';
import {createStore} from '../server/store.mjs';
import {harnessCommand} from '../server/harness-host.mjs';
const fixture=fileURLToPath(new URL('./fixtures/fake-harness.mjs',import.meta.url));
async function waitFor(check){for(let i=0;i<100;i++){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('timed out');}
function app(t,spawnProcess){const dir=mkdtempSync(join(tmpdir(),'teacher-host-test-'));const result=startServer({port:0,dataDir:dir,executorOptions:{intervalMs:1e9},hostOptions:{intervalMs:1e9},harnessOptions:{intervalMs:1e9,spawnProcess}});t.after(async()=>{await result.close();rmSync(dir,{recursive:true,force:true});});return result;}

test('site launches a role harness; job-scoped MCP reads context and writes the answer',async t=>{
 const launches=[];const instance=app(t,(command,args,options)=>{launches.push({command,args,options});return spawn(process.execPath,[fixture],options);});await once(instance.server,'listening');
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'CODEX'});
 const intro=instance.store.study.onboarding({action:'start',request_id:'intro-host-test'});
 instance.harnessDriver.tick();
 await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status='COMPLETED'").get());
 const messages=instance.store.messages(intro.conversation_id);
 assert.equal(messages.at(-1).content,'通过任务专属 MCP 回写的测试回答');
 assert.equal(instance.store.db.prepare('SELECT status FROM jobs ORDER BY rowid DESC LIMIT 1').get().status,'COMPLETED');
 assert.ok(launches[0].args.includes('exec'));
 assert.ok(!JSON.stringify(instance.store.overview()).includes(launches[0].options.env.TEACHER_HOST_TOKEN));
 const expired=await fetch('http://127.0.0.1:'+instance.server.address().port+'/api/harness/catalog',{method:'POST',headers:{Authorization:'Bearer '+launches[0].options.env.TEACHER_HOST_TOKEN,'Content-Type':'application/json'},body:'{}'});
 assert.equal(expired.status,401);
});

test('missing writeback blocks the job, records a visible failure, and requires retry',async t=>{
 const instance=app(t,(_command,_args,options)=>spawn(process.execPath,['-e','process.exit(0)'],options));await once(instance.server,'listening');
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'CODEX'});
 const intro=instance.store.study.onboarding({action:'start',request_id:'intro-failure-test'});instance.harnessDriver.tick();
 const run=await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status='FAILED'").get());
 const job=instance.store.db.prepare('SELECT * FROM jobs WHERE conversation_id=?').get(intro.conversation_id);
 assert.equal(job.status,'QUEUED');assert.equal(instance.store.db.prepare('SELECT blocked FROM job_execution WHERE job_id=?').get(job.id).blocked,1);
 assert.match(run.error,/未通过 MCP 完成回写/);
 instance.harnessDriver.tick();assert.equal(instance.store.db.prepare('SELECT count(*) AS n FROM harness_runs').get().n,1);
 instance.store.agents.retry({job_id:job.id});assert.equal(instance.store.db.prepare('SELECT blocked FROM job_execution WHERE job_id=?').get(job.id).blocked,0);
});

test('Codex and Claude commands use each harness noninteractive interface',()=>{
 const codex=harnessCommand({role:'onboarding',harness:'CODEX',executable:process.execPath,model:''},{workDir:tmpdir()});
 assert.equal(codex.args[0],'exec');assert.ok(codex.args.includes('--json'));assert.ok(codex.args.some(value=>value.includes('mcp_servers.teacher_job.command')));
 const claude=harnessCommand({role:'onboarding',harness:'CLAUDE',executable:process.execPath,model:''},{mcpConfig:'C:/temp/mcp.json',workDir:tmpdir()});
 assert.equal(claude.args[0],'-p');assert.ok(claude.args.includes('--mcp-config'));assert.ok(claude.args.includes('mcp__teacher_job__teacher_reply'));
});

test('older role routes gain harness columns with a backup and keep their settings',()=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-harness-migration-')),file=join(dir,'teacher.sqlite');
 try{
  let store=createStore(file);store.agents.configure({role:'onboarding',mode:'MCP'});
  store.db.exec('ALTER TABLE agent_routes DROP COLUMN harness; ALTER TABLE agent_routes DROP COLUMN executable; ALTER TABLE agent_routes DROP COLUMN model');store.db.close();
  store=createStore(file);assert.equal(store.agents.route('onboarding').mode,'MCP');assert.equal(store.agents.route('onboarding').harness,'MANUAL');
  assert.ok(readdirSync(join(dir,'backups')).some(name=>name.startsWith('before-harness-routing-')));store.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
