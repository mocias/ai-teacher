import {randomUUID} from 'node:crypto';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function calendarService(db){
 db.exec(`CREATE TABLE IF NOT EXISTS calendar_entries(id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT NOT NULL,time TEXT NOT NULL DEFAULT '',session_id TEXT REFERENCES sessions(id),done INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);`);
 const one=(q,...a)=>db.prepare(q).get(...a),run=(q,...a)=>db.prepare(q).run(...a);
 function save(a){
  if(typeof a.title!=='string'||!a.title.trim()||a.title.length>200)fail('请填写日程标题（最多 200 字）');
  if(typeof a.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!Number.isFinite(Date.parse(a.date))||new Date(a.date).toISOString().slice(0,10)!==a.date)fail('日期无效');
  const time=a.time||'';if(typeof time!=='string'||(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))fail('时间无效');
  if(a.session_id&&!one("SELECT id FROM sessions WHERE id=? AND status!='REMOVED_FROM_PLAN'",a.session_id))fail('学习安排不存在或已移出路线');
  if(a.id&&!one('SELECT id FROM calendar_entries WHERE id=?',a.id))fail('日程不存在');
  const id=a.id||randomUUID();run('INSERT INTO calendar_entries VALUES(?,?,?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,date=excluded.date,time=excluded.time,session_id=excluded.session_id',id,a.title.trim(),a.date,time,a.session_id||null,new Date().toISOString());return {id};
 }
 function done(a){if(typeof a.done!=='boolean'||!one('SELECT id FROM calendar_entries WHERE id=?',a.id))fail('日程或状态无效');run('UPDATE calendar_entries SET done=? WHERE id=?',a.done?1:0,a.id);return {ok:true};}
 return {save,done,state:()=>db.prepare('SELECT * FROM calendar_entries ORDER BY date,time,created_at').all()};
}
