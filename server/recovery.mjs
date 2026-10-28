import {createHash} from 'node:crypto';
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const DAY=86400000,day=t=>new Date(t).toISOString().slice(0,10);
function date(value,label){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||day(Date.parse(value))!==value)fail(label+'无效');return value;}
export function recoveryService(db,{receipt}){
 const all=table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();
 function context(){return {calendar:all('calendar_entries'),goals:all('goals'),sessions:all('sessions'),sets:all('capability_sets'),details:all('roadmap_details'),proposals:all('proposals'),remediation:all('remediation_tasks'),gaps:all('gaps')};}
 function reason(c,e){
  const task=c.remediation.find(t=>t.entry_id===e.id),session=c.sessions.find(s=>s.id===e.session_id),goal=c.goals.find(g=>g.id===(task?.goal_id||session?.goal_id));
  if(!task&&!e.session_id)return '';
  if(!goal||goal.status!=='ACTIVE')return '目标未处于学习中，请先恢复或查看目标状态';
  const set=c.sets.find(s=>s.goal_id===goal.id&&s.status==='ACCEPTED');
  if(task){if(task.set_id!==set?.id)return '能力要求已更新，此补学保留为历史';if(c.gaps.find(g=>g.id===task.gap_id)?.status==='RESOLVED')return '薄弱点已解决，请查看或取消原补学安排';return '';}
  if(!session||session.status==='REMOVED_FROM_PLAN')return '任务已移出学习路线';
  if(session.status==='ASSESSING')return '该任务正在考察，请先结束当前考察';
  if(set&&!c.details.some(d=>d.proposal_id===session.proposal_id&&d.set_id===set.id))return '能力要求已更新，请先确认当前版本路线';
  return '';
 }
 function options(a){date(a.as_of,'统计日期');const c=context();return {as_of:a.as_of,entries:c.calendar.filter(e=>!e.done&&!e.cancelled&&e.date<a.as_of).sort((a,b)=>a.date.localeCompare(b.date)||a.position-b.position||a.id.localeCompare(b.id)).map(e=>{const t=c.remediation.find(t=>t.entry_id===e.id),s=c.sessions.find(s=>s.id===e.session_id),g=c.goals.find(g=>g.id===(t?.goal_id||s?.goal_id));return {...e,kind:t?'补学':s?'路线学习':'独立日程',goal_title:g?.title||'',blocked_reason:reason(c,e)};})};}
 function preview(a){
  date(a.as_of,'统计日期');date(a.start_date,'开始日期');if(a.start_date<a.as_of)fail('开始日期不能早于统计日期');
  if(!Number.isInteger(a.daily_minutes)||a.daily_minutes<1||a.daily_minutes>720)fail('每日时间预算需为 1–720 分钟');
  if(!Array.isArray(a.weekdays)||!a.weekdays.length||a.weekdays.some(x=>!Number.isInteger(x)||x<0||x>6))fail('请选择有效学习日');
  if(!Array.isArray(a.entry_ids)||!a.entry_ids.length||a.entry_ids.length>100||a.entry_ids.some(x=>typeof x!=='string'||!x)||new Set(a.entry_ids).size!==a.entry_ids.length)fail('请选择 1–100 项不重复的待办');
  const c=context(),selected=new Set(a.entry_ids),entries=c.calendar.filter(e=>selected.has(e.id));if(entries.length!==selected.size)fail('待办不存在，请刷新后重选');
  for(const e of entries){if(e.cancelled||e.done||e.date>=a.as_of)fail('所选任务已不属于往期待办，请刷新后重选');const blocked=reason(c,e);if(blocked)fail(e.title+'：'+blocked);if(e.duration>a.daily_minutes)fail(e.title+'的预计时长超过每日预算，请先增加预算或调整单项时长');}
  const weekdays=[...new Set(a.weekdays)].sort(),input={as_of:a.as_of,start_date:a.start_date,daily_minutes:a.daily_minutes,weekdays,entry_ids:[...selected].sort()};
  const fingerprint=createHash('sha256').update(JSON.stringify({input,...c})).digest('hex');
  const info=s=>JSON.parse(c.proposals.find(p=>p.id===s.proposal_id)?.items||'[]')[s.position]||{};
  const prerequisites=s=>s?c.sessions.filter(p=>p.proposal_id===s.proposal_id&&p.status!=='REMOVED_FROM_PLAN'&&p.status!=='COMPLETED'&&info(s).dependencies?.includes(info(p).key)):[];
  const pendingFor=s=>c.calendar.filter(e=>e.session_id===s.id&&!e.cancelled&&!e.done);
  const sorted=entries.sort((a,b)=>a.date.localeCompare(b.date)||a.position-b.position||a.id.localeCompare(b.id)),ordered=[],visiting=new Set(),visited=new Set();
  function visit(e){if(visited.has(e.id))return;if(visiting.has(e.id))fail('所选任务的先修关系存在循环');visiting.add(e.id);for(const p of prerequisites(c.sessions.find(s=>s.id===e.session_id))){const pending=pendingFor(p);if(!pending.length&&!c.calendar.some(x=>x.session_id===p.id&&!x.cancelled&&x.done))fail('请先为前置任务“'+p.title+'”安排学习');for(const before of pending){if(selected.has(before.id))visit(before);else if(before.date<a.as_of)fail('请同时选择尚未完成的前置任务“'+p.title+'”');}}
   visiting.delete(e.id);visited.add(e.id);ordered.push(e);
  }
  sorted.forEach(visit);
  const fixed=c.calendar.filter(e=>!e.cancelled&&!selected.has(e.id)),load=new Map(),positions=new Map();
  for(const e of fixed){load.set(e.date,(load.get(e.date)||0)+e.duration);positions.set(e.date,Math.max(positions.get(e.date)??-1,e.position));}
  const planned=new Map(),result=[],limit=Date.parse(a.start_date)+366*DAY;
  for(const e of ordered){
   const session=c.sessions.find(s=>s.id===e.session_id);let cursor=Date.parse(a.start_date);
   for(const p of prerequisites(session))for(const before of pendingFor(p)){
    const moved=planned.get(before.id);if(moved)cursor=Math.max(cursor,Date.parse(moved.date));else cursor=Math.max(cursor,Date.parse(before.date)+DAY);
   }
   while(cursor<limit&&(!weekdays.includes(new Date(cursor).getUTCDay())||(load.get(day(cursor))||0)+e.duration>a.daily_minutes))cursor+=DAY;
   if(cursor>=limit)fail('一年内无法安排全部待办，请增加预算或学习日');
   if(session){const successors=c.sessions.filter(s=>prerequisites(s).some(p=>p.id===session.id));for(const next of successors)for(const kept of pendingFor(next).filter(x=>!selected.has(x.id)))if(kept.date<=day(cursor))fail('前置任务“'+e.title+'”会晚于已有后续安排“'+next.title+'”，请先调整后续日期或将逾期后续任务一并选入');}
   const target=day(cursor),position=(positions.get(target)??-1)+1;positions.set(target,position);load.set(target,(load.get(target)||0)+e.duration);
   const item={id:e.id,title:e.title,from_date:e.date,date:target,time:e.time,duration:e.duration,progress:e.progress,position};planned.set(e.id,item);result.push(item);
  }
  return {input,fingerprint,entries:result,total_minutes:result.reduce((n,e)=>n+e.duration,0),days:[...new Set(result.map(e=>e.date))].map(date=>({date,minutes:load.get(date)}))};
 }
 function commit(a){return receipt(a.request_id,'calendar-recovery',()=>{const plan=preview(a);if(plan.fingerprint!==a.fingerprint)fail('日历、进度或学习状态已变化，请重新预览');for(const e of plan.entries)db.prepare('UPDATE calendar_entries SET date=?,position=? WHERE id=?').run(e.date,e.position,e.id);return {entries:plan.entries};});}
 return {options,preview,commit};
}
