import {randomUUID} from 'node:crypto';
const uid=()=>randomUUID(),now=()=>new Date().toISOString(),json=JSON.stringify;
const fail=m=>{throw Object.assign(new Error(m),{status:409});};

export function materialMapService(db,goalResources=null){
 db.exec(`CREATE TABLE IF NOT EXISTS material_maps(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,set_id TEXT NOT NULL,resource_id TEXT NOT NULL,content_id TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TEXT NOT NULL,scope TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS material_map_items(id TEXT PRIMARY KEY,map_id TEXT NOT NULL,requirement_id TEXT NOT NULL,coverage TEXT NOT NULL,rationale TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS material_map_revisions(id TEXT PRIMARY KEY,map_id TEXT NOT NULL,revision INTEGER NOT NULL,coverage_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(map_id,revision));
 CREATE TABLE IF NOT EXISTS material_conflicts(id TEXT PRIMARY KEY,map_id TEXT NOT NULL,description TEXT NOT NULL,requirement_ids TEXT NOT NULL,important INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN',decision TEXT,decision_note TEXT,decided_at TEXT,created_at TEXT NOT NULL,source_refs TEXT NOT NULL DEFAULT '[]',resolution_content_id TEXT,source_scopes TEXT NOT NULL DEFAULT '{}');`);
 const mapCols=new Set(db.prepare('PRAGMA table_info(material_maps)').all().map(x=>x.name));
 if(!mapCols.has('scope'))db.exec("ALTER TABLE material_maps ADD COLUMN scope TEXT NOT NULL DEFAULT ''");
 db.exec('DROP INDEX IF EXISTS idx_material_maps_version');
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_material_maps_version ON material_maps(goal_id,set_id,content_id,scope)');
 db.exec('CREATE TABLE IF NOT EXISTS material_conflict_decisions(id TEXT PRIMARY KEY,conflict_id TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,decided_at TEXT NOT NULL)');
 const cols=new Set(db.prepare('PRAGMA table_info(material_conflicts)').all().map(x=>x.name));
 if(!cols.has('source_refs'))db.exec("ALTER TABLE material_conflicts ADD COLUMN source_refs TEXT NOT NULL DEFAULT '[]'");
 if(!cols.has('resolution_content_id'))db.exec('ALTER TABLE material_conflicts ADD COLUMN resolution_content_id TEXT');
 if(!cols.has('source_scopes'))db.exec("ALTER TABLE material_conflicts ADD COLUMN source_scopes TEXT NOT NULL DEFAULT '{}'");
 const decisionCols=new Set(db.prepare('PRAGMA table_info(material_conflict_decisions)').all().map(x=>x.name));
 if(!decisionCols.has('source_content_id'))db.exec('ALTER TABLE material_conflict_decisions ADD COLUMN source_content_id TEXT');
 const one=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p),run=(q,...p)=>db.prepare(q).run(...p);
 function current(goalId){const set=one("SELECT * FROM capability_sets WHERE goal_id=? AND status='ACCEPTED' ORDER BY rowid DESC LIMIT 1",goalId);return set?{set,requirements:all('SELECT id,description FROM requirements WHERE set_id=?',set.id)}:null;}
 function relation(goalId,resourceId){return goalResources?goalResources.get(goalId,resourceId):one('SELECT * FROM resources WHERE id=? AND goal_id=?',resourceId,goalId);}
 function scopedContent(goalId,contentId){return goalResources?goalResources.contentForGoal(goalId,contentId):one('SELECT c.*,c.scope AS target_scope FROM material_contents c JOIN resources r ON r.id=c.resource_id WHERE r.goal_id=? AND c.id=?',goalId,contentId);}
 function currentBoundContent(goalId,resourceId){return goalResources?.latestContent(goalId,resourceId)||null;}
 function validVersion(m){const c=goalResources?goalResources.contentForGoal(m.goal_id,m.content_id):one('SELECT c.*,c.scope AS target_scope FROM material_contents c JOIN resources r ON r.id=c.resource_id WHERE r.goal_id=? AND c.id=?',m.goal_id,m.content_id),latest=goalResources?currentBoundContent(m.goal_id,m.resource_id):one('SELECT id,hash FROM material_contents WHERE resource_id=? ORDER BY rowid DESC LIMIT 1',m.resource_id),owner=relation(m.goal_id,m.resource_id),scope=owner?.scope??c?.scope,v=current(m.goal_id);if(!(c&&latest?.id===m.content_id&&latest.hash===m.content_hash&&c.hash===m.content_hash&&c.resource_id===m.resource_id&&v?.set.id===m.set_id&&owner&&owner.role!=='REFERENCE'&&(!goalResources||owner.scope_status==='CONFIRMED')&&scope===m.scope))return false;for(const row of all('SELECT source_refs,source_scopes FROM material_conflicts WHERE map_id=?',m.map_id||m.id))for(const sourceId of JSON.parse(row.source_refs||'[]')){const source=goalResources?goalResources.contentForGoal(m.goal_id,sourceId):one('SELECT c.*,c.scope AS target_scope FROM material_contents c JOIN resources r ON r.id=c.resource_id WHERE r.goal_id=? AND c.id=?',m.goal_id,sourceId),latestSource=source&&(goalResources?currentBoundContent(m.goal_id,source.resource_id):one('SELECT id FROM material_contents WHERE resource_id=? ORDER BY rowid DESC LIMIT 1',source.resource_id)),sourceOwner=source&&relation(m.goal_id,source.resource_id),sourceScope=sourceOwner?.scope??source?.scope,savedScopes=JSON.parse(row.source_scopes||'{}');if(!source||latestSource?.id!==sourceId||!sourceOwner||sourceOwner.role==='REFERENCE'||(goalResources&&sourceOwner.scope_status!=='CONFIRMED')||sourceScope!==savedScopes[sourceId])return false;}return true;}
 function register(a){
  const v=current(a.goal_id);if(!v)fail('先确认当前能力要求');
  const c=scopedContent(a.goal_id,a.content_id),r=c&&relation(a.goal_id,c.resource_id);if(!c||!r)fail('正文版本不属于当前目标');
  if(r.role==='REFERENCE')fail('参考资料不能计入要求覆盖或资料充分性');if(goalResources&&r.scope_status!=='CONFIRMED')fail('请先确认此目标下的资料范围');
  if(!Array.isArray(a.coverage)||!Array.isArray(a.conflicts))fail('覆盖和冲突都需要数组');
  const scope=r.scope||c.target_scope||c.scope||'';if(!scope.trim())fail('请先确认要覆盖的资料范围');
  const ids=new Set(v.requirements.map(x=>x.id));
  const coverage=a.coverage.map(x=>({requirement_id:x.requirement_id,coverage:x.coverage,rationale:String(x.rationale||'').slice(0,2000)}));
  for(const x of coverage)if(!ids.has(x.requirement_id)||!['COVERED','PARTIAL','NOT_COVERED','UNCLEAR'].includes(x.coverage))fail('覆盖记录必须对应当前版本要求');
  if(new Set(coverage.map(x=>x.requirement_id)).size!==coverage.length)fail('同一要求只能登记一条覆盖判断');
  const prepared=[];
  for(const x of a.conflicts){
   const requirementIds=[...new Set(x.requirement_ids||[])].sort();if(!requirementIds.length||requirementIds.some(id=>!ids.has(id)))fail('冲突必须关联当前版本要求');
   const sources=[...new Set([c.id,...(x.source_content_ids||[])])],sourceScopes={};
   for(const sourceId of sources){
    const source=scopedContent(a.goal_id,sourceId),owner=source&&relation(a.goal_id,source.resource_id);
    if(!source||!owner||owner.role==='REFERENCE'||(goalResources&&owner.scope_status!=='CONFIRMED'))fail('冲突来源必须是本目标范围已确认并明确绑定的学习或补充材料正文');
    sourceScopes[sourceId]=owner.scope||source.target_scope||source.scope||'';
   }
   if(x.important&&sources.length<2)fail('重要冲突需关联两份来源正文');
   prepared.push({description:String(x.description||'').trim().slice(0,3000),requirement_ids:requirementIds,important:x.important?1:0,sources,source_scopes:sourceScopes});
  }
  const existing=one('SELECT * FROM material_maps WHERE goal_id=? AND set_id=? AND content_id=? AND scope=?',a.goal_id,v.set.id,c.id,scope);
  const mapId=existing?.id||uid();
  const latestRevision=existing&&one('SELECT * FROM material_map_revisions WHERE map_id=? ORDER BY revision DESC LIMIT 1',mapId);
  const oldCoverage=latestRevision?JSON.parse(latestRevision.coverage_json):existing?all('SELECT requirement_id,coverage,rationale FROM material_map_items WHERE map_id=? ORDER BY rowid',mapId):null;
  const coverageChanged=!oldCoverage||json(oldCoverage)!==json(coverage);
  const priorConflicts=existing?all('SELECT description,requirement_ids,important,source_refs,source_scopes FROM material_conflicts WHERE map_id=?',mapId):[];
  const isKnown=x=>priorConflicts.some(y=>y.description===x.description&&Number(y.important)===x.important&&json([...JSON.parse(y.requirement_ids)].sort())===json(x.requirement_ids)&&json([...JSON.parse(y.source_refs||'[]')].sort())===json([...x.sources].sort())&&json(JSON.parse(y.source_scopes||'{}'))===json(x.source_scopes));
  const newConflicts=prepared.filter(x=>!isKnown(x));
  if(existing&&!coverageChanged&&!newConflicts.length)return {map_id:mapId,reused:true};
  db.exec('BEGIN IMMEDIATE');try{
   if(!existing)run('INSERT INTO material_maps(id,goal_id,set_id,resource_id,content_id,content_hash,created_at,scope) VALUES(?,?,?,?,?,?,?,?)',mapId,a.goal_id,v.set.id,r.id,c.id,c.hash,now(),scope);
   if(!existing)for(const x of coverage)run('INSERT INTO material_map_items VALUES(?,?,?,?,?)',uid(),mapId,x.requirement_id,x.coverage,x.rationale);
   if(coverageChanged){const revision=(latestRevision?.revision||0)+1;run('INSERT INTO material_map_revisions(id,map_id,revision,coverage_json,created_at) VALUES(?,?,?,?,?)',uid(),mapId,revision,json(coverage),now());}
   for(const x of newConflicts)run('INSERT INTO material_conflicts(id,map_id,description,requirement_ids,important,status,created_at,source_refs,source_scopes) VALUES(?,?,?,?,?,?,?,?,?)',uid(),mapId,x.description,json(x.requirement_ids),x.important,'OPEN',now(),json(x.sources),json(x.source_scopes));
   db.exec('COMMIT');return {map_id:mapId,revised:!!existing};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function registerFromJob(a){const j=one('SELECT j.id,j.lease_token,j.lease_until,j.status,c.goal_id,ex.module,ex.content_id FROM jobs j JOIN conversations c ON c.id=j.conversation_id JOIN job_execution ex ON ex.job_id=j.id WHERE j.id=?',a.job_id);if(!j||j.status!=='RUNNING'||j.lease_token!==a.lease_token||j.lease_until<Date.now()||!['material','roadmap'].includes(j.module))fail('材料映射工具未绑定到有效的材料或路线任务');if(j.content_id&&j.content_id!==a.content_id)fail('正文版本不属于当前任务');if(!scopedContent(j.goal_id,a.content_id))fail('正文版本不属于当前目标');const sources=[...new Set([a.content_id,...(a.conflicts||[]).flatMap(x=>x.source_content_ids||[])])];if(j.module==='material'&&sources.some(id=>id!==a.content_id))fail('跨资料冲突请在学习路线任务中比较正文版本');for(const sourceId of sources)if(!one('SELECT 1 FROM receipts WHERE request_id=?',j.id+':read:'+sourceId))fail('请先读取冲突涉及的每份正文，再登记覆盖或冲突');return register({...a,goal_id:j.goal_id});}
 function recordReadFromJob(a){const j=one('SELECT j.id,j.lease_token,j.lease_until,j.status,c.goal_id,ex.module,ex.content_id FROM jobs j JOIN conversations c ON c.id=j.conversation_id JOIN job_execution ex ON ex.job_id=j.id WHERE j.id=?',a.job_id);if(!j||j.status!=='RUNNING'||j.lease_token!==a.lease_token||j.lease_until<Date.now()||!['material','roadmap'].includes(j.module))fail('正文读取未绑定到有效的材料或路线任务');if(j.content_id&&j.content_id!==a.content_id)fail('正文版本不属于当前任务');if(!scopedContent(j.goal_id,a.content_id))fail('正文版本不属于当前目标');run('INSERT OR IGNORE INTO receipts VALUES(?,?,?)',j.id+':read:'+a.content_id,'agent-read','{}');}
 function state(goalId){if(!goalId){const by_goal=Object.fromEntries(all('SELECT id FROM goals').map(g=>[g.id,state(g.id)]));return {current_set_id:null,by_goal,items:Object.entries(by_goal).flatMap(([goal_id,x])=>x.items.map(i=>({...i,goal_id}))),conflicts:Object.entries(by_goal).flatMap(([goal_id,x])=>x.conflicts.map(c=>({...c,goal_id}))),unmapped:Object.entries(by_goal).flatMap(([goal_id,x])=>x.unmapped.map(requirement_id=>({goal_id,requirement_id})))};}const v=current(goalId);if(!v)return {current_set_id:null,items:[],conflicts:[],unmapped:[]};const maps=all('SELECT * FROM material_maps WHERE goal_id=? ORDER BY created_at DESC',goalId),items=maps.flatMap(m=>{const revisions=all('SELECT revision,coverage_json,created_at FROM material_map_revisions WHERE map_id=? ORDER BY revision',m.id),latestRevision=revisions.at(-1),rows=latestRevision?JSON.parse(latestRevision.coverage_json):all('SELECT requirement_id,coverage,rationale FROM material_map_items WHERE map_id=?',m.id);return rows.map(x=>({...x,map_id:m.id,resource_id:m.resource_id,content_id:m.content_id,content_hash:m.content_hash,scope:m.scope,created_at:m.created_at,current:validVersion(m),revision:latestRevision?.revision||1,revision_history:revisions.map(h=>({revision:h.revision,created_at:h.created_at,coverage:JSON.parse(h.coverage_json)}))}));}),conflicts=maps.flatMap(m=>all('SELECT * FROM material_conflicts WHERE map_id=?',m.id).map(c=>({...c,requirement_ids:JSON.parse(c.requirement_ids),source_content_ids:JSON.parse(c.source_refs||'[]'),source_scopes:JSON.parse(c.source_scopes||'{}'),decision_history:all('SELECT decision,note,decided_at,source_content_id FROM material_conflict_decisions WHERE conflict_id=? ORDER BY decided_at,rowid',c.id),important:!!c.important,current:validVersion(m)})));const mapped=new Set(items.filter(i=>i.current).map(i=>i.requirement_id));return {current_set_id:v.set.id,items,conflicts,unmapped:v.requirements.filter(r=>!mapped.has(r.id)).map(r=>r.id)};}
 function resolve(a){if(typeof a.request_id!=='string'||!a.request_id.trim()||a.request_id.length>100)fail('裁决请求标识无效');const old=one('SELECT * FROM receipts WHERE request_id=?',a.request_id);if(old){if(old.operation!=='material-map-resolve:'+a.conflict_id)fail('裁决请求标识已用于其他操作');return JSON.parse(old.result);}const c=one('SELECT c.*,m.id AS map_id,m.goal_id,m.set_id,m.content_id,m.content_hash,m.resource_id,m.scope,g.status AS goal_status FROM material_conflicts c JOIN material_maps m ON m.id=c.map_id JOIN goals g ON g.id=m.goal_id WHERE c.id=? AND m.goal_id=?',a.conflict_id,a.goal_id);if(!c||!validVersion(c))fail('冲突不属于当前资料/要求版本');if(['COMPLETED','ABANDONED'].includes(c.goal_status))fail('已结束目标只读');if(!['ADOPTED','NO_CONFLICT'].includes(a.decision))fail('必须选择采用某份来源正文，或说明经核对不构成冲突');const note=String(a.note||'').trim();if(!note||note.length>2000)fail('请填写裁决理由');let sourceId=null;if(a.decision==='ADOPTED'){sourceId=a.source_content_id;if(!sourceId||!JSON.parse(c.source_refs||'[]').includes(sourceId))fail('请选择这项冲突中已引用的正文版本');}else if(a.source_content_id)fail('不构成冲突的裁决不应选择采用来源');const at=now(),result={ok:true,decision:a.decision,source_content_id:sourceId};db.exec('BEGIN IMMEDIATE');try{run('INSERT INTO material_conflict_decisions(id,conflict_id,decision,note,decided_at,source_content_id) VALUES(?,?,?,?,?,?)',uid(),c.id,a.decision,note,at,sourceId);run('UPDATE material_conflicts SET status=?,decision=?,decision_note=?,decided_at=?,resolution_content_id=? WHERE id=?','RESOLVED',a.decision,note,at,sourceId,c.id);run('INSERT INTO receipts VALUES(?,?,?)',a.request_id,'material-map-resolve:'+a.conflict_id,json(result));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function openConflicts(goalId){
  return state(goalId).conflicts.filter(c=>c.current && c.important && c.status==='OPEN');
 }
 function blockers(goalId,requirementIds){
  const wanted=new Set(requirementIds);
  return openConflicts(goalId).filter(c=>c.requirement_ids.some(id=>wanted.has(id)));
 }
 return {register,registerFromJob,recordReadFromJob,state,resolve,openConflicts,blockers};
}
