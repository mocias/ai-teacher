import {createHash} from 'node:crypto';
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const day=n=>new Date(n).toISOString().slice(0,10),DAY=86400000;
export function schedulePreview(db,a){
 const goal=db.prepare('SELECT * FROM goals WHERE id=?').get(a.goal_id);
 if(goal?.status!=='ACTIVE')fail('请先确认路线并恢复目标，再安排学习');
 if(typeof a.start_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(a.start_date)||!Number.isFinite(Date.parse(a.start_date))||day(Date.parse(a.start_date))!==a.start_date)fail('开始日期无效');
 for(const [key,max] of [['daily_minutes',720],['session_minutes',240]])if(!Number.isInteger(a[key])||a[key]<1||a[key]>max)fail('每日预算或每项时长无效');
 if(a.session_minutes>a.daily_minutes)fail('每项时长不能超过每日预算');
 if(!Array.isArray(a.weekdays)||!a.weekdays.length||a.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))fail('请选择有效的学习日');
 const weekdays=[...new Set(a.weekdays)].sort(),sessions=db.prepare("SELECT * FROM sessions WHERE goal_id=? AND status!='REMOVED_FROM_PLAN' ORDER BY position,id").all(goal.id);
 const calendar=db.prepare('SELECT * FROM calendar_entries WHERE cancelled=0 ORDER BY date,position,id').all();
 const proposals=db.prepare('SELECT * FROM proposals WHERE goal_id=?').all(goal.id);
 const sets=db.prepare("SELECT id FROM capability_sets WHERE goal_id=? AND status='ACCEPTED'").all(goal.id);
 const details=db.prepare('SELECT * FROM roadmap_details WHERE proposal_id IN (SELECT id FROM proposals WHERE goal_id=?)').all(goal.id);
 const eligible=sessions.filter(s=>s.status==='PLANNED'&&!calendar.some(e=>e.session_id===s.id));
 if(eligible.some(s=>sets.length&&!details.some(d=>d.proposal_id===s.proposal_id&&d.set_id===sets[0].id)))fail('能力要求已更新，请先确认新版路线');
 const info=s=>JSON.parse(proposals.find(p=>p.id===s.proposal_id)?.items||'[]')[s.position]||{};
 const prerequisite=s=>{const i=info(s);return sessions.filter(p=>p.proposal_id===s.proposal_id&&i.dependencies?.includes(info(p).key));};
 const pending=new Set(eligible.map(s=>s.id)),ordered=[],visiting=new Set(),visited=new Set();
 function visit(s){if(visited.has(s.id))return;if(visiting.has(s.id))fail('路线依赖存在循环');visiting.add(s.id);for(const p of prerequisite(s))if(pending.has(p.id))visit(p);visiting.delete(s.id);visited.add(s.id);ordered.push(s);}
 eligible.forEach(visit);
 const input={goal_id:goal.id,start_date:a.start_date,daily_minutes:a.daily_minutes,session_minutes:a.session_minutes,weekdays};
 const fingerprint=createHash('sha256').update(JSON.stringify({input,goal,sessions,calendar,proposals,sets,details})).digest('hex');
 const load=new Map();for(const e of calendar)load.set(e.date,(load.get(e.date)||0)+e.duration);
 const dates=new Map();for(const s of sessions){const entries=calendar.filter(e=>e.session_id===s.id);if(entries.length)dates.set(s.id,entries.map(e=>e.date).sort().at(-1));}
 const entries=[];let cursor=Date.parse(a.start_date);const limit=cursor+366*DAY;
 for(const s of ordered){
  for(const p of prerequisite(s)){const date=dates.get(p.id);if(date)cursor=Math.max(cursor,Date.parse(date));}
  while(cursor<limit&&(!weekdays.includes(new Date(cursor).getUTCDay())||(load.get(day(cursor))||0)+a.session_minutes>a.daily_minutes))cursor+=DAY;
  if(cursor>=limit)fail('一年内无法排入全部任务，请增加时间预算或学习日');
  const existingSuccessors=sessions.filter(next=>prerequisite(next).some(p=>p.id===s.id)&&!pending.has(next.id)).flatMap(next=>calendar.filter(e=>e.session_id===next.id&&!e.done));
  if(existingSuccessors.some(e=>e.date<=day(cursor)))fail('已有后续任务排期早于新排的前置任务，请调整开始日期或先修改原日程');
  const date=day(cursor);entries.push({session_id:s.id,title:s.title,date,time:'',duration:a.session_minutes});dates.set(s.id,date);load.set(date,(load.get(date)||0)+a.session_minutes);
 }
 return {input,fingerprint,entries,skipped:sessions.length-eligible.length,total_minutes:entries.length*a.session_minutes};
}
