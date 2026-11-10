import {createHash,randomUUID} from 'node:crypto';

const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const hashNote=n=>createHash('sha256').update(n.title+'\0'+n.content).digest('hex');
const day=()=>new Date().toISOString().slice(0,10);
export function assessmentPractice(db){
 const one=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p),run=(q,...p)=>db.prepare(q).run(...p);
 db.exec(`
 CREATE TABLE IF NOT EXISTS quick_check_state(assessment_id TEXT PRIMARY KEY REFERENCES assessments(id),self_report TEXT NOT NULL,stage TEXT NOT NULL CHECK(stage IN ('BROAD','FOCUSED','DONE')),broad_count INTEGER NOT NULL DEFAULT 0,focused_count INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS practice_rounds(round_id TEXT PRIMARY KEY REFERENCES assessment_rounds(id),phase TEXT NOT NULL CHECK(phase IN ('BROAD','FOCUSED','NOTE')));
 CREATE TABLE IF NOT EXISTS note_verification_invites(id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES notes(id),goal_id TEXT NOT NULL REFERENCES goals(id),set_id TEXT NOT NULL REFERENCES capability_sets(id),note_hash TEXT NOT NULL,requirement_ids TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('PENDING','DEFERRED','CONFIRMED','STARTED','COMPLETED','DECLINED')),proposed_at TEXT NOT NULL,deferred_until TEXT,assessment_id TEXT REFERENCES assessments(id),UNIQUE(note_id,note_hash,set_id));
 CREATE TABLE IF NOT EXISTS note_verification_sources(assessment_id TEXT PRIMARY KEY REFERENCES assessments(id),invite_id TEXT NOT NULL REFERENCES note_verification_invites(id),note_id TEXT NOT NULL REFERENCES notes(id),note_hash TEXT NOT NULL);
 `);
 let learning=null, startingInvite=null;
 function bindLearning(service){learning=service;}
 function currentNote(id,goalId){const n=one('SELECT * FROM notes WHERE id=? AND goal_id=? AND archived=0',id,goalId);if(!n)fail('笔记不存在、已归档或不属于当前目标');return n;}
 function validateBegin(a){
  if(a.kind==='QUICK_CHECK'){
   if(typeof a.scope!=='string'||a.scope.trim().length<3)fail('阶段自测请先写明本次要回忆的已学范围');
  }
  if(a.kind==='NOTE_VERIFICATION'){
   if(typeof a.invite_id!=='string'||!a.invite_id)fail('笔记验证需要你先确认有效邀请');
   const invite=one('SELECT * FROM note_verification_invites WHERE id=?',a.invite_id);
   if(!invite||startingInvite!==invite.id||!['PENDING','DEFERRED','CONFIRMED'].includes(invite.status)||invite.goal_id!==a.goal_id)fail('笔记验证需要你先确认有效邀请');
   const accepted=one("SELECT id FROM capability_sets WHERE goal_id=? AND status='ACCEPTED' ORDER BY rowid DESC LIMIT 1",a.goal_id);if(accepted?.id!==invite.set_id)fail('能力要求版本已更新，请重新评估笔记');
   const n=currentNote(invite.note_id,a.goal_id);if(hashNote(n)!==invite.note_hash)fail('笔记内容已变化，请重新邀请验证');
   if(JSON.stringify([...JSON.parse(invite.requirement_ids)].sort())!==JSON.stringify([...a.requirement_ids].sort()))fail('验证范围与邀请不一致');
  }
 }
 function onBegin(a,assessmentId){
  if(a.kind==='QUICK_CHECK')run("INSERT INTO quick_check_state(assessment_id,self_report,stage,broad_count,focused_count) VALUES(?,?,'BROAD',0,0)",assessmentId,a.scope.trim());
  if(a.kind==='NOTE_VERIFICATION'){
   run('INSERT INTO note_verification_sources VALUES(?,?,?,?)',assessmentId,a.invite_id,one('SELECT note_id FROM note_verification_invites WHERE id=?',a.invite_id).note_id,one('SELECT note_hash FROM note_verification_invites WHERE id=?',a.invite_id).note_hash);
   run("UPDATE note_verification_invites SET status='STARTED',assessment_id=? WHERE id=?",assessmentId,a.invite_id);
  }
 }
 function beforeQuestion(assessmentId,phase){
  const as=one('SELECT kind FROM assessments WHERE id=?',assessmentId);if(as?.kind!=='QUICK_CHECK')return null;
  const state=one('SELECT * FROM quick_check_state WHERE assessment_id=?',assessmentId);if(!state)return null; // A pre-upgrade Quick Check keeps its original interview flow.
  if(state.stage==='DONE')fail('阶段自测流程已结束');
  const expected=state.stage,selected=phase||expected;if(selected!==expected)fail(expected==='BROAD'?'先完成两道宽泛探问，再进入范围自测':'宽泛探问已完成，请聚焦用户自述范围进行自测');
  return expected;
 }
 function afterQuestion(roundId,assessmentId,phase){
  if(!phase)return;
  run('INSERT INTO practice_rounds VALUES(?,?)',roundId,phase);
  if(phase==='BROAD'){
   const p=one('SELECT broad_count FROM quick_check_state WHERE assessment_id=?',assessmentId),count=p.broad_count+1;
   run("UPDATE quick_check_state SET broad_count=?,stage=? WHERE assessment_id=?",count,count>=2?'FOCUSED':'BROAD',assessmentId);
  }else run('UPDATE quick_check_state SET focused_count=focused_count+1 WHERE assessment_id=?',assessmentId);
 }
 function beforeFinish(assessmentId){const as=one('SELECT kind FROM assessments WHERE id=?',assessmentId);if(as?.kind!=='QUICK_CHECK')return;const p=one('SELECT * FROM quick_check_state WHERE assessment_id=?',assessmentId);if(p&&(p.broad_count<2||p.focused_count<1))fail('阶段自测需先完成两道宽泛探问和至少一道范围自测题');}
 function afterFinish(assessmentId){const as=one('SELECT kind FROM assessments WHERE id=?',assessmentId);if(as?.kind==='QUICK_CHECK')run("UPDATE quick_check_state SET stage='DONE' WHERE assessment_id=?",assessmentId);const source=one('SELECT invite_id FROM note_verification_sources WHERE assessment_id=?',assessmentId);if(source)run("UPDATE note_verification_invites SET status='COMPLETED' WHERE id=? AND status='STARTED'",source.invite_id);}
 function state(goalId){const where=goalId?' WHERE goal_id=?':'',args=goalId?[goalId]:[];const invites=all('SELECT * FROM note_verification_invites'+where+' ORDER BY proposed_at DESC',...args).map(x=>{
  const n=one('SELECT title,content,archived FROM notes WHERE id=?',x.note_id),stale=!n||!!n.archived||hashNote(n)!==x.note_hash;
  let status=x.status;if(status==='DEFERRED'&&x.deferred_until<=day())status='PENDING';
  const current=one("SELECT id FROM capability_sets WHERE goal_id=? AND status='ACCEPTED' ORDER BY rowid DESC LIMIT 1",x.goal_id),requirementsCurrent=current?.id===x.set_id&&JSON.parse(x.requirement_ids).every(id=>one('SELECT id FROM requirements WHERE id=? AND set_id=?',id,current?.id||''));
  return {...x,requirement_ids:JSON.parse(x.requirement_ids),status,stale,requirements_current:requirementsCurrent,note_title:n?.title||'笔记已删除'};
 });
 const checks=all('SELECT q.*,a.goal_id,a.status AS assessment_status FROM quick_check_state q JOIN assessments a ON a.id=q.assessment_id'+(goalId?' WHERE a.goal_id=?':''),...args);
 return {note_verification_invites:invites,quick_checks:checks};
 }
 function context(conversationId){const as=one('SELECT * FROM assessments WHERE conversation_id=?',conversationId);if(!as)return {};const q=one('SELECT * FROM quick_check_state WHERE assessment_id=?',as.id),src=one('SELECT * FROM note_verification_sources WHERE assessment_id=?',as.id);return {practice:as.kind==='QUICK_CHECK'?{type:'QUICK_CHECK',self_report:q?.self_report,stage:q?.stage,broad_count:q?.broad_count,focused_count:q?.focused_count,phase_guidance:!q?'沿用升级前已开始的逐题自测流程，保留原回答。':'先恰好提出两道宽泛探问（phase=BROAD），再至少提出一道聚焦用户自述范围的问题（phase=FOCUSED）。每题需保存反馈；不得扩大到未选择要求。'}:src?{type:'NOTE_VERIFICATION',note_id:src.note_id,note_hash:src.note_hash,source:'已确认的用户笔记；它不是考察证据，只有本次实际回答进入证据。'}:null};}
 function rounds(rows){return rows.map(r=>({...r,phase:one('SELECT phase FROM practice_rounds WHERE round_id=?',r.id)?.phase||null}));}
 function afterEarly(assessmentId){run("UPDATE quick_check_state SET stage='DONE' WHERE assessment_id=?",assessmentId);}
 function suggestNoteVerification(a){
  const n=currentNote(a.note_id,a.goal_id),g=one('SELECT * FROM goals WHERE id=?',a.goal_id);if(!g||['PAUSED','ABANDONED','COMPLETED'].includes(g.status))fail('当前目标不能新增笔记验证邀请');
  if(typeof a.reason!=='string'||!a.reason.trim()||a.reason.length>2000)fail('请说明为什么值得验证这条笔记');
  if(!Array.isArray(a.requirement_ids)||!a.requirement_ids.length)fail('请选择与笔记变化相关的能力要求');
  const accepted=one("SELECT id FROM capability_sets WHERE goal_id=? AND status='ACCEPTED' ORDER BY rowid DESC LIMIT 1",g.id);if(!accepted)fail('请先确认当前能力要求');
  for(const id of new Set(a.requirement_ids))if(!one('SELECT id FROM requirements WHERE id=? AND goal_id=? AND set_id=?',id,g.id,accepted.id))fail('邀请只能关联当前目标、当前版本的能力要求');
  const digest=hashNote(n),old=one('SELECT * FROM note_verification_invites WHERE note_id=? AND note_hash=? AND set_id=?',n.id,digest,accepted.id);
  if(old){if(old.status==='DEFERRED'&&old.deferred_until<=day()){run("UPDATE note_verification_invites SET status='PENDING',deferred_until=NULL WHERE id=?",old.id);return {invite_id:old.id,status:'PENDING',reused:true};}return {invite_id:old.id,status:old.status,reused:true};}
  const id=randomUUID();run('INSERT INTO note_verification_invites VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,n.id,g.id,accepted.id,digest,JSON.stringify([...new Set(a.requirement_ids)]),a.reason.trim(),'PENDING',new Date().toISOString(),null,null);return {invite_id:id,status:'PENDING',reused:false};
 }
 function suggestFromJob(a){
  const binding=one(`SELECT action.subject_id,c.goal_id
    FROM goal_chat_actions action JOIN jobs j ON j.id=action.job_id
    JOIN conversations c ON c.id=j.conversation_id JOIN job_execution ex ON ex.job_id=j.id
    WHERE j.id=? AND j.status='RUNNING' AND j.lease_token=? AND j.lease_until>?
      AND ex.module='chat' AND action.intent='NOTE_VERIFICATION'`,a.job_id,a.lease_token,Date.now());
  if(binding?.goal_id!==a.goal_id || binding.subject_id!==a.note_id)fail('笔记验证建议不属于本次请求的笔记');
  return suggestNoteVerification(a);
 }
 function defer(a){const invite=one('SELECT * FROM note_verification_invites WHERE id=?',a.invite_id);if(!invite)fail('邀请不存在');if(!['PENDING','DEFERRED'].includes(invite.status))fail('该邀请已处理');const days=Number.isInteger(a.days)?a.days:7;if(days<1||days>90)fail('稍后提醒时间需为 1 至 90 天');const until=new Date(Date.now()+days*86400000).toISOString().slice(0,10);run("UPDATE note_verification_invites SET status='DEFERRED',deferred_until=? WHERE id=?",until,invite.id);return {ok:true,deferred_until:until};}
 function decline(a){const invite=one('SELECT * FROM note_verification_invites WHERE id=?',a.invite_id);if(!invite||!['PENDING','DEFERRED'].includes(invite.status))fail('该邀请不可忽略');run("UPDATE note_verification_invites SET status='DECLINED' WHERE id=?",invite.id);return {ok:true};}
 function start(a){if(!learning)throw new Error('learning service not bound');const invite=one('SELECT * FROM note_verification_invites WHERE id=?',a.invite_id);if(!invite)fail('邀请不存在');if(invite.assessment_id){const x=one('SELECT conversation_id FROM assessments WHERE id=?',invite.assessment_id);return {assessment_id:invite.assessment_id,conversation_id:x?.conversation_id,reused:true};}if(!['PENDING','DEFERRED','CONFIRMED'].includes(invite.status))fail('该邀请已处理');const n=currentNote(invite.note_id,invite.goal_id);if(hashNote(n)!==invite.note_hash)fail('笔记已修改，请请求 Teacher 重新评估此版本');const g=one('SELECT status FROM goals WHERE id=?',invite.goal_id);if(!g||['PAUSED','ABANDONED','COMPLETED'].includes(g.status))fail('目标当前不能开始笔记验证');startingInvite=invite.id;
  try{return learning.begin({goal_id:invite.goal_id,kind:'NOTE_VERIFICATION',mode:'CLOSED_BOOK',scope:`用户已确认验证笔记“${n.title}”。笔记原文（仅为用户自述，不是证据）：\n${n.content.slice(0,12000)}\n\nTeacher 建议：${invite.reason}`,requirement_ids:JSON.parse(invite.requirement_ids),resource_ids:[],invite_id:invite.id,request_id:a.request_id}); }finally{startingInvite=null;}
 }
 return {bindLearning,validateBegin,onBegin,beforeQuestion,afterQuestion,beforeFinish,afterFinish,afterEarly,state,context,rounds,suggestFromJob,suggestNoteVerification,defer,decline,start};
}
