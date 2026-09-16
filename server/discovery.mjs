import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

export const draftFields={direction:'学习方向',background:'当前基础',level:'期望达到的层级',outcome:'具体能做什么',exclusions:'本次暂不涉及的内容'};
export const discoveryPrompt=`你是主页的学习目标讨论助手。用户可以从模糊想法开始，不需要先创建目标。每轮只追问一个关键问题，引导用户收敛到一个具体方向；不要一次给出多个学习方向。先明确目标宽泛程度、期望层级和具体成果；基础采用用户自述，正式诊断留到创建目标之后。信息足够时用 teacher_propose_goal_draft 提交一份五字段草案，不必机械地把五项问一遍，未知内容可写待明确。参考提供的已有目标名称、状态和画像摘要，不能读取资料、笔记或其他对话。不关联材料，不创建学习路线或进行正式考察。草案的 manual_fields 由用户手动修改，提出改变时说明理由；服务端会把这些改变保留为待接受建议。提交时必须使用当前 revision；冲突时重新读取上下文。草案只是提议，只有用户点击确认才能创建正式目标。summary 是本次讨论的简短关键摘要，不包含内部推理。每次工具调用后还需给出用户可见回复，宿主用 teacher_reply 写回。`;
const now=()=>new Date().toISOString();
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
export function migrateDiscovery(db,file){
 if(db.prepare("SELECT name FROM sqlite_master WHERE name='goal_discussions'").get())return;
 if(file!==':memory:'){const folder=join(dirname(file),'backups');mkdirSync(folder,{recursive:true});db.prepare('VACUUM INTO ?').run(join(folder,'before-goal-discussions-'+Date.now()+'.sqlite'));}
 // Rebuild only this table with foreign keys temporarily disabled; keep IDs and all references.
 db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
 try{
  db.exec(`CREATE TABLE conversations_next(id TEXT PRIMARY KEY,goal_id TEXT REFERENCES goals(id),title TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'PLANNING',created_at TEXT NOT NULL);
   INSERT INTO conversations_next SELECT * FROM conversations;
   DROP TABLE conversations;
   ALTER TABLE conversations_next RENAME TO conversations;
   CREATE TABLE goal_discussions(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),draft TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 0,manual_fields TEXT NOT NULL DEFAULT '[]',suggestion TEXT,summary TEXT NOT NULL DEFAULT '',goal_id TEXT UNIQUE REFERENCES goals(id),target_conversation_id TEXT REFERENCES conversations(id),updated_at TEXT NOT NULL);
   CREATE TABLE discussion_inputs(conversation_id TEXT PRIMARY KEY REFERENCES goal_discussions(conversation_id),content TEXT NOT NULL DEFAULT '');`);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('目标讨论升级外键检查失败');
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON');}
}
export function discoveryService(db,{send,newConversation,receipt}){
 const one=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 const parse=row=>row?{...row,draft:JSON.parse(row.draft),manual_fields:JSON.parse(row.manual_fields),suggestion:row.suggestion?JSON.parse(row.suggestion):null}:null;
 function get(id){const row=parse(one('SELECT * FROM goal_discussions WHERE conversation_id=?',id));if(!row)fail('目标讨论不存在');return row;}
 function writable(id,revision){const d=get(id);if(d.goal_id)fail('目标已创建，探索记录只读');if(d.revision!==revision)fail('草案已有更新，请刷新后再修改');return d;}
 function fields(value,complete=false){if(!value||typeof value!=='object'||Array.isArray(value))fail('草案格式无效');const result={};for(const [key,label] of Object.entries(draftFields)){if(!Object.hasOwn(value,key)&&!complete)continue;const v=value[key];if(typeof v!=='string'||v.length>(key==='direction'?150:1000)||(complete&&!v.trim()))fail(label+'不能为空或过长');result[key]=v.trim();}return result;}
 function create(a){return receipt(a.request_id,'discussion-create',()=>{const id=randomUUID();run('INSERT INTO conversations VALUES(?,?,?,?,?)',id,null,'新的目标讨论','DISCOVERY',now());run('INSERT INTO goal_discussions(conversation_id,updated_at) VALUES(?,?)',id,now());return get(id);});}
 function save(a){const d=get(a.conversation_id);if(d.goal_id)fail('目标已创建，探索记录只读');if(!Number.isInteger(a.revision)||a.revision>d.revision)fail('草案版本无效');const changes=fields(a.draft),manual=new Set(d.manual_fields);for(const k of Object.keys(changes))if(changes[k]!==d.draft[k])manual.add(k);run('UPDATE goal_discussions SET draft=?,manual_fields=?,revision=revision+1,suggestion=NULL,updated_at=? WHERE conversation_id=?',JSON.stringify({...d.draft,...changes}),JSON.stringify([...manual]),now(),a.conversation_id);return get(a.conversation_id);}
 function propose(a){return receipt(a.request_id,'goal-draft:'+a.conversation_id,()=>{
  const d=writable(a.conversation_id,a.revision),next=fields(a.draft,true);if(typeof a.summary!=='string'||a.summary.length>2000)fail('讨论摘要无效');
  const draft={...d.draft},pending={};for(const [k,v] of Object.entries(next)){if(d.manual_fields.includes(k)&&d.draft[k]!==v)pending[k]=v;else draft[k]=v;}
  const suggestion=Object.keys(pending).length?JSON.stringify(pending):null;
  run('UPDATE goal_discussions SET draft=?,suggestion=?,summary=?,revision=revision+1,updated_at=? WHERE conversation_id=?',JSON.stringify(draft),suggestion,a.summary,now(),a.conversation_id);
  run('UPDATE conversations SET title=? WHERE id=?',draft.direction||'目标讨论',a.conversation_id);return get(a.conversation_id);
 });}
 function decide(a){const d=writable(a.conversation_id,a.revision);if(typeof a.accept!=='boolean'||!d.suggestion)fail('没有待处理的修改建议');run('UPDATE goal_discussions SET draft=?,suggestion=NULL,revision=revision+1,updated_at=? WHERE conversation_id=?',JSON.stringify(a.accept?{...d.draft,...d.suggestion}:d.draft),now(),a.conversation_id);return get(a.conversation_id);}
 function saveInput(a){const d=get(a.conversation_id);if(d.goal_id)fail('探索记录只读');if(typeof a.content!=='string'||a.content.length>20000)fail('输入过长');run('INSERT INTO discussion_inputs VALUES(?,?) ON CONFLICT(conversation_id) DO UPDATE SET content=excluded.content',a.conversation_id,a.content);return {ok:true};}
 function confirm(a){const prior=get(a.conversation_id);if(prior.goal_id)return {goal_id:prior.goal_id,conversation_id:prior.target_conversation_id};return receipt(a.request_id,'discussion-confirm:'+a.conversation_id,()=>{
  const d=writable(a.conversation_id,a.revision);if(one("SELECT id FROM jobs WHERE conversation_id=? AND status IN ('QUEUED','RUNNING')",a.conversation_id))fail('请等待回复完成，或取消待处理消息后再创建目标');
  const draft=fields(d.draft,true),gid=randomUUID(),scope=Object.entries(draftFields).map(([k,label])=>label+'：'+draft[k]).join('\n');
  run('INSERT INTO goals VALUES(?,?,?,?,?,?)',gid,draft.direction,draft.direction.slice(0,100),scope,'INITIALIZING',now());
  const c=newConversation(gid,'目标与学习计划');run('UPDATE goal_discussions SET goal_id=?,target_conversation_id=?,suggestion=NULL,updated_at=? WHERE conversation_id=?',gid,c.id,now(),a.conversation_id);
  // Carry the agreed draft and discussion summary forward without turning exploration into evidence.
  run('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',randomUUID(),c.id,'assistant','已确认学习目标：\n'+scope+(d.summary?'\n\n讨论摘要：'+d.summary:'')+'\n\n接下来可以讨论能力要求与学习计划。',now(),null,'学习工作台');
  return {goal_id:gid,conversation_id:c.id};
 });}
 function context(id){const d=get(id);return {discussion:d,instructions:discoveryPrompt,background:all('SELECT g.title,g.status,substr(p.content,1,1200) AS profile_summary FROM goals g LEFT JOIN profiles p ON p.goal_id=g.id ORDER BY g.created_at DESC LIMIT 30')};}
 return {get,create,save,propose,decide,saveInput,confirm,context,state:()=>all('SELECT d.*,i.content AS unsent FROM goal_discussions d LEFT JOIN discussion_inputs i ON i.conversation_id=d.conversation_id ORDER BY d.updated_at DESC').map(parse)};
}
