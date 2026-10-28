import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {modules,normalizeBase} from './model-config.mjs';
import {guidePrompt} from './agent-policy.mjs';
import {dshSessionService} from './dsh-sessions.mjs';
import {dshModelPreferences} from './dsh-model-preferences.mjs';
const fail=m=>{throw Object.assign(new Error(m),{status:409});},now=()=>new Date().toISOString();
const hash=s=>createHash('sha256').update(s).digest('hex');
export function agentService(db,file,{models,receipt,leased}){
 const one=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 if(!one("SELECT name FROM sqlite_master WHERE name='agent_settings'")){
  if(file!==':memory:'){mkdirSync(join(dirname(file),'backups'),{recursive:true});db.prepare('VACUUM INTO ?').run(join(dirname(file),'backups','before-agents-'+Date.now()+'.sqlite'));}
  db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE agent_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,routing_version INTEGER NOT NULL DEFAULT 2);
   INSERT INTO agent_settings VALUES(1,0,0,2);
   CREATE TABLE agent_routes(role TEXT PRIMARY KEY,mode TEXT NOT NULL,profile_id TEXT REFERENCES model_profiles(id),token_hash TEXT,last_seen TEXT,harness TEXT NOT NULL DEFAULT 'MANUAL',executable TEXT NOT NULL DEFAULT '',model TEXT NOT NULL DEFAULT '');
   CREATE TABLE agent_proposals(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id),revision INTEGER NOT NULL,summary TEXT NOT NULL,plan TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE agent_handoffs(id TEXT PRIMARY KEY,job_id TEXT REFERENCES jobs(id),module TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
   ALTER TABLE job_execution ADD COLUMN agent_role TEXT;
   COMMIT;`);
 }
  const routeColumns=new Set(all('PRAGMA table_info(agent_routes)').map(column=>column.name));
  const missing=[['harness',"TEXT NOT NULL DEFAULT 'MANUAL'"],['executable',"TEXT NOT NULL DEFAULT ''"],['model',"TEXT NOT NULL DEFAULT ''"]].filter(([name])=>!routeColumns.has(name));
  if(missing.length){
   if(file!==':memory:'){mkdirSync(join(dirname(file),'backups'),{recursive:true});db.prepare('VACUUM INTO ?').run(join(dirname(file),'backups','before-harness-routing-'+Date.now()+'.sqlite'));}
   db.exec('BEGIN IMMEDIATE');try{for(const [name,type] of missing)db.exec(`ALTER TABLE agent_routes ADD COLUMN ${name} ${type}`);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }
  db.exec('CREATE TABLE IF NOT EXISTS harness_runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),role TEXT NOT NULL,harness TEXT NOT NULL,status TEXT NOT NULL,error TEXT,tool_calls INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,ended_at TEXT)');
  const dshSessions=dshSessionService(db,file);
  const dshModels=dshModelPreferences(db,file);
  const roleOK=role=>{if(role!=='master'&&!Object.hasOwn(modules,role))fail('Agent 模块无效');};
 const settings=()=>one('SELECT enabled,revision FROM agent_settings');
 function route(role){
  roleOK(role);const configured=one('SELECT role,mode,profile_id,last_seen,harness,executable,model,token_hash IS NOT NULL AS has_token FROM agent_routes WHERE role=?',role);
  if(configured)return configured;
  const legacy=role!=='master'?one('SELECT profile_id FROM model_routes WHERE module=?',role):null;
  return {role,mode:legacy?.profile_id?'API':'UNCONFIGURED',profile_id:legacy?.profile_id||null,harness:'MANUAL',executable:'',model:'',has_token:0};
 }
 function state(){return {...settings(),modules,dsh_workspace:dshSessions.workspace(dirname(file)),dsh_sessions:dshSessions.state(),dsh_conversation_models:dshModels.state(),routes:['master',...Object.keys(modules)].map(route),runs:all('SELECT r.*,m.provider AS model_provider,m.model AS model_name,m.source AS model_source FROM harness_runs r LEFT JOIN dsh_run_models m ON m.run_id=r.id ORDER BY r.rowid DESC LIMIT 100'),proposals:all("SELECT * FROM agent_proposals WHERE status='PENDING' ORDER BY rowid DESC").map(p=>({...p,plan:JSON.parse(p.plan)}))};}
 function validateRoute(r){roleOK(r.role);if(!['API','MCP','UNCONFIGURED'].includes(r.mode)||(r.role==='master'&&r.mode==='UNCONFIGURED'))fail('Agent 执行方式无效');if(r.mode==='API')models.profile(r.profile_id);const harness=r.mode==='MCP'?(r.harness||'MANUAL'):'MANUAL';if(!['MANUAL','CODEX','CLAUDE','DSH'].includes(harness))fail('宿主类型无效');const executable=r.mode==='MCP'?String(r.executable||'').trim():'',model=r.mode==='MCP'?String(r.model||'').trim():'';if(executable.length>500||/[\r\n]/.test(executable)||model.length>150||/[\r\n]/.test(model))fail('宿主配置无效');return {role:r.role,mode:r.mode,profile_id:r.mode==='API'?r.profile_id:null,harness,executable,model};}
 function put(r){r=validateRoute(r);run('INSERT INTO agent_routes(role,mode,profile_id,harness,executable,model) VALUES(?,?,?,?,?,?) ON CONFLICT(role) DO UPDATE SET mode=excluded.mode,profile_id=excluded.profile_id,harness=excluded.harness,executable=excluded.executable,model=excluded.model,token_hash=CASE WHEN excluded.mode=agent_routes.mode AND excluded.harness=agent_routes.harness THEN agent_routes.token_hash ELSE NULL END,last_seen=CASE WHEN excluded.mode=agent_routes.mode AND excluded.harness=agent_routes.harness THEN agent_routes.last_seen ELSE NULL END',r.role,r.mode,r.profile_id,r.harness,r.executable,r.model);}
 function configure(a){const r=validateRoute(a);put(r);run('UPDATE agent_settings SET enabled=1');run('UPDATE agent_settings SET revision=revision+1');if(r.mode==='API')models.enabled(true);return state();}
 function token(role){roleOK(role);if(route(role).mode!=='MCP'||route(role).harness!=='MANUAL')fail('请先将该 Agent 配置为手动 MCP 宿主');const token=randomBytes(32).toString('hex');run('UPDATE agent_routes SET token_hash=? WHERE role=?',hash(token),role);return {role,token,path:'/mcp/agents/'+role};}
 function authenticate(role,token){if(!settings().enabled||typeof token!=='string'||route(role).mode!=='MCP'||route(role).harness!=='MANUAL')return false;const expected=one('SELECT token_hash FROM agent_routes WHERE role=?',role)?.token_hash;if(!expected)return false;const ok=timingSafeEqual(Buffer.from(hash(token)),Buffer.from(expected));if(ok)run('UPDATE agent_routes SET last_seen=? WHERE role=?',now(),role);return ok;}
 function resolve(job,module){
  if(!settings().enabled)return null;
  const kind=one('SELECT kind FROM conversations WHERE id=?',job.conversation_id)?.kind;
  const role=kind==='ORCHESTRATION'?'master':module,r=route(role);
  dshModels.freeze(job,r);
  return {mode:r.mode,profile_id:r.profile_id,agent_role:role,blocked:r.mode==='UNCONFIGURED'?1:0};
 }
 function configuration(){const s=state();return {revision:s.revision,modules,routes:s.routes,dsh_models:dshModels.catalog(),profiles:models.state().profiles.map(({id,name,model,base_url,has_key})=>({id,name,model,base_url,has_key})),pending:s.proposals,prompt:guidePrompt};}
 function master(a){const job=leased(a.job_id,a.lease_token),task=one('SELECT * FROM job_execution WHERE job_id=?',job.id);if(task?.agent_role!=='master'||one('SELECT kind FROM conversations WHERE id=?',job.conversation_id)?.kind!=='ORCHESTRATION')fail('仅配置引导对话中的主 Agent 可修改配置提案');return {job,task};}
 function normalizePlan(plan){
  if(!plan||!Array.isArray(plan.routes)||plan.routes.length>Object.keys(modules).length)fail('分工方案无效');
  const seen=new Set();return {routes:plan.routes.map(r=>{if(r.role==='master'||seen.has(r.role))fail('模块重复或不可修改主 Agent');seen.add(r.role);roleOK(r.role);if(r.connection){if(r.mode!=='API')fail('模型连接仅用于 API');const c=r.connection;if(typeof c.name!=='string'||!c.name.trim()||c.name.length>200||typeof c.model!=='string'||!c.model.trim()||c.model.length>200)fail('连接名称或模型名无效');return {role:r.role,mode:'API',connection:{name:c.name.trim(),model:c.model.trim(),base_url:normalizeBase(c.base_url)}};}const route=validateRoute(r);if(route.harness==='DSH'&&route.model)dshModels.validate(route.model);return route;})};
 }
 function propose(a){const {job}=master(a);if(a.revision!==settings().revision)fail('配置已变化，请重新读取');const plan=normalizePlan(a.plan);return receipt(a.request_id,'agent-plan:'+job.id,()=>{const id=randomUUID();run('INSERT INTO agent_proposals VALUES(?,?,?,?,?,?,?)',id,job.conversation_id,a.revision,a.summary,JSON.stringify(plan),'PENDING',now());return {id,status:'PENDING'};});}
 function decide(a){
  if(typeof a.accept!=='boolean')fail('确认值无效');
  return receipt(a.request_id,'agent-decide:'+a.id,()=>{
   const p=one('SELECT * FROM agent_proposals WHERE id=?',a.id);if(!p||p.status!=='PENDING')fail('方案已处理');
   if(a.accept&&p.revision!==settings().revision)fail('配置已更新，请让主 Agent 重新生成方案');
   if(a.accept){const plan=normalizePlan(JSON.parse(p.plan));for(const r of plan.routes){if(r.connection){const profile=models.save({...r.connection,key:a.keys?.[r.role]||'',options:{}});put({...r,profile_id:profile.id});}else put(r);}run('UPDATE agent_settings SET revision=revision+1');if(plan.routes.some(r=>r.mode==='API'))models.enabled(true);}
   run('UPDATE agent_proposals SET status=? WHERE id=?',a.accept?'ACCEPTED':'REJECTED',p.id);return {ok:true};
  });
 }
 function conversation(){if(route('master').mode==='UNCONFIGURED')fail('请先配置主 Agent');let c=one("SELECT id FROM conversations WHERE kind='ORCHESTRATION' ORDER BY rowid DESC LIMIT 1");if(!c){c={id:randomUUID()};run('INSERT INTO conversations VALUES(?,?,?,?,?)',c.id,null,'主 Agent · 配置与分工','ORCHESTRATION',now());}return {conversation_id:c.id};}
 function retry(a){
  if(a.to_master)fail('学习任务不能交给配置引导 Agent');
  const j=one('SELECT * FROM jobs WHERE id=?',a.job_id);if(j?.status!=='QUEUED')fail('仅等待中的任务可重新分配');
  if(one("SELECT id FROM model_runs WHERE job_id=? AND status='RUNNING'",j.id))fail('原 API 任务仍在执行，请稍后重试');
  const t=one('SELECT * FROM job_execution WHERE job_id=?',j.id);if(!t?.agent_role)fail('请使用原任务的重试入口');
  const assigned=resolve(j,t.module);if(assigned.mode==='UNCONFIGURED')fail('请先配置该功能的 API 或 MCP');
  run('UPDATE job_execution SET mode=?,profile_id=?,agent_role=?,blocked=0 WHERE job_id=?',assigned.mode,assigned.profile_id,assigned.agent_role,j.id);return {ok:true};
 }
 // Upgrade the earlier coordinator design without sending pending learning content to the guide.
 if(!all('PRAGMA table_info(agent_settings)').some(c=>c.name==='routing_version')){
  if(file!==':memory:'){mkdirSync(join(dirname(file),'backups'),{recursive:true});db.prepare('VACUUM INTO ?').run(join(dirname(file),'backups','before-direct-agent-routing-'+Date.now()+'.sqlite'));}
  db.exec('BEGIN IMMEDIATE');try{
   db.exec('ALTER TABLE agent_settings ADD COLUMN routing_version INTEGER NOT NULL DEFAULT 2');
   run("UPDATE agent_routes SET mode='UNCONFIGURED' WHERE mode='INHERIT'");
   run("UPDATE agent_proposals SET status='SUPERSEDED' WHERE status='PENDING'");
   run('UPDATE agent_settings SET revision=revision+1');
   for(const row of all("SELECT j.*,e.module,e.blocked,c.kind FROM jobs j JOIN job_execution e ON e.job_id=j.id JOIN conversations c ON c.id=j.conversation_id WHERE e.agent_role IS NOT NULL AND j.status IN ('QUEUED','RUNNING')")){
    const module=['READING','ONBOARDING','CHANGE_REVIEW'].includes(row.kind)?row.kind.toLowerCase():row.module;
    const assigned=resolve(row,module);if(!assigned)continue;
    run('UPDATE job_execution SET module=?,mode=?,profile_id=?,agent_role=?,blocked=? WHERE job_id=?',module,assigned.mode,assigned.profile_id,assigned.agent_role,row.status==='RUNNING'?1:Math.max(row.blocked,assigned.blocked),row.id);
    run("UPDATE jobs SET status='QUEUED',host=NULL,lease_token=NULL,lease_until=NULL WHERE id=?",row.id);
   }
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }

 return {state,route,configure,token,authenticate,resolve,enabled:()=>!!settings().enabled,configuration,master,propose,decide,conversation,retry,dshSessions,dshModels};
}
