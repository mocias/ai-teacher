import {randomUUID} from 'node:crypto';

const DAY=86400000, iso=d=>new Date(d).toISOString().slice(0,10);
const fail=m=>{throw Object.assign(new Error(m),{status:409});};
const escDate=s=>/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&iso(Date.parse(s))===s;
export function adaptiveReview(db,{receipt,followups}){
 const one=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p),run=(q,...p)=>db.prepare(q).run(...p);
 db.exec(`CREATE TABLE IF NOT EXISTS adaptive_review_settings(id INTEGER PRIMARY KEY CHECK(id=1),intensity TEXT NOT NULL CHECK(intensity IN ('LIGHT','STANDARD','INTENSIVE')),auto_enabled INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)`);
 const settings=()=>one('SELECT * FROM adaptive_review_settings WHERE id=1')||{id:1,intensity:'STANDARD',auto_enabled:0};
 function setIntensity(a){return receipt(a.request_id,'adaptive-intensity',()=>{if(!['LIGHT','STANDARD','INTENSIVE'].includes(a.intensity)||typeof a.auto_enabled!=='boolean')fail('复习设置无效');run('INSERT INTO adaptive_review_settings VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET intensity=excluded.intensity,auto_enabled=excluded.auto_enabled,updated_at=excluded.updated_at',a.intensity,a.auto_enabled?1:0,new Date().toISOString());return {ok:true,...settings()};});}
 function suggestionRows(goalId){
  const g=one('SELECT * FROM goals WHERE id=?',goalId);if(!g)return [];
  const intensity=settings().intensity;
  const completed=all("SELECT * FROM assessments WHERE goal_id=? AND status='COMPLETED' ORDER BY ended_at DESC,rowid DESC",goalId),out=[];
  const seenRequirements=new Set();
  for(const a of completed){
   const evidence=one('SELECT * FROM evidence WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1',a.conversation_id);if(!evidence)continue;
   const current=one("SELECT id FROM capability_sets WHERE goal_id=? AND status='ACCEPTED' ORDER BY rowid DESC LIMIT 1",goalId);
   const assessed=one('SELECT set_id FROM assessment_capabilities WHERE assessment_id=?',a.id);if(!current||assessed?.set_id!==current.id)continue;
   const links=all('SELECT er.*,r.description FROM evidence_requirements er JOIN requirements r ON r.id=er.requirement_id WHERE er.evidence_id=? AND r.set_id=?',evidence.id,current.id);
   for(const l of links){
    if(seenRequirements.has(l.requirement_id))continue;
    seenRequirements.add(l.requirement_id);
    // Completed review with evidence becomes a candidate for another user-chosen review.
    const relation=l.relation, days=relation==='CONTRADICTS'? (intensity==='LIGHT'?7:intensity==='INTENSIVE'?1:3): relation==='INCONCLUSIVE'?(intensity==='LIGHT'?14:intensity==='INTENSIVE'?3:7):(intensity==='LIGHT'?30:intensity==='INTENSIVE'?7:14);
    if(one("SELECT rs.review_id FROM review_sources rs JOIN reviews r ON r.id=rs.review_id WHERE rs.assessment_id=? AND r.requirement_id=? AND r.status='CANCELLED' LIMIT 1",a.id,l.requirement_id))continue;
    const duplicate=one("SELECT id,status,due_date FROM reviews WHERE goal_id=? AND requirement_id=? AND status IN ('DUE','IN_PROGRESS') ORDER BY rowid DESC LIMIT 1",goalId,l.requirement_id);
    if(duplicate)continue; // manual open work always takes precedence
    const gap=one("SELECT * FROM gaps WHERE goal_id=? AND requirement_id=? AND status<>'RESOLVED' ORDER BY rowid DESC LIMIT 1",goalId,l.requirement_id);
    const due=iso(Date.parse((a.ended_at||a.created_at).slice(0,10)+'T00:00:00.000Z')+days*DAY);
    const basis=relation==='CONTRADICTS'?'回答与该要求相矛盾':relation==='INCONCLUSIVE'?'回答证据尚不足以判断':'回答支持该要求；按你设置的强度安排间隔复核';
    out.push({goal_id:goalId,goal_title:g.title,domain:g.domain,source_assessment_id:a.id,source_kind:a.kind,evidence_id:evidence.id,requirement_id:l.requirement_id,requirement:l.description,relation,gap_id:gap?.id||null,gap_description:gap?.description||null,due_date:due,reason:`根据 ${a.kind==='REVIEW'?'上次复习':'已完成考察'}的实际回答证据（${basis}），建议再次闭卷验证；强度：${intensity}。`,intensity});
   }
  }
  return out.sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.domain.localeCompare(b.domain));
 }
 function accept(a){const old=one('SELECT operation,result FROM receipts WHERE request_id=?',a.request_id);if(old){if(old.operation!=='review-followup:'+a.source_assessment_id)fail('重复操作 ID 冲突');return JSON.parse(old.result);}const s=suggestionRows(a.goal_id).find(x=>x.source_assessment_id===a.source_assessment_id&&x.requirement_id===a.requirement_id);if(!s)fail('建议已过期或该要求已有未完成复习');return followups.schedule({request_id:a.request_id,source_assessment_id:s.source_assessment_id,requirement_id:s.requirement_id,due_date:a.due_date||s.due_date,reason:s.reason});}
 function afterAssessment(id, schedule=followups.schedule){if(!settings().auto_enabled)return [];const a=one("SELECT * FROM assessments WHERE id=? AND status='COMPLETED'",id);if(!a)return [];return suggestionRows(a.goal_id).filter(s=>s.source_assessment_id===id).map(s=>schedule({request_id:'adaptive-'+id.slice(0,16)+'-'+s.requirement_id.slice(0,16),source_assessment_id:id,requirement_id:s.requirement_id,due_date:s.due_date,reason:s.reason}));}
 function week(a={}){
  const start=a.start_date||iso(Date.now()-((new Date().getUTCDay()+6)%7)*DAY);if(!escDate(start))fail('周起始日期无效');const d=new Date(start+'T00:00:00.000Z');if(d.getUTCDay()!==1)fail('请使用周一作为自然周起始日');const end=iso(d.getTime()+6*DAY),next=iso(d.getTime()+7*DAY),offset=Number.isInteger(a.tz_offset)?a.tz_offset:0;if(offset< -840||offset>840)fail('时区偏移无效');const fromTs=new Date(Date.parse(start+'T00:00:00.000Z')+offset*60000).toISOString(),toTs=new Date(Date.parse(next+'T00:00:00.000Z')+offset*60000).toISOString();
  const entries=all('SELECT * FROM calendar_entries WHERE date>=? AND date<? AND cancelled=0 ORDER BY date,position,id',start,next),assessments=all("SELECT * FROM assessments WHERE status='COMPLETED' AND ended_at>=? AND ended_at<? ORDER BY ended_at",fromTs,toTs),evidenceAssessments=all(`
   SELECT a.id AS assessment_id,a.goal_id,a.kind,a.mode,a.ended_at,g.title AS goal_title,g.domain,
     (SELECT e.id FROM evidence e WHERE e.conversation_id=a.conversation_id ORDER BY e.rowid DESC LIMIT 1) AS evidence_id,
     (SELECT e.summary FROM evidence e WHERE e.conversation_id=a.conversation_id ORDER BY e.rowid DESC LIMIT 1) AS conclusion
   FROM assessments a JOIN goals g ON g.id=a.goal_id
   WHERE a.status='COMPLETED' AND a.ended_at>=? AND a.ended_at<?
     AND EXISTS(SELECT 1 FROM evidence e WHERE e.conversation_id=a.conversation_id)
   ORDER BY a.ended_at DESC,a.rowid DESC
  `,fromTs,toTs),reviews=all("SELECT * FROM reviews WHERE due_date>=? AND due_date<? AND status<>'CANCELLED' ORDER BY due_date",start,next),goals=all('SELECT * FROM goals');
  const domains=new Map();for(const g of goals)domains.set(g.domain,{domain:g.domain,calendar:{planned:0,done_now:0,minutes:0},answers:0,evidence:0,gaps_current:0,reviews:{scheduled:0,done_now:0},goals:[],assessments:[]});
  const goalBy=new Map(goals.map(g=>[g.id,g]));for(const e of entries){const g=goalBy.get(one('SELECT goal_id FROM sessions WHERE id=?',e.session_id)?.goal_id||one('SELECT gap.goal_id FROM remediation_tasks t JOIN gaps gap ON gap.id=t.gap_id WHERE t.entry_id=?',e.id)?.goal_id);if(!g)continue;const x=domains.get(g.domain);x.calendar.planned++;x.calendar.done_now+=e.done?1:0;x.calendar.minutes+=Number(e.duration)||0;}
  for(const a of assessments){const g=goalBy.get(a.goal_id),x=g&&domains.get(g.domain);if(!x)continue;x.answers+=all('SELECT id FROM assessment_rounds WHERE assessment_id=? AND answer_message_id IS NOT NULL',a.id).length;const ev=one('SELECT id FROM evidence WHERE conversation_id=?',a.conversation_id);if(ev)x.evidence++;}
  const assessmentResults=evidenceAssessments.map(a=>{const conclusion=String(a.conclusion||'').replace(/\s+/g,' ').trim();return {assessment_id:a.assessment_id,goal_id:a.goal_id,goal_title:a.goal_title,domain:a.domain,kind:a.kind,mode:a.mode,ended_at:a.ended_at,evidence_id:a.evidence_id,conclusion_excerpt:conclusion.length>280?conclusion.slice(0,277)+'…':conclusion};});
  for(const a of assessmentResults){const group=domains.get(a.domain);if(group)group.assessments.push(a);}
  for(const r of reviews){const g=goalBy.get(r.goal_id),x=g&&domains.get(g.domain);if(x){x.reviews.scheduled++;if(r.status==='DONE')x.reviews.done_now++;}}
  for(const g of goals){const x=domains.get(g.domain);x.goals.push({id:g.id,title:g.title,status:g.status});}
  for(const x of domains.values())x.gaps_current=all("SELECT id FROM gaps WHERE status<>'RESOLVED' AND goal_id IN (SELECT id FROM goals WHERE domain=?)",x.domain).length;
  const today=iso(Date.now()-offset*60000),thisMonday=iso(Date.parse(today+'T00:00:00Z')-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)*DAY),historical=start<thisMonday;
  const suggestions=historical?[]:goals.flatMap(g=>suggestionRows(g.id)).filter(s=>s.due_date>=today);
  const assessmentDomains=[...domains.values()].filter(x=>x.assessments.length).map(x=>({domain:x.domain,count:x.assessments.length})).sort((a,b)=>b.count-a.count||a.domain.localeCompare(b.domain));
  return {week:{start,end,historical},domains:[...domains.values()].filter(x=>x.goals.length).sort((a,b)=>a.domain.localeCompare(b.domain)),assessment_domains:assessmentDomains,assessment_results:assessmentResults,summary:{calendar_entries:entries.length,calendar_done_now:entries.filter(e=>e.done).length,answers:assessments.reduce((n,a)=>n+all('SELECT id FROM assessment_rounds WHERE assessment_id=? AND answer_message_id IS NOT NULL',a.id).length,0),evidence:assessments.filter(a=>one('SELECT id FROM evidence WHERE conversation_id=?',a.conversation_id)).length,gaps_current:[...domains.values()].reduce((n,x)=>n+x.gaps_current,0),reviews_scheduled:reviews.length,reviews_done_now:reviews.filter(r=>r.status==='DONE').length},suggestions,settings:settings()};
 }
 return {setIntensity,week,accept,afterAssessment,suggestions:goalId=>suggestionRows(goalId),settings};
}
