import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createStore} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {dshSessionsView} from '../public/agents.js';
function setup(t){const dir=mkdtempSync(join(tmpdir(),'teacher-dsh-session-'));let store=createStore(join(dir,'teacher.sqlite'));t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});return {dir,get store(){return store;},restart(){store.db.close();store=createStore(join(dir,'teacher.sqlite'));return store;}};}
function conversation(s){const g=s.createGoal({title:'测试对话',domain:'test'}),sent=s.send(g.conversation.id,'第一轮',randomUUID());return {cid:g.conversation.id,job:sent.job_id};}
function prepare(f,c){const runId=randomUUID();f.store.db.prepare('INSERT INTO harness_runs(id,job_id,role,harness,status,created_at) VALUES(?,?,?,?,?,?)').run(runId,c.job,'chat','DSH','RUNNING',new Date().toISOString());return {runId,...f.store.agents.dshSessions.prepare(c.cid,{dataDir:f.dir,jobId:c.job,runId})};}
function persist(f,c,p,id='session-test'){const path=join(p.logs,'project',id,'session.v4.jsonl');mkdirSync(join(p.logs,'project',id),{recursive:true});writeFileSync(path,JSON.stringify({type:'session',version:4,id,cwd:p.workDir})+'\n'+JSON.stringify({type:'event',seq:0})+'\n');f.store.agents.dshSessions.remember(c.cid,id,p.workDir,f.dir);return path;}
function done(f,c,p,options={}){f.store.agents.dshSessions.finish(c.cid,{dataDir:f.dir,runId:p.runId,completed:true,clean:true,...options});}

test('one conversation retains one session and workspace over restarts; other conversations share the workspace with distinct sessions',t=>{
 const f=setup(t),c=conversation(f.store),p=prepare(f,c);persist(f,c,p);done(f,c,p);
 assert.equal(f.store.agents.dshSessions.get(c.cid).state,'READY');assert.ok(existsSync(p.checkpoint));
 f.restart();const again=prepare(f,c);assert.equal(again.sessionId,'session-test');assert.equal(again.workDir,p.workDir);assert.equal(again.home,p.home);
 const other=conversation(f.store),q=prepare(f,other);assert.equal(q.workDir,p.workDir);assert.notEqual(q.home,p.home);
 assert.throws(()=>f.store.agents.dshSessions.remember(other.cid,'session-test',q.workDir,f.dir),/绑定其他/);
 assert.throws(()=>f.store.agents.dshSessions.remember(other.cid,'session-other',join(f.dir,'wrong-workspace'),f.dir),/工作区/);
});

test('missing and corrupted logs block silent replacement; verified checkpoints restore the same session',t=>{
 const f=setup(t),c=conversation(f.store),p=prepare(f,c),file=persist(f,c,p);done(f,c,p);const original=readFileSync(file,'utf8');
 rmSync(file);assert.throws(()=>prepare(f,c),/日志缺失/);assert.equal(f.store.agents.dshSessions.get(c.cid).session_id,'session-test');
 assert.equal(f.store.agents.dshSessions.check(c.cid,{dataDir:f.dir,restore:true}).state,'READY');assert.equal(readFileSync(file,'utf8'),original);
 writeFileSync(file,original+'{broken\n');assert.equal(f.store.agents.dshSessions.check(c.cid,{dataDir:f.dir}).state,'RECOVERY_REQUIRED');
 assert.equal(f.store.agents.dshSessions.check(c.cid,{dataDir:f.dir,restore:true}).state,'READY');assert.equal(readFileSync(file,'utf8'),original);
 assert.ok(readdirSync(join(p.logs,'project','session-test')).some(name=>name.includes('before-recovery')));
 writeFileSync(p.checkpoint,original.replace('"seq":0','"seq":1'));rmSync(file);assert.throws(()=>f.store.agents.dshSessions.check(c.cid,{dataDir:f.dir,restore:true}),/校验失败/);assert.equal(existsSync(file),false);
});

test('unbound durable session is recovered after a crash; interrupted mappings preserve identity',t=>{
 const f=setup(t),c=conversation(f.store),p=prepare(f,c);const file=persist(f,c,p);
 f.store.db.prepare('UPDATE dsh_sessions SET session_id=NULL,process_pid=NULL WHERE conversation_id=?').run(c.cid);
 f.restart();f.store.agents.dshSessions.recover();assert.equal(f.store.agents.dshSessions.get(c.cid).state,'INTERRUPTED');
 const recovered=prepare(f,c);assert.equal(recovered.sessionId,'session-test');assert.ok(existsSync(file));
 f.store.agents.dshSessions.pid(c.cid,process.pid);assert.throws(()=>prepare(f,c),/尚未退出/);assert.throws(()=>f.store.agents.dshSessions.reset(c.cid,{dataDir:f.dir}),/仍在运行/);
});

test('explicit rebuild archives the old binding and keeps logs and workspace files',t=>{
 const f=setup(t),c=conversation(f.store),p=prepare(f,c),file=persist(f,c,p);done(f,c,p);writeFileSync(join(p.workDir,'notes.txt'),'keep');
 const reset=f.store.agents.dshSessions.reset(c.cid,{dataDir:f.dir});assert.equal(reset.session_id,null);assert.equal(reset.generation,2);
 const next=prepare(f,c);assert.equal(next.workDir,p.workDir);assert.notEqual(next.home,p.home);assert.ok(existsSync(file));assert.equal(readFileSync(join(next.workDir,'notes.txt'),'utf8'),'keep');
 assert.equal(f.store.db.prepare('SELECT session_id FROM dsh_session_history WHERE conversation_id=?').get(c.cid).session_id,'session-test');
});

test('no clean terminal means no new checkpoint; moved or foreign workspaces are rejected',t=>{
 const f=setup(t),c=conversation(f.store),p=prepare(f,c);persist(f,c,p);done(f,c,p,{clean:false,interrupted:true});
 assert.equal(f.store.agents.dshSessions.get(c.cid).state,'INTERRUPTED');assert.equal(existsSync(p.checkpoint),false);
 f.store.db.prepare('UPDATE dsh_sessions SET cwd=? WHERE conversation_id=?').run(join(f.dir,'moved'),c.cid);assert.throws(()=>prepare(f,c),/目录已移动/);
});

test('DSH session migration backs up existing libraries and preserves learning records',t=>{
 const f=setup(t),c=conversation(f.store);f.store.db.exec('DROP TABLE dsh_session_history; DROP TABLE dsh_sessions; ALTER TABLE harness_runs DROP COLUMN dsh_session_id; ALTER TABLE harness_runs DROP COLUMN workspace_path');
 f.restart();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM conversations WHERE id=?').get(c.cid).n,1);
 assert.ok(readdirSync(join(f.dir,'backups')).some(name=>name.startsWith('before-dsh-sessions-')));
});

test('V0.9 private workspace bindings are archived once before switching to the application workspace',t=>{
 const f=setup(t),c=conversation(f.store);prepare(f,c);
 f.store.db.prepare("UPDATE dsh_sessions SET workspace_layout='LEGACY',cwd=NULL WHERE conversation_id=?").run(c.cid);
 const old=prepareLegacy();const oldLog=persist(f,c,old,'session-legacy');done(f,c,old);writeFileSync(join(old.workDir,'legacy-note.txt'),'keep old files');
 f.store.db.exec('ALTER TABLE dsh_sessions DROP COLUMN workspace_layout');f.restart();
 assert.equal(f.store.agents.dshSessions.get(c.cid).workspace_layout,'LEGACY');const next=prepare(f,c);
 assert.equal(next.sessionId,null);assert.equal(next.workDir,join(f.dir,'ai-teacher-workspace'));assert.equal(next.generation,2);
 assert.ok(existsSync(oldLog));assert.equal(readFileSync(join(old.workDir,'legacy-note.txt'),'utf8'),'keep old files');
 const history=f.store.db.prepare('SELECT * FROM dsh_session_history WHERE conversation_id=?').get(c.cid);assert.equal(history.session_id,'session-legacy');assert.equal(history.log_path,oldLog);
 persist(f,c,next,'session-shared');done(f,c,next);f.restart();assert.equal(prepare(f,c).sessionId,'session-shared');
 assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM dsh_session_history').get().n,1);
 assert.ok(readdirSync(join(f.dir,'backups')).some(name=>name.startsWith('before-dsh-shared-workspace-')));
 function prepareLegacy(){const row=f.store.agents.dshSessions.get(c.cid),paths=f.store.agents.dshSessions.paths(row,f.dir);mkdirSync(paths.workDir,{recursive:true});mkdirSync(paths.home,{recursive:true});f.store.db.prepare("UPDATE dsh_sessions SET state='READY',cwd=? WHERE conversation_id=?").run(paths.workDir,c.cid);return {...paths,runId:row.last_run_id};}
});

test('workspace links cannot redirect the shared workspace into another directory',t=>{
 const f=setup(t),c=conversation(f.store),p=prepare(f,c);persist(f,c,p);done(f,c,p);
 const other=join(f.dir,'other-directory');mkdirSync(other);assert.ok(p.workDir.startsWith(f.dir));rmSync(p.workDir,{recursive:true});
 symlinkSync(other,p.workDir,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>prepare(f,c),/链接/);assert.equal(f.store.agents.dshSessions.get(c.cid).state,'RECOVERY_REQUIRED');
});

test('session management requires the user session and cannot be invoked by MCP credentials',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-dsh-session-http-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
 for(const endpoint of ['check','reset'])for(const [headers,status] of [[{},401],[{Cookie:cookie,Authorization:'Bearer '+app.token},403]]){
  const response=await fetch(base+'/api/agents/dsh-session/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});assert.equal(response.status,status);
 }
 const state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.deepEqual(state.agents.dsh_sessions,[]);
 const f={store:app.store,dir},c=conversation(app.store),p=prepare(f,c);persist(f,c,p);done(f,c,p);
 const post=(endpoint,body)=>fetch(base+'/api/agents/dsh-session/'+endpoint,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('check',{conversation_id:c.cid})).status,200);
 const reset=await post('reset',{conversation_id:c.cid});assert.equal(reset.status,200);assert.equal((await reset.json()).generation,2);
 const view=dshSessionsView([{conversation_id:'test',conversation_title:'<unsafe>',session_id:'session-id',cwd:'C:/workspace',state:'RECOVERY_REQUIRED',generation:1,error:'<bad>'}]);
 assert.ok(!view.includes('<unsafe>'));assert.ok(view.includes('&lt;unsafe&gt;'));assert.ok(view.includes('需要恢复'));assert.ok(view.includes('agent-dsh-check'));
});
