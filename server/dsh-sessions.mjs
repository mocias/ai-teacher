import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,copyFileSync,renameSync,realpathSync,openSync,readSync,closeSync,fsyncSync} from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import {join,dirname,resolve,relative,isAbsolute,sep} from 'node:path';

const now=()=>new Date().toISOString();
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const same=(a,b)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
const alive=pid=>{if(!pid)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
function inside(root,path){const part=relative(root,path);if(part==='..'||part.startsWith('..'+sep)||isAbsolute(part))fail('DSH 工作区路径超出学习数据目录');return path;}
function header(file){const fd=openSync(file,'r');try{const buffer=Buffer.alloc(65536),size=readSync(fd,buffer,0,buffer.length,0),end=buffer.subarray(0,size).indexOf(10);if(end<0)fail('DSH 会话日志头不完整');const value=JSON.parse(buffer.subarray(0,end).toString('utf8'));if(value.type!=='session'||typeof value.id!=='string'||typeof value.cwd!=='string')fail('DSH 会话日志头无效');return value;}finally{closeSync(fd);}}
function hashFile(file,validate=false){const fd=openSync(file,'r'),hash=createHash('sha256'),decoder=new StringDecoder('utf8');let pending='';try{const buffer=Buffer.alloc(65536);let size;while((size=readSync(fd,buffer,0,buffer.length,null))>0){hash.update(buffer.subarray(0,size));if(validate){pending+=decoder.write(buffer.subarray(0,size));let end;while((end=pending.indexOf('\n'))>=0){try{JSON.parse(pending.slice(0,end));}catch{fail('DSH 会话日志包含损坏的记录，请恢复检查点');}pending=pending.slice(end+1);}if(pending.length>16_000_000)fail('DSH 会话日志单条记录超过检查限制');}}if(validate&&(pending+decoder.end()).length)fail('DSH 会话日志尾部不完整，请恢复检查点');return hash.digest('hex');}finally{closeSync(fd);}}
function atomicCopy(source,target){const stage=target+'.'+randomUUID()+'.tmp';mkdirSync(dirname(target),{recursive:true});copyFileSync(source,stage);const fd=openSync(stage,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(stage,target);}
function logFiles(root,depth=0){
 if(!existsSync(root))return [];if(depth>3)fail('DSH 会话日志目录结构异常');
 const files=[],generations=[];for(const entry of readdirSync(root,{withFileTypes:true})){
  if(entry.isSymbolicLink())fail('DSH 会话目录包含不受支持的链接');const path=join(root,entry.name);
  if(entry.isDirectory())files.push(...logFiles(path,depth+1));else if(entry.isFile()&&/^session(?:\.v\d+)?\.jsonl$/.test(entry.name))generations.push(path);
 }
 generations.sort((a,b)=>Number(b.match(/\.v(\d+)\./)?.[1]||0)-Number(a.match(/\.v(\d+)\./)?.[1]||0));if(generations[0])files.push(generations[0]);return files;
}

export function dshSessionService(db,file){
 const one=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 if(!one("SELECT name FROM sqlite_master WHERE name='dsh_sessions'")){
  if(file!==':memory:'){const dir=join(dirname(file),'backups');mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(join(dir,'before-dsh-sessions-'+Date.now()+'.sqlite'));}
  db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE dsh_sessions(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),session_id TEXT UNIQUE,workspace_key TEXT NOT NULL UNIQUE,workspace_layout TEXT NOT NULL DEFAULT 'SHARED',generation INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL DEFAULT 'NEW',cwd TEXT,last_job_id TEXT REFERENCES jobs(id),last_run_id TEXT,process_pid INTEGER,error TEXT,log_path TEXT,checkpoint_path TEXT,checkpoint_hash TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE dsh_session_history(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),session_id TEXT,generation INTEGER NOT NULL,cwd TEXT,log_path TEXT,checkpoint_path TEXT,archived_at TEXT NOT NULL);
   ALTER TABLE harness_runs ADD COLUMN dsh_session_id TEXT;
   ALTER TABLE harness_runs ADD COLUMN workspace_path TEXT;
   COMMIT;`);
 }
 if(!db.prepare('PRAGMA table_info(dsh_sessions)').all().some(column=>column.name==='workspace_layout')){
  if(file!==':memory:'){const dir=join(dirname(file),'backups');mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(join(dir,'before-dsh-shared-workspace-'+Date.now()+'.sqlite'));}
  db.exec("ALTER TABLE dsh_sessions ADD COLUMN workspace_layout TEXT NOT NULL DEFAULT 'LEGACY'");
 }
 const get=id=>one('SELECT * FROM dsh_sessions WHERE conversation_id=?',id);
 const workspace=dataDir=>resolve(dataDir,'ai-teacher-workspace');
 function paths(row,dataDir){if(row.workspace_key!==createHash('sha256').update(row.conversation_id).digest('hex')||!Number.isSafeInteger(row.generation)||row.generation<1||!['LEGACY','SHARED'].includes(row.workspace_layout))fail('DSH 工作区映射无效');const legacy=row.workspace_layout==='LEGACY',root=legacy?resolve(dataDir,'dsh-workspaces',row.workspace_key):resolve(dataDir,'dsh-runtime','conversations',row.workspace_key),home=legacy?join(root,'runtime','g'+row.generation):join(root,'g'+row.generation);return {root,workDir:legacy?join(root,'workspace'):workspace(dataDir),home,logs:join(home,'sessions'),checkpoint:join(home,'checkpoints','latest.jsonl')};}
 function safePaths(row,dataDir,create=false){const p=paths(row,dataDir),data=resolve(dataDir);inside(data,p.root);const check=()=>{for(const path of [join(data,'dsh-workspaces'),join(data,'dsh-runtime'),join(data,'dsh-runtime','conversations'),p.root,dirname(p.home),p.home,p.workDir,p.logs,dirname(p.checkpoint)])if(existsSync(path)){const actual=realpathSync(path),expected=resolve(realpathSync(data),relative(data,path));if(!same(actual,expected))fail('DSH 工作区包含改变目录归属的链接，已停止恢复');}};check();if(create){mkdirSync(p.workDir,{recursive:true});mkdirSync(p.home,{recursive:true});check();}return p;}
 function idle(row){if(row.state==='RUNNING'||row.process_pid&&alive(row.process_pid))fail('该对话上一次 DSH 进程仍在运行，请等待其退出后恢复');if(one("SELECT id FROM jobs WHERE conversation_id=? AND status='RUNNING'",row.conversation_id))fail('该对话仍有执行中的任务，请先取消或等待完成');}
 function locate(row,p){const files=logFiles(p.logs);const matches=[];for(const path of files){let h;try{h=header(path);}catch{fail('DSH 会话日志损坏，请检查并恢复检查点');}if(!same(h.cwd,p.workDir))fail('DSH 会话记录的工作目录已改变，请恢复原目录或重建会话');if(row.session_id&&h.id!==row.session_id)fail('DSH 工作区出现其他会话，已停止自动恢复');matches.push({path,header:h});}if(matches.length>1){const ids=new Set(matches.map(item=>item.header.id));if(ids.size>1)fail('DSH 工作区包含多个会话，无法自动选择');matches.sort((a,b)=>Number(b.path.match(/\.v(\d+)\./)?.[1]||0)-Number(a.path.match(/\.v(\d+)\./)?.[1]||0));}return matches[0];}
 function remember(id,sessionId,cwd,dataDir){if(typeof sessionId!=='string'||!/^session-[A-Za-z0-9_-]{1,150}$/.test(sessionId))fail('DSH 返回了无效的会话标识');const row=get(id),p=safePaths(row,dataDir);if(!same(cwd||'',p.workDir))fail('DSH 返回的工作区与当前对话不一致');if(row.session_id&&row.session_id!==sessionId)fail('DSH 返回的会话与站内映射不一致');try{run('UPDATE dsh_sessions SET session_id=?,cwd=?,updated_at=? WHERE conversation_id=?',sessionId,p.workDir,now(),id);run('UPDATE harness_runs SET dsh_session_id=? WHERE id=?',sessionId,row.last_run_id);}catch{fail('DSH 会话已绑定其他站内对话，不能重复使用');}}
 function prepare(id,{dataDir,jobId,runId}){
  if(!one('SELECT id FROM conversations WHERE id=?',id))fail('站内对话不存在');
  let row=get(id);if(!row){run("INSERT INTO dsh_sessions(conversation_id,workspace_key,workspace_layout,created_at,updated_at) VALUES(?,?,'SHARED',?,?)",id,createHash('sha256').update(id).digest('hex'),now(),now());row=get(id);}
  if(row.process_pid&&alive(row.process_pid))fail('该对话的 DSH 进程尚未退出，不能同时恢复');
  if(row.workspace_layout==='LEGACY'){archiveAndReset(row,dataDir);row=get(id);}
  let p,found;try{p=safePaths(row,dataDir,true);if(row.cwd&&!same(row.cwd,p.workDir))fail('学习数据目录已移动，原 DSH 工作区路径不再一致；请检查后重建会话');found=locate(row,p);if(row.session_id&&!found)fail('DSH 会话日志缺失，请检查并恢复检查点');if(!row.session_id&&found){remember(id,found.header.id,found.header.cwd,dataDir);row=get(id);}}
  catch(error){run("UPDATE dsh_sessions SET state='RECOVERY_REQUIRED',error=?,updated_at=? WHERE conversation_id=?",error.message,now(),id);throw error;}
  run("UPDATE dsh_sessions SET state='RUNNING',cwd=?,last_job_id=?,last_run_id=?,process_pid=NULL,error=NULL,updated_at=? WHERE conversation_id=?",p.workDir,jobId,runId,now(),id);
  run('UPDATE harness_runs SET workspace_path=?,dsh_session_id=? WHERE id=?',p.workDir,row.session_id,runId);
  return {...p,sessionId:row.session_id,generation:row.generation};
 }
 function pid(id,value){run('UPDATE dsh_sessions SET process_pid=? WHERE conversation_id=?',Number.isInteger(value)?value:null,id);}
 function finish(id,{dataDir,runId,completed,clean,interrupted,error}){
  const row=get(id);if(!row||row.last_run_id!==runId)return;
  let state=interrupted?'INTERRUPTED':completed&&clean?'READY':'FAILED',message=error||null;
  try{const p=safePaths(row,dataDir),found=locate(row,p);if(!row.session_id&&found)remember(id,found.header.id,found.header.cwd,dataDir);
   if(completed&&clean){if(!found)fail('DSH 已回写，但会话日志尚未完整落盘，请检查恢复');const checksum=hashFile(found.path,true);atomicCopy(found.path,p.checkpoint);run('UPDATE dsh_sessions SET log_path=?,checkpoint_path=?,checkpoint_hash=? WHERE conversation_id=?',relative(p.home,found.path),relative(p.home,p.checkpoint),checksum,id);}
  }catch(problem){state='RECOVERY_REQUIRED';message=problem.message;}
  run('UPDATE dsh_sessions SET state=?,error=?,process_pid=NULL,updated_at=? WHERE conversation_id=?',state,message,now(),id);
 }
 function recover(){for(const row of db.prepare("SELECT * FROM dsh_sessions WHERE state='RUNNING'").all()){const job=one('SELECT status FROM jobs WHERE id=?',row.last_job_id);run("UPDATE dsh_sessions SET state='INTERRUPTED',error=?,process_pid=?,updated_at=? WHERE conversation_id=?",job?.status==='COMPLETED'?'上次回复已保存；DSH 退出状态未确认，下一轮继续恢复原会话':'上次执行中断；保留原会话，检查后重试原任务',row.process_pid&&alive(row.process_pid)?row.process_pid:null,now(),row.conversation_id);}}
 function check(id,{dataDir,restore=false}={}){
  const row=get(id);if(!row)fail('该对话尚未创建 DSH 会话');idle(row);const p=safePaths(row,dataDir,true);let problem;
  try{if(row.cwd&&!same(row.cwd,p.workDir))fail('原工作区路径已改变，请恢复原路径或重建会话');const found=locate(row,p);if(row.session_id&&!found)fail('会话日志缺失');if(found)hashFile(found.path,true);if(!row.session_id&&found)remember(id,found.header.id,found.header.cwd,dataDir);if(!restore){run("UPDATE dsh_sessions SET state=?,error=NULL,process_pid=NULL,updated_at=? WHERE conversation_id=?",get(id).session_id?'READY':'NEW',now(),id);return get(id);}}catch(error){problem=error.message;}
  if(restore&&(!row.session_id||!row.log_path||!row.checkpoint_path))fail('没有可用检查点，请检查当前日志或明确重建会话');
  if(restore&&row.session_id&&row.log_path&&row.checkpoint_path){try{
   const checkpoint=inside(p.home,resolve(p.home,row.checkpoint_path)),target=inside(p.home,resolve(p.home,row.log_path));
   if(!existsSync(checkpoint))fail('没有可用检查点，请保留当前目录后重建会话');const h=header(checkpoint);if(h.id!==row.session_id||!same(h.cwd,p.workDir))fail('检查点与当前会话或工作区不一致');if(!row.checkpoint_hash||hashFile(checkpoint,true)!==row.checkpoint_hash)fail('DSH 检查点校验失败，已保留原日志；请使用完整备份或重建会话');
   mkdirSync(dirname(target),{recursive:true});if(existsSync(target))copyFileSync(target,target+'.before-recovery-'+Date.now());atomicCopy(checkpoint,target);
   const found=locate(row,p);if(!found)fail('检查点恢复失败');run("UPDATE dsh_sessions SET state='READY',error=NULL,process_pid=NULL,updated_at=? WHERE conversation_id=?",now(),id);return get(id);
  }catch(error){run("UPDATE dsh_sessions SET state='RECOVERY_REQUIRED',error=?,updated_at=? WHERE conversation_id=?",error.message,now(),id);throw error;}
  }
  run("UPDATE dsh_sessions SET state='RECOVERY_REQUIRED',error=?,updated_at=? WHERE conversation_id=?",problem,now(),id);return get(id);
 }
 function archiveAndReset(row,dataDir){const p=safePaths(row,dataDir);db.exec('BEGIN IMMEDIATE');try{run('INSERT INTO dsh_session_history VALUES(?,?,?,?,?,?,?,?)',randomUUID(),row.conversation_id,row.session_id,row.generation,row.cwd,row.log_path?inside(p.home,resolve(p.home,row.log_path)):null,row.checkpoint_path?inside(p.home,resolve(p.home,row.checkpoint_path)):null,now());run("UPDATE dsh_sessions SET session_id=NULL,workspace_layout='SHARED',generation=generation+1,state='NEW',cwd=NULL,last_job_id=NULL,last_run_id=NULL,process_pid=NULL,error=NULL,log_path=NULL,checkpoint_path=NULL,checkpoint_hash=NULL,updated_at=? WHERE conversation_id=?",now(),row.conversation_id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return get(row.conversation_id);}
 function reset(id,{dataDir}={}){const row=get(id);if(!row)fail('该对话尚无 DSH 会话');idle(row);return archiveAndReset(row,dataDir);}
 function state(){return db.prepare('SELECT s.*,c.title AS conversation_title FROM dsh_sessions s JOIN conversations c ON c.id=s.conversation_id ORDER BY s.updated_at DESC LIMIT 100').all();}
 return {get,paths,workspace,prepare,remember,pid,finish,recover,check,reset,state};
}
