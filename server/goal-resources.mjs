const now=()=>new Date().toISOString();
const fail=message=>{throw Object.assign(new Error(message,{status:409}));};

/** Formal, per-goal role and range for a globally stored resource/blob. */
export function goalResourcesService(db){
 const one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 db.exec(`CREATE TABLE IF NOT EXISTS goal_resources(
  goal_id TEXT NOT NULL REFERENCES goals(id),resource_id TEXT NOT NULL REFERENCES resources(id),
  role TEXT NOT NULL CHECK(role IN ('PRIMARY','SUPPLEMENTARY','REFERENCE')),
  scope TEXT NOT NULL DEFAULT '',scope_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(scope_status IN ('PENDING','CONFIRMED')),content_id TEXT REFERENCES material_contents(id),
  supplement_status TEXT NOT NULL DEFAULT 'NONE' CHECK(supplement_status IN ('NONE','PENDING','COMPLETED')),
  supplement_requirement_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(goal_id,resource_id)
 );`);
 const linkColumns=new Set(db.prepare('PRAGMA table_info(goal_resources)').all().map(column=>column.name));if(!linkColumns.has('content_id'))db.exec('ALTER TABLE goal_resources ADD COLUMN content_id TEXT REFERENCES material_contents(id)');if(!linkColumns.has('supplement_requirement_ids'))db.exec("ALTER TABLE goal_resources ADD COLUMN supplement_requirement_ids TEXT NOT NULL DEFAULT '[]'");
 const analysisColumns=new Set(db.prepare('PRAGMA table_info(material_analysis)').all().map(column=>column.name));
 if(!analysisColumns.has('goal_id'))db.exec('ALTER TABLE material_analysis ADD COLUMN goal_id TEXT REFERENCES goals(id)');
 run(`UPDATE material_analysis SET goal_id=(SELECT goal_id FROM resources WHERE resources.id=material_analysis.resource_id)
      WHERE goal_id IS NULL AND EXISTS(SELECT 1 FROM resources WHERE resources.id=material_analysis.resource_id AND goal_id IS NOT NULL)`);
 run(`INSERT OR IGNORE INTO goal_resources(goal_id,resource_id,role,scope,scope_status,supplement_status,created_at,updated_at)
      SELECT r.goal_id,r.id,r.role,
       COALESCE((SELECT ma.scope FROM material_analysis ma WHERE ma.resource_id=r.id AND ma.goal_id=r.goal_id ORDER BY ma.rowid DESC LIMIT 1),
                (SELECT mc.scope FROM material_contents mc WHERE mc.resource_id=r.id ORDER BY mc.rowid DESC LIMIT 1),''),
       CASE WHEN COALESCE((SELECT ma.scope FROM material_analysis ma WHERE ma.resource_id=r.id AND ma.goal_id=r.goal_id ORDER BY ma.rowid DESC LIMIT 1),
                          (SELECT mc.scope FROM material_contents mc WHERE mc.resource_id=r.id ORDER BY mc.rowid DESC LIMIT 1),'')='' THEN 'PENDING' ELSE 'CONFIRMED' END,
       'NONE',r.created_at,r.created_at FROM resources r WHERE r.goal_id IS NOT NULL`);
 run(`UPDATE goal_resources SET content_id=(SELECT mc.id FROM material_contents mc WHERE mc.resource_id=goal_resources.resource_id AND mc.scope=goal_resources.scope ORDER BY mc.rowid DESC LIMIT 1)
      WHERE content_id IS NULL AND scope_status='CONFIRMED' AND scope<>'' AND (SELECT goal_id FROM resources WHERE id=goal_resources.resource_id)=goal_resources.goal_id`);

 function decorate(row,goalId){return row?{...row,legacy_role:row.role,role:row.target_role,scope:row.target_scope,goal_id:goalId,supplement_requirement_ids:JSON.parse(row.supplement_requirement_ids||'[]')}:null;}
 function get(goalId,resourceId){const row=one(`SELECT r.*,gr.role AS target_role,gr.scope AS target_scope,gr.scope_status,gr.supplement_status,gr.supplement_requirement_ids,gr.content_id,gr.created_at AS linked_at,gr.updated_at AS link_updated_at
  FROM goal_resources gr JOIN resources r ON r.id=gr.resource_id WHERE gr.goal_id=? AND gr.resource_id=?`,goalId,resourceId);return decorate(row,goalId);}
 function forGoal(goalId){return all(`SELECT r.*,gr.role AS target_role,gr.scope AS target_scope,gr.scope_status,gr.supplement_status,gr.supplement_requirement_ids,gr.content_id,gr.created_at AS linked_at,gr.updated_at AS link_updated_at
  FROM goal_resources gr JOIN resources r ON r.id=gr.resource_id WHERE gr.goal_id=? ORDER BY gr.created_at,gr.resource_id`,goalId).map(row=>decorate(row,goalId));}
 function list(){return all('SELECT * FROM goal_resources ORDER BY goal_id,created_at,resource_id').map(row=>({...row,supplement_requirement_ids:JSON.parse(row.supplement_requirement_ids||'[]')}));}
 function add(input){
  const goal=one('SELECT * FROM goals WHERE id=?',input.goal_id),resource=one('SELECT * FROM resources WHERE id=?',input.resource_id);
  if(!goal||!resource)fail('目标或资料不存在');if(['COMPLETED','ABANDONED','PAUSED'].includes(goal.status))fail('只能关联到准备中或进行中的目标');
  if(!['PRIMARY','SUPPLEMENTARY','REFERENCE'].includes(input.role))fail('资料用途无效');
  const scope=String(input.scope||'').trim();if(scope.length>3000)fail('资料范围最多 3000 字');
  const scopeStatus=scope?'CONFIRMED':input.role==='REFERENCE'?'CONFIRMED':'PENDING';
  const selectedContent=input.content_id?one('SELECT id,resource_id,scope FROM material_contents WHERE id=?',input.content_id):null;if(input.content_id&&selectedContent?.resource_id!==resource.id)fail('所选正文版本不属于该附件');if(selectedContent&&selectedContent.scope!==scope)fail('所选正文版本保存范围与本目标范围不同；请粘贴本目标范围的准确正文');
  const old=get(goal.id,resource.id),hasAcceptedPlan=!!one("SELECT id FROM proposals WHERE goal_id=? AND status='ACCEPTED'",goal.id);
  const requested=input.supplement_required===undefined?(goal.status==='ACTIVE'&&hasAcceptedPlan&&input.role==='PRIMARY'):input.supplement_required===true;
  const supplementStatus=input.role==='PRIMARY'&&requested?'PENDING':'NONE',at=now();
  if(old){
   const changed=old.role!==input.role||old.scope!==scope;
   const resetSupplement=old.supplement_status!==supplementStatus||changed;
   run("UPDATE goal_resources SET role=?,scope=?,scope_status=?,supplement_status=?,supplement_requirement_ids=CASE WHEN ? THEN '[]' ELSE supplement_requirement_ids END,content_id=CASE WHEN ? IS NOT NULL THEN ? WHEN ? THEN NULL ELSE content_id END,updated_at=? WHERE goal_id=? AND resource_id=?",input.role,scope,scopeStatus,supplementStatus,resetSupplement?1:0,input.content_id||null,input.content_id||null,changed?1:0,at,goal.id,resource.id);
  }else run('INSERT INTO goal_resources(goal_id,resource_id,role,scope,scope_status,supplement_status,supplement_requirement_ids,content_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',goal.id,resource.id,input.role,scope,scopeStatus,supplementStatus,'[]',selectedContent?.id||null,at,at);
  return {...get(goal.id,resource.id),reused:!!old};
 }
 function confirmScope(goalId,resourceId,scope){const relation=get(goalId,resourceId);if(!relation)fail('资料不属于当前目标');const value=String(scope||'').trim();if(!value||value.length>3000)fail('请明确该目标下的资料范围');if(['COMPLETED','ABANDONED'].includes(one('SELECT status FROM goals WHERE id=?',goalId)?.status))fail('已结束目标只读');run("UPDATE goal_resources SET scope=?,scope_status='CONFIRMED',content_id=CASE WHEN scope<>? THEN NULL ELSE content_id END,updated_at=? WHERE goal_id=? AND resource_id=?",value,value,now(),goalId,resourceId);return get(goalId,resourceId);}
 function bindContent(goalId,resourceId,contentId,scope){const relation=get(goalId,resourceId),body=one('SELECT id,resource_id,scope FROM material_contents WHERE id=?',contentId);if(!relation||!body||body.resource_id!==resourceId)fail('正文版本不属于该目标资料');const value=String(scope||'').trim();if(!value||value.length>3000)fail('请确认正文版本对应的范围');if(body.scope!==value)fail('正文版本保存范围与本目标约定范围不同，请粘贴该范围的准确正文');if(relation.scope!==value||relation.scope_status!=='CONFIRMED')confirmScope(goalId,resourceId,value);run("UPDATE goal_resources SET content_id=?,scope_status='CONFIRMED',updated_at=? WHERE goal_id=? AND resource_id=?",contentId,now(),goalId,resourceId);return get(goalId,resourceId);}
 function contentForGoal(goalId,contentId){return one(`SELECT c.*,gr.role AS target_role,gr.scope AS target_scope,gr.scope_status,gr.supplement_status
  FROM material_contents c JOIN goal_resources gr ON gr.resource_id=c.resource_id AND gr.content_id=c.id AND gr.scope=c.scope WHERE gr.goal_id=? AND c.id=?`,goalId,contentId);}
 function latestContent(goalId,resourceId){const relation=get(goalId,resourceId);if(!relation?.content_id||relation.scope_status!=='CONFIRMED')return null;const content=one('SELECT * FROM material_contents WHERE id=? AND resource_id=? AND scope=?',relation.content_id,resourceId,relation.scope);return content?{...content,scope_status:relation.scope_status,role:relation.role}:null;}
 function contents(goalId){return forGoal(goalId).flatMap(relation=>relation.content_id&&relation.scope_status==='CONFIRMED'?all('SELECT id,resource_id,hash,scope,created_at,length(content) AS characters FROM material_contents WHERE id=? AND resource_id=? AND scope=?',relation.content_id,relation.id,relation.scope).map(content=>({...content,scope_status:relation.scope_status,role:relation.role,goal_id:goalId})):[]);}
 function analyses(goalId){return all('SELECT a.* FROM material_analysis a JOIN goal_resources gr ON gr.goal_id=a.goal_id AND gr.resource_id=a.resource_id AND gr.content_id=a.content_id AND gr.scope=a.scope WHERE a.goal_id=? ORDER BY a.rowid',goalId);}
 function contentsAll(){return all(`SELECT c.id,c.resource_id,c.hash,c.scope,c.created_at,length(c.content) AS characters,
  gr.scope_status,gr.role,g.id AS goal_id
  FROM goals g JOIN goal_resources gr ON gr.goal_id=g.id
  JOIN resources r ON r.id=gr.resource_id
  JOIN material_contents c ON c.id=gr.content_id AND c.resource_id=r.id AND c.scope=gr.scope
  WHERE gr.content_id IS NOT NULL AND gr.scope_status='CONFIRMED'
  ORDER BY g.id,gr.created_at,gr.resource_id`).map(row=>({...row}));}
 function analysesAll(){return all(`SELECT a.* FROM goals g
  JOIN material_analysis a ON a.goal_id=g.id
  JOIN goal_resources gr ON gr.goal_id=a.goal_id AND gr.resource_id=a.resource_id
   AND gr.content_id=a.content_id AND gr.scope=a.scope
  ORDER BY g.id,a.rowid`);}
 function latestAnalysis(goalId,resourceId,contentId){const relation=get(goalId,resourceId);if(!relation||relation.scope_status!=='CONFIRMED')return null;return one("SELECT * FROM material_analysis WHERE goal_id=? AND resource_id=? AND content_id=? AND scope=? ORDER BY rowid DESC LIMIT 1",goalId,resourceId,contentId,relation.scope);}
 function pendingSupplements(goalId){return forGoal(goalId).filter(resource=>resource.role==='PRIMARY'&&resource.supplement_status==='PENDING');}
 function setSupplementRequirements(goalId,resourceIds,requirementIds){const ids=[...new Set(requirementIds)];if(!ids.length)fail('局部补诊至少选择一项能力要求');for(const resourceId of new Set(resourceIds)){const relation=get(goalId,resourceId);if(!relation||relation.role!=='PRIMARY'||relation.supplement_status!=='PENDING')fail('局部补诊只能针对待补诊的主材料');run('UPDATE goal_resources SET supplement_requirement_ids=?,updated_at=? WHERE goal_id=? AND resource_id=?',JSON.stringify(ids),now(),goalId,resourceId);}return pendingSupplements(goalId);}
 function completeSupplements(goalId,resourceIds){const unique=[...new Set(resourceIds)];for(const resourceId of unique){const relation=get(goalId,resourceId);if(!relation||relation.role!=='PRIMARY'||relation.supplement_status!=='PENDING')continue;run("UPDATE goal_resources SET supplement_status='COMPLETED',updated_at=? WHERE goal_id=? AND resource_id=?",now(),goalId,resourceId);}return pendingSupplements(goalId);}
 return {get,forGoal,list,add,confirmScope,bindContent,contentForGoal,latestContent,contents,analyses,contentsAll,analysesAll,latestAnalysis,pendingSupplements,setSupplementRequirements,completeSupplements};
}
