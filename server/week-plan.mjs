import {createHash} from 'node:crypto';

const fail=message=>{throw Object.assign(new Error(message,{cause:undefined}),{status:409});};
const DAY=86400000,day=value=>new Date(value).toISOString().slice(0,10);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&day(Date.parse(value))===value;

export function weekPlanService(db,{receipt,rollingPlan,calendar}){
 db.exec(`CREATE TABLE IF NOT EXISTS week_plan_settings(
  id INTEGER PRIMARY KEY CHECK(id=1),daily_minutes INTEGER NOT NULL,session_minutes INTEGER NOT NULL,
  review_minutes INTEGER NOT NULL,weekdays TEXT NOT NULL,domain_priority TEXT NOT NULL,
  revision INTEGER NOT NULL,updated_at TEXT NOT NULL
 ); INSERT OR IGNORE INTO week_plan_settings VALUES(1,90,30,20,'[1,2,3,4,5]','[]',1,'${new Date().toISOString()}');`);
 const one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const settings=()=>{const s=one('SELECT * FROM week_plan_settings WHERE id=1');return {...s,weekdays:JSON.parse(s.weekdays),domain_priority:JSON.parse(s.domain_priority)};};

 function normalize(input,base=settings()){
  const daily=input.daily_minutes??base.daily_minutes,session=input.session_minutes??base.session_minutes,review=input.review_minutes??base.review_minutes,weekdays=input.weekdays??base.weekdays,priority=input.domain_priority??base.domain_priority;
  if(!Number.isInteger(daily)||daily<1||daily>720)fail('每天容量需为 1–720 分钟');
  if(!Number.isInteger(session)||session<1||session>240||session>daily)fail('单项时长需为 1–240 分钟，且不超过每天容量');
  if(!Number.isInteger(review)||review<5||review>240)fail('复习预留需为 5–240 分钟');
  if(!Array.isArray(weekdays)||!weekdays.length||weekdays.some(x=>!Number.isInteger(x)||x<0||x>6)||new Set(weekdays).size!==weekdays.length)fail('请选择不重复的学习日');
  const domains=new Set(all('SELECT DISTINCT domain FROM goals').map(x=>x.domain));
  if(!Array.isArray(priority)||new Set(priority).size!==priority.length||priority.some(x=>typeof x!=='string'||!domains.has(x)))fail('领域优先顺序中包含无效领域');
  return {daily_minutes:daily,session_minutes:session,review_minutes:review,weekdays:[...weekdays].sort(),domain_priority:[...priority]};
 }

 function saveSettings(input){return receipt(input.request_id,'week-plan-settings',()=>{
  const current=settings();if(input.revision!==current.revision)fail('容量或领域优先级已被其他操作更新，请刷新后重试');
  const value=normalize(input,current),result=run(`UPDATE week_plan_settings SET daily_minutes=?,session_minutes=?,review_minutes=?,weekdays=?,domain_priority=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?`,value.daily_minutes,value.session_minutes,value.review_minutes,JSON.stringify(value.weekdays),JSON.stringify(value.domain_priority),new Date().toISOString(),current.revision);
  if(!result.changes)fail('排期设置已变化，请刷新后重试');return settings();
 });}

 function preview(input){
  const current=settings();if(input.revision!==current.revision)fail('排期设置已变化，请重新预览');
  const value=normalize(input,current),start=input.start_date;if(!validDate(start))fail('周起始日期无效');
  const weekStart=new Date(start+'T00:00:00.000Z');if(weekStart.getUTCDay()!==1)fail('请使用周一作为自然周起始日');
  const end=day(weekStart.getTime()+6*DAY),next=day(weekStart.getTime()+7*DAY),offset=Number.isInteger(input.tz_offset)?input.tz_offset:0;if(offset< -840||offset>840)fail('时区偏移无效');
  const today=day(Date.now()-offset*60000),thisMonday=day(Date.parse(today+'T00:00:00.000Z')-((new Date(today+'T00:00:00.000Z').getUTCDay()+6)%7)*DAY);if(start<thisMonday)fail('历史自然周只读，不能生成新排期');
  const firstDay=start===thisMonday&&today>start?today:start;
  const allCalendar=all('SELECT * FROM calendar_entries ORDER BY date,position,id'),calendarInWeek=allCalendar.filter(e=>!e.cancelled&&e.date>=start&&e.date<next);
  const scheduledSessionIds=new Set(allCalendar.filter(e=>e.session_id&&!e.cancelled).map(e=>e.session_id));
  const cancelledSessionIds=new Set(allCalendar.filter(e=>e.session_id&&e.cancelled).map(e=>e.session_id));
  const load=new Map();for(const e of calendarInWeek)load.set(e.date,(load.get(e.date)||0)+(Number(e.duration)||0));
  const fixed=[];
  for(const e of calendarInWeek){
   const remediation=one('SELECT description FROM remediation_tasks WHERE entry_id=?',e.id),session=e.session_id?one('SELECT title,goal_id FROM sessions WHERE id=?',e.session_id):null;
   fixed.push({date:e.date,minutes:Number(e.duration)||0,title:e.title,kind:remediation?'补学':session?'已排路线':'其他日程',done:!!e.done,session_id:e.session_id||null});
  }
  const reviews=all(`SELECT r.*,g.title AS goal_title,g.domain FROM reviews r JOIN goals g ON g.id=r.goal_id WHERE r.status IN ('DUE','IN_PROGRESS') AND g.status IN ('ACTIVE','COMPLETED') AND r.due_date<? ORDER BY r.due_date,r.rowid`,next);
  for(const r of reviews){
   const date=r.due_date<firstDay?firstDay:r.due_date,minutes=value.review_minutes;load.set(date,(load.get(date)||0)+minutes);fixed.push({date,minutes,title:`复习：${r.goal_title}`,kind:r.status==='IN_PROGRESS'?'进行中复习':'到期复习',review_id:r.id,done:false});
  }
  const queue=rollingPlan.state(),candidates=[...queue.queue,...queue.overflow],unique=[],seen=new Set();
  for(const row of candidates){const s=row.session;if(seen.has(s.id)||scheduledSessionIds.has(s.id))continue;seen.add(s.id);unique.push(row);}
  const rank=new Map(value.domain_priority.map((domain,index)=>[domain,index]));
  unique.sort((a,b)=>(rank.get(a.goal.domain)??9999)-(rank.get(b.goal.domain)??9999)||candidates.findIndex(x=>x.session.id===a.session.id)-candidates.findIndex(x=>x.session.id===b.session.id));
  const entries=[],unplaced=[];let cursor=Date.parse(firstDay+'T00:00:00.000Z'),limit=Date.parse(next+'T00:00:00.000Z');
  for(const row of unique){
   let slot=cursor;while(slot<limit){const date=day(slot);if(value.weekdays.includes(new Date(slot).getUTCDay())&&(load.get(date)||0)+value.session_minutes<=value.daily_minutes)break;slot+=DAY;}
   if(slot>=limit){unplaced.push({session_id:row.session.id,title:row.session.title,domain:row.goal.domain,reason:'本周剩余学习日的容量已被现有日程、复习或优先任务占用'});continue;}
   const date=day(slot),occupied=load.get(date)||0,priorityIndex=rank.get(row.goal.domain),priorityReason=priorityIndex===undefined?'按可执行路线顺序安排':`按领域优先级第 ${priorityIndex+1} 位安排`;
   const cancellationNote=cancelledSessionIds.has(row.session.id)?'保留此前取消日程的历史记录，并按本次确认重新安排。':'';
   entries.push({session_id:row.session.id,goal_id:row.goal.id,domain:row.goal.domain,title:row.session.title,date,duration:value.session_minutes,time:'',reason:`当日已有 ${occupied} 分钟固定安排；${priorityReason}。${cancellationNote}`});
   load.set(date,occupied+value.session_minutes);cursor=slot;
  }
  const fingerprint=createHash('sha256').update(JSON.stringify({start,end,value,revision:current.revision,entries,unplaced,calendar:allCalendar,reviews,queue})).digest('hex');
  return {week:{start,end,historical:false},input:{start_date:start,...value,tz_offset:offset,revision:current.revision},fingerprint,entries,fixed,fixed_minutes:fixed.reduce((sum,item)=>sum+item.minutes,0),unplaced,considered:unique.length,scheduled_session_count:scheduledSessionIds.size};
 }

 function commit(input){return receipt(input.request_id,'week-plan:'+input.start_date,()=>{
  const fresh=preview(input);if(fresh.fingerprint!==input.fingerprint)fail('排期依据或日历负载已变化，请重新预览');
  if(!fresh.entries.length)fail('本周没有可确认的缺少日程路线任务');
  const created=fresh.entries.map(item=>({...item,...calendar.save(item)}));
  const v=fresh.input;run('UPDATE week_plan_settings SET daily_minutes=?,session_minutes=?,review_minutes=?,weekdays=?,domain_priority=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?',v.daily_minutes,v.session_minutes,v.review_minutes,JSON.stringify(v.weekdays),JSON.stringify(v.domain_priority),new Date().toISOString(),v.revision);
  return {ok:true,week:fresh.week,entries:created,unplaced:fresh.unplaced,settings:settings()};
 });}
 return {settings,saveSettings,preview,commit};
}
