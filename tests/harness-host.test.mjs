import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readdirSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../server/index.mjs';
import {createStore} from '../server/store.mjs';
import {harnessCommand} from '../server/harness-host.mjs';
import {dshCommand,dshPatch} from '../server/dsh-host.mjs';
const fixture=fileURLToPath(new URL('./fixtures/fake-harness.mjs',import.meta.url));
async function waitFor(check){for(let i=0;i<100;i++){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('timed out');}
function app(t,spawnProcess,harnessOptions={}){const dir=mkdtempSync(join(tmpdir(),'teacher-host-test-'));const result=startServer({port:0,dataDir:dir,executorOptions:{intervalMs:1e9},hostOptions:{intervalMs:1e9},harnessOptions:{intervalMs:1e9,spawnProcess,readDshModel:()=>null,...harnessOptions}});t.after(async()=>{await result.close();rmSync(dir,{recursive:true,force:true});});return result;}

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

test('DSH launches headless with a temporary scoped MCP patch and revokes it after writeback',async t=>{
 let patchPath,patch,token;
 const instance=app(t,(_command,args,options)=>{
  assert.deepEqual(args.slice(-2),['--json','-']);
  assert.ok(args.includes('headless'));
  patchPath=args[args.indexOf('--patch')+1];patch=JSON.parse(readFileSync(patchPath,'utf8'));
  token=options.env.TEACHER_HOST_TOKEN;
  assert.equal(patch.at(-1).insert[0].config.env.TEACHER_HOST_TOKEN,token);
  return spawn(process.execPath,[fixture],{...options,env:{...options.env,ELECTRON_RUN_AS_NODE:undefined}});
 });await once(instance.server,'listening');
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'DSH',executable:process.execPath,model:'custom/model-a'});
 assert.throws(()=>instance.store.agents.token('onboarding'),/手动 MCP/);
 const intro=instance.store.study.onboarding({action:'start',request_id:'intro-dsh-test'});
 instance.harnessDriver.tick();
 const run=await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status='COMPLETED'").get());
 assert.equal(run.harness,'DSH');assert.ok(run.tool_calls>=2);
 assert.equal(instance.store.messages(intro.conversation_id).at(-1).content,'通过任务专属 MCP 回写的测试回答');
 assert.equal(existsSync(patchPath),false);assert.equal(instance.harnessDriver.authenticate(token),false);
 assert.deepEqual(patch.find(row=>row.id==='agent-default-model').config,{provider:'custom',model:'model-a'});
 assert.ok(!JSON.stringify(instance.store.overview()).includes(token));
});

test('DSH missing writeback blocks retry and removes task credentials',async t=>{
 let patchPath;
 const instance=app(t,(_command,args,options)=>{patchPath=args[args.indexOf('--patch')+1];return spawn(process.execPath,['-e','process.exit(0)'],options);});await once(instance.server,'listening');
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'DSH',executable:process.execPath});
 const intro=instance.store.study.onboarding({action:'start',request_id:'dsh-no-writeback'});instance.harnessDriver.tick();
 const run=await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status='FAILED'").get());
 assert.match(run.error,/DSH 未通过 MCP 完成回写/);assert.equal(existsSync(patchPath),false);
 const job=instance.store.db.prepare('SELECT * FROM jobs WHERE conversation_id=?').get(intro.conversation_id);
 assert.equal(job.status,'QUEUED');assert.equal(instance.store.db.prepare('SELECT blocked FROM job_execution WHERE job_id=?').get(job.id).blocked,1);
});

test('DSH terminal errors become useful messages without storing raw provider diagnostics',async t=>{
 const event={type:'status',phase:'turn_end',reason:{kind:'error',error:{code:'MISSING_CREDENTIAL',message:'private-provider-key-must-not-persist'}}};
 const instance=app(t,(_command,_args,options)=>spawn(process.execPath,['-e',`process.stdout.write(${JSON.stringify(JSON.stringify(event))});`],options));await once(instance.server,'listening');
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'DSH',executable:process.execPath});
 instance.store.study.onboarding({action:'start',request_id:'dsh-credential-error'});instance.harnessDriver.tick();
 const run=await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status='FAILED'").get());
 assert.match(run.error,/缺少可用凭据/);assert.ok(!JSON.stringify(instance.store.overview()).includes('private-provider-key-must-not-persist'));
});

test('resumed DSH must refresh task context before writing; each invocation gets new credentials',async t=>{
 const tokens=[];const instance=app(t,(_command,_args,options)=>{tokens.push(options.env.TEACHER_HOST_TOKEN);return spawn(process.execPath,[fixture],{...options,env:{...options.env,FAKE_REQUIRE_CONTEXT_TEST:'1'}});});await once(instance.server,'listening');
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'DSH',executable:process.execPath});
 const intro=instance.store.study.onboarding({action:'start',request_id:'dsh-fresh-context'});instance.harnessDriver.tick();
 await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status='COMPLETED'").get());
 const second=instance.store.send(intro.conversation_id,'第二轮',crypto.randomUUID());instance.store.models.tag(second.job_id);instance.harnessDriver.tick();
 await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE job_id=? AND status='COMPLETED'").get(second.job_id));
 assert.notEqual(tokens[0],tokens[1]);assert.ok(!instance.store.messages(intro.conversation_id).some(m=>m.content==='旧轮次不应写入'));
});

test('different roles cannot resume one conversation while its previous host is still flushing',async t=>{
 let launches=0;const instance=app(t,(_command,_args,options)=>{launches++;return spawn(process.execPath,[fixture],{...options,env:{...options.env,FAKE_HARNESS_EXIT_DELAY:'500'}});});await once(instance.server,'listening');
 for(const role of ['chat','capabilities'])instance.store.agents.configure({role,mode:'MCP',harness:'DSH',executable:process.execPath});
 const g=instance.store.createGoal({title:'并发对话',domain:'测试'}),first=instance.store.send(g.conversation.id,'第一轮',crypto.randomUUID());instance.store.models.tag(first.job_id,'chat');instance.harnessDriver.tick();
 await waitFor(()=>instance.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(first.job_id).status==='COMPLETED');
 const next=instance.store.send(g.conversation.id,'第二轮要求',crypto.randomUUID());instance.store.models.tag(next.job_id,'capabilities');instance.harnessDriver.tick();assert.equal(launches,1);
 await waitFor(()=>instance.store.db.prepare("SELECT status FROM harness_runs WHERE job_id=?").get(first.job_id)?.status==='COMPLETED');
 instance.harnessDriver.tick();await waitFor(()=>instance.store.db.prepare("SELECT status FROM harness_runs WHERE job_id=?").get(next.job_id)?.status==='COMPLETED');assert.equal(launches,2);
});

test('DSH automatically resolves an empty executable at execution time and exposes detection only to the user',async t=>{
 let detections=0;
 const instance=app(t,(_command,_args,options)=>spawn(process.execPath,[fixture],options),{detectDsh:async()=>{detections++;return {found:true,executable:process.execPath,version:'0.2.1',source:'测试安装记录'};}});await once(instance.server,'listening');
 const base='http://127.0.0.1:'+instance.server.address().port;
 const post=headers=>fetch(base+'/api/agents/detect-dsh',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});
 assert.equal((await post({})).status,401);
 const cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
 assert.equal((await post({Cookie:cookie,Authorization:'Bearer '+instance.token})).status,403);
 const detected=await post({Cookie:cookie});assert.equal(detected.status,200);assert.equal((await detected.json()).found,true);
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'DSH'});
 instance.store.study.onboarding({action:'start',request_id:'dsh-auto-detect'});instance.harnessDriver.tick();
 await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status='COMPLETED'").get());
 assert.equal(detections,2);assert.equal(instance.store.agents.route('onboarding').executable,'');
});

test('DSH missing automatic detection fails visibly without launching or repeatedly retrying',async t=>{
 const instance=app(t,()=>assert.fail('missing DSH must not launch'),{detectDsh:async()=>({found:false,message:'未检测到可用的 DSH'})});await once(instance.server,'listening');
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'DSH'});
 instance.store.study.onboarding({action:'start',request_id:'dsh-auto-missing'});instance.harnessDriver.tick();
 const run=await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status='FAILED'").get());assert.match(run.error,/未检测到/);
 instance.harnessDriver.tick();assert.equal(instance.store.db.prepare('SELECT count(*) AS n FROM harness_runs').get().n,1);
});

test('cancelling a task during DSH discovery prevents the host from starting',async t=>{
 let finishDetection;
 const instance=app(t,()=>assert.fail('cancelled discovery must not launch'),{detectDsh:()=>new Promise(resolve=>{finishDetection=resolve;})});await once(instance.server,'listening');
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'DSH'});
 const intro=instance.store.study.onboarding({action:'start',request_id:'dsh-cancel-discovery'});instance.harnessDriver.tick();
 await waitFor(()=>finishDetection);
 const job=instance.store.db.prepare('SELECT id FROM jobs WHERE conversation_id=?').get(intro.conversation_id);instance.store.cancel(job.id);
 finishDetection({found:true,executable:process.execPath});
 const run=await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status='CANCELLED'").get());assert.equal(run.tool_calls,0);
});

test('DSH resolves Desktop and npm launchers without a shell and disables unrelated tools',()=>{
 const root=tmpdir(),desktop=join(root,'DeepSeek Harness.exe');
 const launch=dshCommand(desktop,{exists:()=>true});
 assert.equal(launch.command,desktop);assert.equal(launch.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(launch.args[0],'--expose-internals');
 const npm=dshCommand(join(root,'dsh.cmd'),{exists:()=>true});assert.equal(npm.command,process.execPath);assert.match(npm.args[0],/bin\.js$/);
 assert.throws(()=>dshCommand('relative.exe',{exists:()=>true}),/绝对路径/);
 const patch=dshPatch({model:''},{bridge:'C:/bridge.mjs',baseUrl:'http://127.0.0.1:1234',token:'private-token'});
 for(const id of ['tool-bash','tool-pwsh','tool-fs','tool-web','tool-subagent','tool-plugin-manager'])assert.equal(patch.find(row=>row.id===id).disabled,true);
 assert.ok(!patch.some(row=>row.id==='agent-default-model'));
 assert.equal(patch.at(-1).insert[0].config.failOnStartupError,true);
 assert.throws(()=>dshPatch({model:'provider/'},{}),/provider\/model/);
});

for(const cancelled of [true,false])test('DSH '+(cancelled?'cancellation':'timeout')+' terminates the process and revokes the task',async t=>{
 let token,patchPath,child;
 const instance=app(t,(_command,args,options)=>{
  token=options.env.TEACHER_HOST_TOKEN;patchPath=args[args.indexOf('--patch')+1];
  child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],options);return child;
 },{monitorMs:10,timeoutMs:cancelled?5000:150});await once(instance.server,'listening');
 instance.store.agents.configure({role:'onboarding',mode:'MCP',harness:'DSH',executable:process.execPath});
 const intro=instance.store.study.onboarding({action:'start',request_id:'dsh-stop-'+cancelled});instance.harnessDriver.tick();
 await waitFor(()=>child);
 if(cancelled){const job=instance.store.db.prepare('SELECT id FROM jobs WHERE conversation_id=?').get(intro.conversation_id);instance.store.cancel(job.id);}
 const run=await waitFor(()=>instance.store.db.prepare("SELECT * FROM harness_runs WHERE status<>'RUNNING'").get());
 assert.equal(run.status,cancelled?'CANCELLED':'FAILED');if(!cancelled)assert.match(run.error,/超时/);
 assert.ok(child.killed);assert.equal(instance.harnessDriver.authenticate(token),false);assert.equal(existsSync(patchPath),false);
 assert.equal(instance.store.messages(intro.conversation_id).length,1);
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
