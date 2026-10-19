import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

export const modules={chat:'普通对话',material:'资料分析',capabilities:'能力要求',roadmap:'学习路线',assessment:'诊断与学习考察',review:'复习与强化',final:'最终综合面试',reading:'阅读答疑',onboarding:'首次画像引导',change_review:'修改后的追问'};
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const str=(v,label,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(label+'无效');return v.trim();};
export function normalizeBase(value){
 let u;try{u=new URL(str(value,'Base URL',2000));}catch{fail('请输入有效的 Base URL');}
 if(u.username||u.password||u.search||u.hash)fail('Base URL 不可包含凭据、查询参数或片段');
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))fail('远程服务必须使用 HTTPS；本机可使用 HTTP');
 u.pathname=u.pathname.replace(/\/chat\/completions\/?$/,'').replace(/\/+$/,'');return u.href.replace(/\/$/,'');
}
export function modelConfig(db,file){
 const one=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 if(!one("SELECT name FROM sqlite_master WHERE name='model_profiles'")){
  if(file!==':memory:'){const dir=join(dirname(file),'backups');mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(join(dir,'before-model-routing-'+Date.now()+'.sqlite'));}
  db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE model_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,base_url TEXT NOT NULL,model TEXT NOT NULL,key_cipher TEXT,options TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE model_routes(module TEXT PRIMARY KEY,profile_id TEXT REFERENCES model_profiles(id));
   CREATE TABLE model_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0);
   INSERT INTO model_settings VALUES(1,0);
   CREATE TABLE job_execution(job_id TEXT PRIMARY KEY REFERENCES jobs(id),module TEXT NOT NULL,content_id TEXT REFERENCES material_contents(id),mode TEXT NOT NULL,profile_id TEXT REFERENCES model_profiles(id),blocked INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE model_runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),module TEXT NOT NULL,profile_id TEXT NOT NULL,provider_name TEXT NOT NULL,model TEXT NOT NULL,base_url TEXT NOT NULL,status TEXT NOT NULL,error TEXT,steps INTEGER NOT NULL DEFAULT 0,usage TEXT NOT NULL DEFAULT '{}',trace TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,ended_at TEXT);
   CREATE INDEX model_run_job ON model_runs(job_id);
   COMMIT;`);
 }
 let resolver=()=>null,routingEnabled=()=>false;
 let master;
 function masterKey(){if(master)return master;if(file===':memory:')return master=randomBytes(32);const path=join(dirname(file),'model-vault.key');if(!existsSync(path))writeFileSync(path,randomBytes(32),{mode:0o600,flag:'wx'});master=readFileSync(path);if(master.length!==32)fail('模型凭据存储不可读');return master;}
 function encrypt(key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',masterKey(),iv);return Buffer.concat([iv,cipher.update(key,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');}
 function decrypt(value){if(!value)return '';try{const raw=Buffer.from(value,'base64'),dec=createDecipheriv('aes-256-gcm',masterKey(),raw.subarray(0,12));dec.setAuthTag(raw.subarray(-16));return Buffer.concat([dec.update(raw.subarray(12,-16)),dec.final()]).toString();}catch{fail('无法读取模型 Key，请重新保存');}}
 function profile(id,secret=false){const p=one('SELECT * FROM model_profiles WHERE id=?',id);if(!p)fail('模型配置不存在');const {key_cipher,options,...safe}=p;return {...safe,options:JSON.parse(options),has_key:!!key_cipher,...(secret?{key:decrypt(key_cipher)}:{})};}
 function save(a){
  if(a.clear_key!==undefined&&typeof a.clear_key!=='boolean')fail('清除 Key 的值无效');
  const old=a.id?profile(a.id):null,name=str(a.name,'配置名称'),base_url=normalizeBase(a.base_url),model=str(a.model,'模型名');
  const options={};for(const [key,min,max] of [['temperature',0,2],['max_tokens',1,100000],['timeout_seconds',5,180]])if(a.options?.[key]!==undefined&&a.options[key]!==null&&a.options[key]!==''){const n=Number(a.options[key]);if(!Number.isFinite(n)||n<min||n>max||(key!=='temperature'&&!Number.isInteger(n)))fail(key+'数值无效');options[key]=n;}
  options.token_parameter=a.options?.token_parameter||'max_tokens';if(!['max_tokens','max_completion_tokens'].includes(options.token_parameter))fail('输出参数无效');
  if(a.key!==undefined&&typeof a.key!=='string')fail('Key 无效');if(a.key&&(a.key.length>4096||/[\r\n]/.test(a.key)))fail('Key 无效');
  if(old&&old.base_url!==base_url&&old.has_key&&!a.key&&!a.clear_key)fail('更换 Base URL 时请重新填写 Key 或明确清除旧 Key');
  const key=a.clear_key?null:a.key?.trim()?encrypt(a.key.trim()):old?one('SELECT key_cipher FROM model_profiles WHERE id=?',old.id).key_cipher:null;
  const id=old?.id||randomUUID();run('INSERT INTO model_profiles VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,model=excluded.model,key_cipher=excluded.key_cipher,options=excluded.options,updated_at=excluded.updated_at',id,name,base_url,model,key,JSON.stringify(options),new Date().toISOString());return profile(id);
 }
 function routes(a){if(!Array.isArray(a.routes))fail('路由无效');for(const r of a.routes){if(!Object.hasOwn(modules,r.module))fail('模块无效');if(r.profile_id)profile(r.profile_id);}db.exec('BEGIN IMMEDIATE');try{for(const r of a.routes)run('INSERT INTO model_routes VALUES(?,?) ON CONFLICT(module) DO UPDATE SET profile_id=excluded.profile_id',r.module,r.profile_id||null);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {ok:true};}
 function enabled(value){if(value===undefined)return !!one('SELECT enabled FROM model_settings').enabled;if(typeof value!=='boolean')fail('启用值无效');run('UPDATE model_settings SET enabled=?',value?1:0);return {ok:true};}
 function infer(job){const kind=one('SELECT kind FROM conversations WHERE id=?',job.conversation_id)?.kind;if(routingEnabled()&&['READING','ONBOARDING','CHANGE_REVIEW'].includes(kind))return kind.toLowerCase();const a=one('SELECT kind FROM assessments WHERE conversation_id=?',job.conversation_id);return a?a.kind==='FINAL'?'final':['REVIEW','REVIEW_DIAGNOSTIC','REINFORCEMENT'].includes(a.kind)?'review':'assessment':'chat';}
 function validateTask(c,module,content_id){if(module&&!Object.hasOwn(modules,module))fail('任务用途无效');if(one("SELECT id FROM conversations WHERE id=? AND kind IN ('DISCOVERY','READING','ONBOARDING','CHANGE_REVIEW','ORCHESTRATION')",c)&&module&&module!=='chat'&&module!==infer({conversation_id:c}))fail(routingEnabled()?'此对话不支持该任务用途':'主页讨论仅支持普通对话');if(['reading','onboarding','change_review'].includes(module)&&one('SELECT kind FROM conversations WHERE id=?',c)?.kind!==module.toUpperCase())fail('任务用途与对话不匹配');const a=one('SELECT kind FROM assessments WHERE conversation_id=?',c);if(a&&module&&module!==infer({conversation_id:c}))fail('考察任务类型由考察决定');if(module==='material'){const r=one('SELECT c.id FROM material_contents c JOIN resources r ON r.id=c.resource_id JOIN conversations v ON v.goal_id=r.goal_id WHERE c.id=? AND v.id=?',content_id||'',c);if(!r)fail('资料分析需选择当前目标的正文版本');}}
 function tag(job_id,module,content_id){const j=one('SELECT * FROM jobs WHERE id=?',job_id);if(!j)fail('任务不存在');const previous=one('SELECT * FROM job_execution WHERE job_id=?',j.id);if(previous)return previous;module=module||infer(j);if(routingEnabled()&&module==='chat'&&['reading','onboarding','change_review'].includes(infer(j)))module=infer(j);validateTask(j.conversation_id,module,content_id);const route=one('SELECT profile_id FROM model_routes WHERE module=?',module);const assigned=resolver(j,module);run('INSERT INTO job_execution(job_id,module,content_id,mode,profile_id,blocked) VALUES(?,?,?,?,?,?)',j.id,module,content_id||null,assigned?.mode||(route?.profile_id?'API':'HOST'),assigned?.profile_id||(!assigned?route?.profile_id:null)||null,assigned?.blocked||0);if(assigned)run('UPDATE job_execution SET agent_role=? WHERE job_id=?',assigned.agent_role,j.id);return one('SELECT * FROM job_execution WHERE job_id=?',j.id);}
 function sync(){for(const j of all("SELECT j.* FROM jobs j LEFT JOIN job_execution e ON e.job_id=j.id WHERE e.job_id IS NULL AND j.status='QUEUED'"))tag(j.id);}
 function reroute(a){const j=one('SELECT * FROM jobs WHERE id=?',a.job_id);if(!j||j.status!=='QUEUED')fail('仅等待中的任务可改执行方式');const e=one('SELECT * FROM job_execution WHERE job_id=?',j.id)||tag(j.id);if(e.agent_role)fail('请使用 Agent 任务重试入口');if(one("SELECT id FROM model_runs WHERE job_id=? AND status='RUNNING'",j.id))fail('任务仍在执行');if(a.mode==='HOST'){run("UPDATE job_execution SET mode='HOST',profile_id=NULL,blocked=0 WHERE job_id=?",j.id);}else if(a.mode==='API'){const p=a.profile_id||one('SELECT profile_id FROM model_routes WHERE module=?',e.module)?.profile_id;if(!p)fail('此模块尚未指定模型');profile(p);run("UPDATE job_execution SET mode='API',profile_id=?,blocked=0 WHERE job_id=?",p,j.id);}else fail('执行方式无效');return {ok:true};}
 function state(){return {enabled:enabled(),modules,profiles:all('SELECT id FROM model_profiles').map(p=>profile(p.id)),routes:Object.keys(modules).map(module=>({module,profile_id:one('SELECT profile_id FROM model_routes WHERE module=?',module)?.profile_id||null})),tasks:all('SELECT * FROM job_execution'),runs:all('SELECT id,job_id,module,profile_id,provider_name,model,status,error,steps,usage,created_at,ended_at FROM model_runs ORDER BY rowid DESC LIMIT 100').map(r=>({...r,usage:JSON.parse(r.usage)}))};}
 return {state,profile,save,routes,enabled,tag,sync,validateTask,reroute,setResolver(fn,enabled){resolver=fn;routingEnabled=enabled;}};
}
