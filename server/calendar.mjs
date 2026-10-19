import {randomUUID} from 'node:crypto';
import {schedulePreview} from './scheduling.mjs';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function calendarService(db,{receipt,remediationEntry=()=>null}={}){
 db.exec("CREATE TABLE IF NOT EXISTS calendar_entries(id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT NOT NULL,time TEXT NOT NULL DEFAULT '',session_id TEXT REFERENCES sessions(id),done INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);");
 const columns=new Set(db.prepare('PRAGMA table_info(calendar_entries)').all().map(c=>c.name));
 for(const [name,type] of Object.entries({duration:'INTEGER NOT NULL DEFAULT 30',position:'INTEGER NOT NULL DEFAULT 0',progress:'INTEGER NOT NULL DEFAULT 0',notes:"TEXT NOT NULL DEFAULT ''",cancelled:'INTEGER NOT NULL DEFAULT 0'}))if(!columns.has(name))db.exec('ALTER TABLE calendar_entries ADD COLUMN '+name+' '+type);
 db.exec('UPDATE calendar_entries SET progress=100 WHERE done=1 AND progress<100');
 const one=(q,...a)=>db.prepare(q).get(...a),run=(q,...a)=>db.prepare(q).run(...a);
 const entry=id=>{if(typeof id!=='string')fail('日程不存在');const e=one('SELECT * FROM calendar_entries WHERE id=?',id);if(!e)fail('日程不存在');return e;};
 const integer=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)fail(label+'无效');return v;};
 function save(a){
  const old=a.id?entry(a.id):null;if(old?.cancelled)fail('已取消日程不可修改，请重新排期');
  if(typeof a.title!=='string'||!a.title.trim()||a.title.length>200)fail('请填写日程标题（最多 200 字）');
  if(typeof a.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!Number.isFinite(Date.parse(a.date))||new Date(a.date).toISOString().slice(0,10)!==a.date)fail('日期无效');
  const time=a.time??'';if(typeof time!=='string'||(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))fail('时间无效');
  const session=a.session_id||null;
  if(old&&session&&remediationEntry(old.id))fail('补学日程保留薄弱点关联，不能改为路线任务');
  if(session&&!one("SELECT id FROM sessions WHERE id=? AND status!='REMOVED_FROM_PLAN'",session)&&session!==old?.session_id)fail('学习安排不存在或已移出路线');
  if(session&&!old?.done&&one('SELECT id FROM calendar_entries WHERE session_id=? AND cancelled=0 AND done=0 AND id!=?',session,old?.id||''))fail('该任务已有待完成日程，请调整原日程');
  const duration=integer(a.duration??old?.duration??30,1,1440,'预计分钟数'),position=old&&old.date===a.date?old.position:(one('SELECT MAX(position) AS p FROM calendar_entries WHERE date=?',a.date).p??-1)+1;
  const id=old?.id||randomUUID();run('INSERT INTO calendar_entries(id,title,date,time,session_id,done,created_at,duration,position) VALUES(?,?,?,?,?,0,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,date=excluded.date,time=excluded.time,session_id=excluded.session_id,duration=excluded.duration,position=excluded.position',id,a.title.trim(),a.date,time,session,new Date().toISOString(),duration,position);return {id};
 }
 function progress(a){const e=entry(a.id);if(e.cancelled)fail('已取消日程不可更新');const value=integer(a.progress,0,100,'进度');const task=remediationEntry(e.id);if(value<100&&task&&one('SELECT c.id FROM calendar_entries c JOIN remediation_tasks t ON t.entry_id=c.id WHERE t.gap_id=? AND c.id!=? AND c.cancelled=0 AND c.done=0',task.gap_id,e.id))fail('该薄弱点已有待完成补学，请先处理原安排');if(typeof a.notes!=='string'||a.notes.length>5000)fail('学习记录最多 5000 字');if(value<100&&e.session_id&&one('SELECT id FROM calendar_entries WHERE session_id=? AND cancelled=0 AND done=0 AND id!=?',e.session_id,e.id))fail('该任务已有待完成日程');run('UPDATE calendar_entries SET progress=?,notes=?,done=? WHERE id=?',value,a.notes,value===100?1:0,e.id);return {ok:true};}
 function done(a){if(typeof a.done!=='boolean')fail('状态无效');const e=entry(a.id);return progress({id:e.id,progress:a.done?100:0,notes:e.notes});}
 function cancel(a){entry(a.id);run('UPDATE calendar_entries SET cancelled=1 WHERE id=?',a.id);return {ok:true};}
 function move(a){const e=entry(a.id);if(!['up','down'].includes(a.direction)||e.cancelled)fail('排序操作无效');const rows=db.prepare('SELECT id FROM calendar_entries WHERE date=? AND cancelled=0 ORDER BY position,created_at,id').all(e.date),i=rows.findIndex(x=>x.id===e.id),j=i+(a.direction==='up'?-1:1);if(j<0||j>=rows.length)return {ok:true};[rows[i],rows[j]]=[rows[j],rows[i]];db.exec('BEGIN IMMEDIATE');try{rows.forEach((r,p)=>run('UPDATE calendar_entries SET position=? WHERE id=?',p,r.id));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return {ok:true};}
 function batch(a){return receipt(a.request_id,'calendar-batch:'+a.goal_id,()=>{const preview=schedulePreview(db,a);if(preview.fingerprint!==a.fingerprint)throw Object.assign(new Error('路线或日历已变化，请重新生成排期预览'),{status:409});if(!preview.entries.length)fail('没有需要排期的任务');const entries=preview.entries.map(e=>({...e,...save(e)}));return {entries};});}
 return {save,done,progress,cancel,move,preview:a=>schedulePreview(db,a),batch,state:()=>db.prepare('SELECT * FROM calendar_entries ORDER BY date,position,created_at,id').all()};
}
