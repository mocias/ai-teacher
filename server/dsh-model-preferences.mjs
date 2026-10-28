import {readDshCatalog} from './dsh-model.mjs';
import {mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

const fail=message=>{throw Object.assign(new Error(message),{status:409});};
export function dshModelPreferences(db,file){
 const one=(sql,...args)=>db.prepare(sql).get(...args);
 if(!one("SELECT name FROM sqlite_master WHERE name='dsh_conversation_models'")){
  if(file!==':memory:'){const dir=join(dirname(file),'backups');mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(join(dir,'before-dsh-model-picker-'+Date.now()+'.sqlite'));}
  db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE dsh_conversation_models(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),model TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE dsh_job_models(job_id TEXT PRIMARY KEY REFERENCES jobs(id),model TEXT NOT NULL);
   CREATE TABLE dsh_run_models(run_id TEXT PRIMARY KEY REFERENCES harness_runs(id),provider TEXT NOT NULL,model TEXT NOT NULL,source TEXT NOT NULL);
   COMMIT;`);
 }
 let reader=readDshCatalog;
 const get=cid=>one('SELECT model FROM dsh_conversation_models WHERE conversation_id=?',cid)?.model||'';
 const catalog=()=>{try{return reader();}catch(error){return {models:[],default_model:null,source:'DSH',error:error.message};}};
 function validate(model){if(typeof model!=='string'||model.length>150)fail('模型选择无效');if(model&&!catalog().models.some(row=>row.id===model))fail('该模型不在当前 DSH 列表中，请刷新模型列表后选择');return model;}
 function save(cid,model){
  if(!one('SELECT id FROM conversations WHERE id=?',cid))fail('对话不存在');validate(model);
  db.prepare('INSERT INTO dsh_conversation_models VALUES(?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET model=excluded.model,updated_at=excluded.updated_at').run(cid,model,new Date().toISOString());
  return {conversation_id:cid,model};
 }
 function freeze(job,route){
  if(route.mode!=='MCP'||route.harness!=='DSH'){db.prepare('DELETE FROM dsh_job_models WHERE job_id=?').run(job.id);return;}
  db.prepare('INSERT INTO dsh_job_models VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET model=excluded.model').run(job.id,get(job.conversation_id)||route.model||'');
 }
 function forJob(job,route){if(route.harness!=='DSH')return route;return {...route,model:one('SELECT model FROM dsh_job_models WHERE job_id=?',job.id)?.model??(get(job.conversation_id)||route.model||'')};}
 function record(runId,value){if(value?.selection)db.prepare('INSERT INTO dsh_run_models VALUES(?,?,?,?)').run(runId,value.selection.provider,value.selection.model,value.source);}
 return {get,save,freeze,forJob,record,validate,catalog,state:()=>db.prepare('SELECT * FROM dsh_conversation_models').all(),setCatalogReader:fn=>{reader=fn;}};
}
