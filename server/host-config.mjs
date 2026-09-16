import {existsSync,mkdirSync} from 'node:fs';
import {dirname,join,isAbsolute} from 'node:path';
export function hostConfig(db,file){
 const one=(q,...a)=>db.prepare(q).get(...a),run=(q,...a)=>db.prepare(q).run(...a);
 if(!one("SELECT name FROM sqlite_master WHERE name='host_settings'")){
  if(file!==':memory:'){const dir=join(dirname(file),'backups');mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(join(dir,'before-host-wakeup-'+Date.now()+'.sqlite'));}
  db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE host_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,executable TEXT NOT NULL DEFAULT 'codex',model TEXT NOT NULL DEFAULT '',effort TEXT NOT NULL DEFAULT 'low',timeout_seconds INTEGER NOT NULL DEFAULT 300);
   INSERT INTO host_settings(id) VALUES(1);
   CREATE TABLE host_runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),status TEXT NOT NULL,thread_id TEXT,model TEXT NOT NULL,error TEXT,usage TEXT NOT NULL DEFAULT '{}',tool_calls INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,ended_at TEXT);
   CREATE INDEX host_run_job ON host_runs(job_id);
   COMMIT;`);
 }
 function settings(){const {id,...s}=one('SELECT * FROM host_settings');return {...s,enabled:!!s.enabled};}
 function save(a){const old=settings(),s={...old,...a};if(typeof s.enabled!=='boolean')throw new Error('启用值无效');if(typeof s.executable!=='string'||(s.executable!=='codex'&&(!isAbsolute(s.executable)||!existsSync(s.executable)||!/codex(?:\.exe)?$/i.test(s.executable))))throw new Error('请选择本机 Codex 可执行文件，或填写 codex');if(typeof s.model!=='string'||s.model.length>150||/[\r\n]/.test(s.model))throw new Error('模型名无效');if(!['low','medium','high','xhigh'].includes(s.effort))throw new Error('推理强度无效');const seconds=Number(s.timeout_seconds);if(!Number.isInteger(seconds)||seconds<30||seconds>1800)throw new Error('超时范围为 30–1800 秒');run('UPDATE host_settings SET enabled=?,executable=?,model=?,effort=?,timeout_seconds=?',s.enabled?1:0,s.executable,s.model.trim(),s.effort,seconds);return settings();}
 function state(){return {settings:settings(),runs:db.prepare('SELECT * FROM host_runs ORDER BY rowid DESC LIMIT 100').all().map(r=>({...r,usage:JSON.parse(r.usage)}))};}
 return {settings,save,state};
}
