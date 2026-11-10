import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const now = () => new Date().toISOString();
const fail = message => {
  throw Object.assign(new Error(message), { status: 409 });
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const labels = { WAITING_MATERIALS: '先补齐主材料', GENERATING_CAPABILITIES: '正在整理能力要求', REVIEW_CAPABILITIES: '请审阅能力要求', DIAGNOSIS: '初始诊断', WAITING_ASSESSMENT: '先完成当前考察', GENERATING_ROADMAP: '正在生成正式路线', REVIEW_ROADMAP: '请审阅正式路线', COMPLETE: '正式路线已确认', BLOCKED: '规划暂时停在这里', NEEDS_REVISION: '先讨论如何修改', PAUSED: '目标已暂停', ENDED: '目标已结束', DEFERRED: '稍后继续规划', STOPPED: '自动规划已停止' };

/** Opt-in orchestration. Views are pure; only reconcile/start/control write. */
export function planningFlowService(db, { receipt, leased, models, agents, learning, goalResources, file = ':memory:' }) {
  const one = (q, ...p) => db.prepare(q).get(...p), all = (q, ...p) => db.prepare(q).all(...p), run = (q, ...p) => db.prepare(q).run(...p);
  if (file !== ':memory:' && !one("SELECT 1 FROM sqlite_master WHERE name='planning_flows'")) {
    const folder = join(dirname(file), 'backups');
    mkdirSync(folder, { recursive: true });
    db.prepare('VACUUM INTO ?').run(join(folder, 'before-planning-flow-' + randomUUID() + '.sqlite'));
  }
  db.exec(`CREATE TABLE IF NOT EXISTS planning_flows(
  goal_id TEXT PRIMARY KEY REFERENCES goals(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),
  source_message_id TEXT REFERENCES messages(id),status TEXT NOT NULL CHECK(status IN ('ACTIVE','DEFERRED','STOPPED')),
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS planning_flow_jobs(
  goal_id TEXT NOT NULL REFERENCES planning_flows(goal_id),stage TEXT NOT NULL,input_key TEXT NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),PRIMARY KEY(goal_id,stage,input_key));
 CREATE TABLE IF NOT EXISTS planning_flow_suspensions(
  goal_id TEXT NOT NULL REFERENCES planning_flows(goal_id),job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  PRIMARY KEY(goal_id,job_id));`);
  db.exec(`CREATE TABLE IF NOT EXISTS planning_flow_attempt_history(
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),goal_id TEXT NOT NULL,stage TEXT NOT NULL,input_key TEXT NOT NULL,
  created_at TEXT NOT NULL,claimed_at TEXT,cancel_reason TEXT);
 INSERT OR IGNORE INTO planning_flow_attempt_history(job_id,goal_id,stage,input_key,created_at,claimed_at)
 SELECT f.job_id,f.goal_id,f.stage,f.input_key,j.created_at,
 CASE WHEN j.status<>'QUEUED' OR j.host IS NOT NULL OR ex.blocked=1
 OR EXISTS(SELECT 1 FROM model_runs r WHERE r.job_id=j.id)
 OR EXISTS(SELECT 1 FROM host_runs r WHERE r.job_id=j.id)
 OR EXISTS(SELECT 1 FROM harness_runs r WHERE r.job_id=j.id) THEN j.created_at ELSE NULL END
 FROM planning_flow_jobs f JOIN jobs j ON j.id=f.job_id JOIN job_execution ex ON ex.job_id=j.id;`);
  db.exec(`CREATE TABLE IF NOT EXISTS planning_flow_outputs(
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),goal_id TEXT NOT NULL,tool_name TEXT NOT NULL,
  request_id TEXT NOT NULL,argument_hash TEXT NOT NULL,result TEXT NOT NULL,artifact_id TEXT NOT NULL,
  dependency_fingerprint TEXT NOT NULL,created_at TEXT NOT NULL);`);
  const columns = new Set(all('PRAGMA table_info(planning_flows)').map(c => c.name));
  for (const [name, type] of [['revision_key', "TEXT NOT NULL DEFAULT ''"], ['revision_proposal_id', 'TEXT'], ['revision_feedback', "TEXT NOT NULL DEFAULT ''"], ['baseline_rejected_id', 'TEXT'], ['attempt_key', "TEXT NOT NULL DEFAULT ''"], ['rework_feedback', "TEXT NOT NULL DEFAULT ''"]]) if (!columns.has(name)) db.exec('ALTER TABLE planning_flows ADD COLUMN ' + name + ' ' + type);
  function tx(fn) {
    if (db.isTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  function target(goalId, conversationId) {
    const goal = one('SELECT * FROM goals WHERE id=?', goalId);
    if (!goal) fail('目标不存在');
    const flow = one('SELECT * FROM planning_flows WHERE goal_id=?', goalId);
    const chat = conversationId ? one('SELECT * FROM conversations WHERE id=?', conversationId) : flow ? one('SELECT * FROM conversations WHERE id=?', flow.conversation_id) : one("SELECT * FROM conversations WHERE goal_id=? AND kind='PLANNING' ORDER BY rowid LIMIT 1", goalId);
    if (!chat || chat.goal_id !== goalId || chat.kind !== 'PLANNING') fail('自动规划需要当前目标的规划对话');
    if (flow && flow.conversation_id !== chat.id) fail('此目标的自动规划已绑定另一段原始对话，请进入原规划对话');
    return { goal, chat, flow };
  }
  function primaryFacts(goalId) {
    return all(`SELECT r.id,r.title,gr.scope,gr.scope_status,gr.supplement_status,gr.content_id,mc.id AS bound_content_id,
 (SELECT a.id FROM material_analysis a WHERE a.goal_id=gr.goal_id AND a.resource_id=gr.resource_id AND a.content_id=gr.content_id AND a.scope=gr.scope ORDER BY a.rowid DESC LIMIT 1) AS analysis_id,
 (SELECT a.status FROM material_analysis a WHERE a.goal_id=gr.goal_id AND a.resource_id=gr.resource_id AND a.content_id=gr.content_id AND a.scope=gr.scope ORDER BY a.rowid DESC LIMIT 1) AS analysis_status
 FROM goal_resources gr JOIN resources r ON r.id=gr.resource_id LEFT JOIN material_contents mc ON mc.id=gr.content_id AND mc.resource_id=gr.resource_id AND mc.scope=gr.scope
 WHERE gr.goal_id=? AND gr.role='PRIMARY' ORDER BY r.id`, goalId);
  }
  function materialBlockers(primary) {
    return primary.flatMap(resource => {
      const hasContent = resource.scope_status === 'CONFIRMED' && !!resource.bound_content_id, reason = resource.scope_status !== 'CONFIRMED' ? '范围尚未确认' : !hasContent ? '缺少本目标约定范围的正文' : resource.analysis_status !== 'ANALYZED' ? '当前正文尚未完成阅读分析' : resource.supplement_status === 'PENDING' ? '尚待局部补充诊断' : null;
      return reason ? [{ resource_id: resource.id, title: resource.title, reason, content_id: hasContent ? resource.content_id : null, can_analyze: hasContent && !resource.analysis_id }] : [];
    });
  }
  function facts(goalId) {
    const { goal, flow } = target(goalId);
    if (!flow) return null;
    const set = one("SELECT * FROM capability_sets WHERE goal_id=? AND status='ACCEPTED' ORDER BY rowid DESC LIMIT 1", goalId), pendingSet = one("SELECT * FROM capability_sets WHERE goal_id=? AND status='PENDING' ORDER BY rowid DESC LIMIT 1", goalId), latestSet = one('SELECT * FROM capability_sets WHERE goal_id=? ORDER BY rowid DESC LIMIT 1', goalId);
    const requirements = set ? all('SELECT id FROM requirements WHERE set_id=?', set.id).map(r => r.id) : [];
    const diagnoses = set ? all("SELECT a.* FROM assessments a JOIN assessment_capabilities ac ON ac.assessment_id=a.id WHERE a.goal_id=? AND ac.set_id=? AND a.kind='INITIAL_DIAGNOSTIC' ORDER BY a.rowid DESC", goalId, set.id) : [];
    const diagnostic = diagnoses.find(a => ['COMPLETED', 'ENDED_EARLY'].includes(a.status) && requirements.every(r => JSON.parse(a.requirement_ids).includes(r)));
    const assessment = one("SELECT * FROM assessments WHERE goal_id=? AND status IN ('WAITING_HOST','WAITING_ANSWER','PAUSED') ORDER BY rowid DESC LIMIT 1", goalId);
    const roadmap = set ? one("SELECT p.* FROM proposals p JOIN roadmap_details d ON d.proposal_id=p.id WHERE p.goal_id=? AND d.set_id=? ORDER BY p.rowid DESC LIMIT 1", goalId, set.id) : null;
    const primary = primaryFacts(goalId), blockers = materialBlockers(primary), material = blockers.find(b => b.can_analyze), revisionType = flow.revision_proposal_id && one('SELECT 1 FROM capability_sets WHERE id=?', flow.revision_proposal_id) ? 'CAPABILITIES' : 'ROADMAP';
    const revising = !!flow.revision_key && (revisionType === 'CAPABILITIES' ? latestSet?.id === flow.revision_proposal_id : roadmap?.id === flow.revision_proposal_id);
    const stage = material ? 'MATERIAL' : revising ? revisionType : set ? 'ROADMAP' : 'CAPABILITIES';
    const inputKey = digest([material ? material.content_id : (set ? set.id + ':' + (diagnostic?.id || 'none') : 'initial'), material ? null : primary.map(r => [r.id, r.scope, r.scope_status, r.content_id, r.analysis_id, r.supplement_status]), revising ? flow.revision_key : '', flow.attempt_key]);
    const attempt = one('SELECT j.*,ex.blocked FROM planning_flow_jobs f JOIN jobs j ON j.id=f.job_id LEFT JOIN job_execution ex ON ex.job_id=j.id WHERE f.goal_id=? AND f.stage=? AND f.input_key=?', goalId, stage, inputKey);
    const materialFingerprint = digest(primary.map(r => [r.id, r.scope, r.scope_status, r.content_id, r.analysis_id, r.supplement_status]));
    return { goal, flow, set, pendingSet, latestSet, requirements, diagnostic, assessment, roadmap, stage, inputKey, attempt, blockers, material, revising, revisionType, materialFingerprint };
  }
  function viewOf(f) {
    if (!f) return null;
    const { goal, flow, set, pendingSet, latestSet, diagnostic, assessment, roadmap, attempt, blockers } = f;
    const goalId = goal.id;
    let stage, detail = '', proposalId = null;
    const options = [];
    if (['COMPLETED', 'ABANDONED'].includes(goal.status)) stage = 'ENDED';
    else if (goal.status === 'PAUSED') stage = 'PAUSED';
    else if (flow.status !== 'ACTIVE') stage = flow.status;
    else if (blockers.length) {
      stage = f.material ? 'ANALYZING_MATERIAL' : 'WAITING_MATERIALS';
      detail = f.material ? '正在读取已确认范围的当前正文并保存分析。' : '主材料按当前目标的实际范围和正文版本检查，补齐后自动继续。';
      options.push({ action: 'OPEN_MATERIALS', label: '查看主材料' });
    }
    else if (pendingSet) {
      stage = 'REVIEW_CAPABILITIES';
      proposalId = pendingSet.id;
      detail = '这里是已保存的能力提案，请确认或说明修改意见。';
      options.push({ action: 'REVIEW_CAPABILITIES', label: '审阅能力要求', proposal_id: proposalId });
    }
    else if (latestSet?.status === 'REJECTED' && latestSet.id !== flow.baseline_rejected_id && !(f.revising && f.revisionType === 'CAPABILITIES')) {
      stage = 'NEEDS_REVISION';
      proposalId = latestSet.id;
      detail = '能力提案已拒绝。请在原对话说明修改意见，平台不会自动重提。';
      options.push({ action: 'DISCUSS_REVISION', label: '讨论修改意见', proposal_id: latestSet.id, conversation_id: flow.conversation_id });
    }
    else if (!set) {
      stage = 'GENERATING_CAPABILITIES';
      detail = '沿用本对话中已经讨论的计划，整理为可确认的能力要求。';
    }
    else if (assessment) {
      stage = assessment.kind === 'INITIAL_DIAGNOSTIC' && one('SELECT 1 FROM assessment_capabilities WHERE assessment_id=? AND set_id=?', assessment.id, set.id) ? 'DIAGNOSIS' : 'WAITING_ASSESSMENT';
      detail = '请继续实际问答。诊断不会以聊天中的计划描述代替你的回答。';
      options.push({ action: 'CONTINUE_DIAGNOSIS', label: stage === 'DIAGNOSIS' ? '继续初始诊断' : '继续当前考察', assessment_id: assessment.id, conversation_id: assessment.conversation_id });
    }
    else if (f.revising) {
      stage = f.revisionType === 'CAPABILITIES' ? 'GENERATING_CAPABILITIES' : 'GENERATING_ROADMAP';
      detail = '根据你明确提出的修改意见，整理一份新的提案供审阅。';
    }
    else if (!diagnostic) {
      stage = 'DIAGNOSIS';
      detail = '能力要求已确认。开始逐题诊断后，老师会根据你的实际回答安排正式路线。';
      options.push({ action: 'START_DIAGNOSIS', label: '开始初始诊断', capability_set_id: set.id });
    }
    else if (roadmap?.status === 'PENDING') {
      stage = 'REVIEW_ROADMAP';
      proposalId = roadmap.id;
      detail = '这里是已保存的正式路线提案，请审阅后确认或提出修改意见。';
      options.push({ action: 'REVIEW_ROADMAP', label: '审阅正式路线', proposal_id: proposalId });
    }
    else if (roadmap?.status === 'ACCEPTED') {
      stage = 'COMPLETE';
      detail = '正式路线已经确认，可以开始学习。';
    }
    else if (roadmap?.status === 'REJECTED' && roadmap.id !== flow.baseline_rejected_id) {
      stage = 'NEEDS_REVISION';
      proposalId = roadmap.id;
      detail = '路线提案已拒绝。请在原对话说明修改意见，平台不会自动重提。';
      options.push({ action: 'DISCUSS_REVISION', label: '讨论修改意见', proposal_id: roadmap.id, conversation_id: flow.conversation_id });
    }
    else {
      stage = 'GENERATING_ROADMAP';
      detail = '初始诊断已结束，正在结合原计划、当前要求和诊断记录整理正式路线。';
    }
    if (['ANALYZING_MATERIAL', 'GENERATING_CAPABILITIES', 'GENERATING_ROADMAP'].includes(stage) && attempt && (attempt.blocked || !['QUEUED', 'RUNNING'].includes(attempt.status))) {
      stage = 'BLOCKED';
      detail = attempt.blocked ? '执行遇到阻碍，请检查当前任务后明确重试。' : '上一项规划任务已结束，但未保存相应结果；请在原对话继续说明。';
      if (attempt.blocked && attempt.status === 'QUEUED') options.push({ action: 'RETRY_JOB', label: '检查并重试任务', job_id: attempt.id });
      options.push({ action: 'DISCUSS_REVISION', label: '回到原对话', conversation_id: flow.conversation_id });
    }
    if (stage === 'BLOCKED' && attempt && !['RUNNING', 'QUEUED'].includes(attempt.status)) options.unshift({ action: 'REWORK_JOB', label: '重新整理这一环节', job_id: attempt.id });
    if (['DEFERRED', 'STOPPED'].includes(stage) && one("SELECT 1 FROM planning_flow_jobs f JOIN jobs j ON j.id=f.job_id WHERE f.goal_id=? AND j.status='RUNNING'", goalId)) detail = '已停止后续自动推进；当前已经开始执行的任务可以完成并保存为待审阅结果。';
    if (['DEFERRED', 'STOPPED'].includes(stage)) options.push({ action: 'RESUME', label: '继续自动规划' });
    else if (!['ENDED', 'PAUSED', 'COMPLETE'].includes(stage)) options.push({ action: 'LATER', label: '稍后继续' }, { action: 'STOP', label: '停止自动规划' });
    const expected_revision = digest([flow.updated_at, flow.status, flow.revision_key, flow.attempt_key, stage, proposalId, set?.id, assessment?.id, diagnostic?.id, attempt?.id, attempt?.status, attempt?.blocked, blockers]);
    return { ...flow, expected_revision, stage, title: stage === 'ANALYZING_MATERIAL' ? '正在分析主材料' : labels[stage], detail, job_id: attempt?.id || null, assessment_id: assessment?.id || diagnostic?.id || null, assessment_conversation_id: assessment?.conversation_id || diagnostic?.conversation_id || null, proposal_id: proposalId, capability_set_id: set?.id || null, blockers, suggested_options: options };
  }
  function state(goalId) {
    return viewOf(facts(goalId));
  }
  function list() {
    return all('SELECT goal_id FROM planning_flows').map(f => state(f.goal_id));
  }
  function enqueue(f) {
    const module = f.stage === 'MATERIAL' ? 'material' : f.stage === 'CAPABILITIES' ? 'capabilities' : 'roadmap', messageId = randomUUID(), jobId = randomUUID();
    let content = module === 'material' ? '读取本目标已确认范围的正文版本 ' + f.material.content_id + '，通过 teacher_read_material 实际阅读后用 teacher_analyze_material 保存分析；不能依据标题推测正文。' : module === 'capabilities' ? '继续本对话已经讨论的学习计划。保留原计划的范围、节奏与约束；先用 teacher_propose_capabilities 保存具体能力要求供用户审阅。不得代用户确认，不要声称已有正式路线。' : '当前版本的初始诊断已正式结束。请沿用本对话已经讨论的学习计划，结合当前已确认的能力要求、实际诊断记录与主材料，使用 teacher_plan_learning 保存正式路线提案供用户审阅。提前结束诊断不表示掌握，不能补造回答。不得代用户确认。';
    if (f.revising && module !== 'material') content += '\n用户明确要求修改提案 ' + f.flow.revision_proposal_id + '，请生成新提案。修改意见：' + f.flow.revision_feedback;
    if (f.flow.attempt_key) content += '\n用户明确要求重新处理本环节。保留原始讨论及失败记录；补充意见：' + (f.flow.rework_feedback || '按照原讨论完成并保存本环节的实际结果。');
    run('INSERT INTO messages VALUES(?,?,?,?,?,?,?)', messageId, f.flow.conversation_id, 'user', content, now(), null, 'planning-flow');
    run('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)', jobId, messageId, f.flow.conversation_id, 'QUEUED', null, null, null, now());
    models.tag(jobId, module, f.material?.content_id);
    run('INSERT INTO planning_flow_jobs VALUES(?,?,?,?)', f.goal.id, f.stage, f.inputKey, jobId);
    run('INSERT INTO planning_flow_attempt_history(job_id,goal_id,stage,input_key,created_at) VALUES(?,?,?,?,?)', jobId, f.goal.id, f.stage, f.inputKey, now());
  }
  function retirePending(jobId, reason, { suspend = false } = {}) {
    const row = one('SELECT ex.blocked,h.claimed_at FROM job_execution ex LEFT JOIN planning_flow_attempt_history h ON h.job_id=ex.job_id WHERE ex.job_id=?', jobId);
    if (row?.blocked) return;
    run("UPDATE jobs SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE id=? AND status='QUEUED'", jobId);
    run('UPDATE planning_flow_attempt_history SET cancel_reason=? WHERE job_id=?', reason, jobId);
    if (!row?.claimed_at) {
      if (suspend) run('INSERT OR IGNORE INTO planning_flow_suspensions SELECT goal_id,job_id FROM planning_flow_jobs WHERE job_id=?', jobId); else run('DELETE FROM planning_flow_jobs WHERE job_id=?', jobId);
    }
  }
  function dependencies(f, toolName) {
    return digest([f.materialFingerprint, toolName === 'teacher_plan_learning' ? f.set?.id : null, toolName === 'teacher_plan_learning' ? f.diagnostic?.id : null]);
  }
  function obsoletePending(f) {
    let changed = false;
    for (const output of all("SELECT * FROM planning_flow_outputs WHERE goal_id=? AND tool_name IN ('teacher_propose_capabilities','teacher_plan_learning')", f.goal.id)) {
      const table = output.tool_name === 'teacher_propose_capabilities' ? 'capability_sets' : 'proposals';
      if (output.dependency_fingerprint !== dependencies(f, output.tool_name) && one('SELECT status FROM ' + table + ' WHERE id=?', output.artifact_id)?.status === 'PENDING') {
        run('UPDATE ' + table + " SET status='SUPERSEDED' WHERE id=? AND status='PENDING'", output.artifact_id);
        changed = true;
      }
    }
    return changed;
  }
  function reconcile(goalId) {
    return tx(() => {
      let processed = 0;
      for (const row of goalId ? [{ goal_id: goalId }] : all("SELECT goal_id FROM planning_flows WHERE status='ACTIVE'")) {
        let f = facts(row.goal_id);
        if (!f) continue;
        if (obsoletePending(f)) f = facts(row.goal_id);
        const view = viewOf(f), generating = ['ANALYZING_MATERIAL', 'GENERATING_CAPABILITIES', 'GENERATING_ROADMAP', 'BLOCKED'].includes(view.stage);
        if (f.flow.status === 'ACTIVE' && !['PAUSED', 'ENDED'].includes(view.stage)) for (const pending of all("SELECT j.id,f.stage,f.input_key FROM planning_flow_jobs f JOIN jobs j ON j.id=f.job_id WHERE f.goal_id=? AND j.status='QUEUED'", row.goal_id)) if (!generating || pending.stage !== f.stage || pending.input_key !== f.inputKey) retirePending(pending.id, 'SUPERSEDED_BEFORE_EXECUTION');
        if (['ANALYZING_MATERIAL', 'GENERATING_CAPABILITIES', 'GENERATING_ROADMAP'].includes(view.stage) && !f.attempt) enqueue(f);
        processed++;
      }
      return goalId ? state(goalId) : { processed };
    });
  }
  function safeReconcile(goalId) {
    if (db.isTransaction) return null;
    try {
      return reconcile(goalId);
    } catch {
      return null;
    }
  }
  function discussionSource(conversationId,sourceId=null) {
    const userMessage = `SELECT m.id FROM messages m JOIN jobs j ON j.message_id=m.id LEFT JOIN job_execution ex ON ex.job_id=j.id
      WHERE m.conversation_id=? AND m.role='user' AND m.host IS NULL AND COALESCE(ex.module,'chat') IN ('chat','discovery')
      AND NOT EXISTS(SELECT 1 FROM goal_chat_actions a WHERE a.job_id=j.id)`;
    const own=sourceId?one(userMessage+' AND m.id=?',conversationId,sourceId):one(userMessage+' ORDER BY m.rowid DESC LIMIT 1',conversationId);
    if(own)return {id:own.id,discovery:false};
    if(sourceId)return null;
    const linked=one('SELECT conversation_id FROM goal_discussions WHERE target_conversation_id=?',conversationId);
    const original=linked&&one(userMessage+' ORDER BY m.rowid DESC LIMIT 1',linked.conversation_id);
    return original?{id:original.id,discovery:true}:null;
  }
  function discussionSources(){
    return Object.fromEntries(all("SELECT id FROM conversations WHERE kind='PLANNING'").flatMap(({id})=>{
      const source=discussionSource(id);
      return source?[[id,source]]:[];
    }));
  }
  function start(a) {
    return receipt(a.request_id, 'planning-flow:start:' + a.goal_id, () => {
      const { goal, chat, flow } = target(a.goal_id, a.conversation_id);
      if (['PAUSED', 'COMPLETED', 'ABANDONED'].includes(goal.status)) fail('请先恢复可规划的目标');
      if (a.source_message_id && !one('SELECT id FROM messages WHERE id=? AND conversation_id=?', a.source_message_id, chat.id)) fail('原计划消息不属于当前规划对话');
      if (!flow) {
        const source=discussionSource(chat.id,a.source_message_id);
        if(!source)fail('请先在规划对话中提交目标讨论，再开始整理学习路线');
        const rejected = one("SELECT id FROM capability_sets WHERE goal_id=? AND status='REJECTED' ORDER BY rowid DESC LIMIT 1", goal.id)?.id || one("SELECT id FROM proposals WHERE goal_id=? AND status='REJECTED' ORDER BY rowid DESC LIMIT 1", goal.id)?.id || null;
        run('INSERT INTO planning_flows(goal_id,conversation_id,source_message_id,status,created_at,updated_at,baseline_rejected_id) VALUES(?,?,?,?,?,?,?)', goal.id, chat.id, source.id, 'ACTIVE', now(), now(), rejected);
      }
      return reconcile(goal.id);
    });
  }
  function requireRevision(a, view) {
    if (typeof a.expected_revision !== 'string' || a.expected_revision !== view?.expected_revision) fail('规划状态已改变，请重新查看后操作');
  }
  function startFromJob(a) {
    const job = leased(a.job_id, a.lease_token), chat = one('SELECT * FROM conversations WHERE id=?', job.conversation_id), execution = one('SELECT * FROM job_execution WHERE job_id=?', job.id);
    if (chat?.kind !== 'PLANNING' || !chat.goal_id || execution?.module !== 'chat' || execution.agent_role === 'master' || one('SELECT 1 FROM goal_chat_actions WHERE job_id=?', job.id) || one('SELECT 1 FROM assessments WHERE conversation_id=?', chat.id)) fail('自动规划工具仅可用于当前目标的普通规划对话');
    const bound = { ...a, goal_id: chat.goal_id, conversation_id: chat.id, source_message_id: job.message_id };
    const action = a.action || 'START';
    if (action === 'START') return start(bound);
    if (action === 'REVISE') return revise(bound);
    if (['LATER', 'STOP', 'RESUME'].includes(action)) return control(bound);
    fail('规划工具操作无效');
  }
  function control(a) {
    if (a.action === 'REWORK') return rework(a);
    if (!['LATER', 'STOP', 'RESUME'].includes(a.action)) fail('规划操作无效');
    return receipt(a.request_id, 'planning-flow:control:' + digest([a.goal_id, a.conversation_id, a.action, a.expected_revision]), () => {
      const { flow } = target(a.goal_id, a.conversation_id);
      if (!flow) fail('当前目标尚未开始自动规划');
      requireRevision(a, state(a.goal_id));
      const next = a.action === 'RESUME' ? 'ACTIVE' : a.action === 'LATER' ? 'DEFERRED' : 'STOPPED';
      run('UPDATE planning_flows SET status=?,updated_at=? WHERE goal_id=?', next, now(), a.goal_id);
      if (next === 'ACTIVE') {
        for (const row of all('SELECT job_id FROM planning_flow_suspensions WHERE goal_id=?', a.goal_id)) run("DELETE FROM planning_flow_jobs WHERE goal_id=? AND job_id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND status='CANCELLED')", a.goal_id, row.job_id, row.job_id);
        run('DELETE FROM planning_flow_suspensions WHERE goal_id=?', a.goal_id);
      }
      else for (const row of all("SELECT j.id FROM planning_flow_jobs f JOIN jobs j ON j.id=f.job_id JOIN job_execution ex ON ex.job_id=j.id WHERE f.goal_id=? AND j.status='QUEUED' AND ex.blocked=0", a.goal_id)) retirePending(row.id, 'USER_' + a.action, { suspend: true });
      return reconcile(a.goal_id);
    });
  }
  function beginDiagnostic(a) {
    return receipt(a.request_id, 'planning-flow:diagnostic:' + digest([a.goal_id, a.conversation_id, a.capability_set_id]), () => {
      const { flow, goal } = target(a.goal_id, a.conversation_id);
      if (!flow || flow.status !== 'ACTIVE') fail('请先继续自动规划');
      if (['PAUSED', 'COMPLETED', 'ABANDONED'].includes(goal.status)) fail('当前目标不能开始诊断');
      const f = facts(a.goal_id), view = state(a.goal_id);
      if (!a.capability_set_id || a.capability_set_id !== f.set?.id) fail('能力要求已改变，请重新查看后开始诊断');
      if (view.stage === 'DIAGNOSIS' && f.assessment) return { assessment_id: f.assessment.id, conversation_id: f.assessment.conversation_id, planning_flow: view };
      if (view.stage !== 'DIAGNOSIS' || f.diagnostic) fail('当前阶段不能开始初始诊断');
      const result = learning.begin({ goal_id: a.goal_id, kind: 'INITIAL_DIAGNOSTIC', mode: 'CLOSED_BOOK', scope: '根据当前已确认能力要求及原规划对话逐题诊断；只依据实际回答判断。', requirement_ids: f.requirements, resource_ids: goalResources.forGoal(a.goal_id).filter(r => r.role === 'PRIMARY').map(r => r.id), request_id: 'planning-diagnostic:' + f.set.id });
      return { ...result, planning_flow: state(a.goal_id) };
    });
  }
  function decide(a) {
    if (typeof a.accept !== 'boolean') fail('提案决定无效');
    return receipt(a.request_id, 'planning-flow:decide:' + digest([a.goal_id, a.conversation_id, a.proposal_id, a.accept]), () => {
      const { flow } = target(a.goal_id, a.conversation_id), view = state(a.goal_id);
      if (!flow || flow.status !== 'ACTIVE' || !['REVIEW_CAPABILITIES', 'REVIEW_ROADMAP'].includes(view.stage) || view.proposal_id !== a.proposal_id) fail('提案或规划状态已改变，请重新查看当前提案');
      const result = view.stage === 'REVIEW_CAPABILITIES' ? learning.confirmCapabilities({ id: a.proposal_id, accept: a.accept }) : learning.decide({ id: a.proposal_id, accept: a.accept });
      return { ...result, planning_flow: reconcile(a.goal_id) };
    });
  }
  function revise(a) {
    if (typeof a.feedback !== 'string' || !a.feedback.trim() || a.feedback.length > 5000) fail('请具体说明修改意见（最多 5000 字符）');
    return receipt(a.request_id, 'planning-flow:revise:' + digest([a.goal_id, a.conversation_id, a.proposal_id, a.feedback, a.expected_revision]), () => {
      const { flow, goal } = target(a.goal_id, a.conversation_id);
      if (!flow || flow.status !== 'ACTIVE' || ['PAUSED', 'COMPLETED', 'ABANDONED'].includes(goal.status)) fail('请先恢复当前自动规划');
      const view = state(a.goal_id);
      requireRevision(a, view);
      if (!['REVIEW_CAPABILITIES', 'REVIEW_ROADMAP', 'NEEDS_REVISION'].includes(view.stage) || view.proposal_id !== a.proposal_id) fail('提案已改变，请重新查看当前提案');
      const capability = one('SELECT * FROM capability_sets WHERE id=? AND goal_id=?', a.proposal_id, a.goal_id), proposal = capability || one('SELECT * FROM proposals WHERE id=? AND goal_id=?', a.proposal_id, a.goal_id);
      if (!proposal || !['PENDING', 'REJECTED'].includes(proposal.status)) fail('当前提案不可修改');
      run('UPDATE ' + (capability ? 'capability_sets' : 'proposals') + " SET status='REJECTED' WHERE id=?", proposal.id);
      run('UPDATE planning_flows SET revision_key=?,revision_proposal_id=?,revision_feedback=?,updated_at=? WHERE goal_id=?', a.request_id, proposal.id, a.feedback.trim(), now(), a.goal_id);
      return reconcile(a.goal_id);
    });
  }
  function rework(a) {
    if (a.feedback !== undefined && (typeof a.feedback !== 'string' || a.feedback.length > 5000)) fail('补充意见过长或无效');
    return receipt(a.request_id, 'planning-flow:rework:' + digest([a.goal_id, a.conversation_id, a.job_id, a.feedback, a.expected_revision]), () => {
      const { flow } = target(a.goal_id, a.conversation_id), view = state(a.goal_id);
      requireRevision(a, view);
      if (!flow || flow.status !== 'ACTIVE' || view.stage !== 'BLOCKED' || view.job_id !== a.job_id) fail('当前环节已改变，请重新查看规划任务');
      const job = one('SELECT * FROM jobs WHERE id=?', a.job_id);
      if (!job || ['RUNNING', 'QUEUED'].includes(job.status)) fail('仍在执行或等待的任务请使用明确重试入口');
      run('UPDATE planning_flows SET attempt_key=?,rework_feedback=?,updated_at=? WHERE goal_id=?', a.request_id, a.feedback?.trim() || '', now(), a.goal_id);
      return reconcile(a.goal_id);
    });
  }
  function context(goalId) {
    return state(goalId);
  }
  function canClaim(jobId) {
    const managed = one('SELECT * FROM planning_flow_jobs WHERE job_id=?', jobId);
    if (!managed) return true;
    const f = facts(managed.goal_id), view = viewOf(f);
    return f.flow.status === 'ACTIVE' && ['ANALYZING_MATERIAL', 'GENERATING_CAPABILITIES', 'GENERATING_ROADMAP'].includes(view.stage) && f.stage === managed.stage && f.inputKey === managed.input_key;
  }
  const writes = { teacher_propose_capabilities: 'CAPABILITIES', teacher_plan_learning: 'ROADMAP', teacher_analyze_material: 'MATERIAL' };
  function assertJobCurrent(jobId, toolName) {
    const managed = one('SELECT * FROM planning_flow_jobs WHERE job_id=?', jobId);
    if (!managed) return { managed: false };
    if (!writes[toolName]) return { managed: true };
    const f = facts(managed.goal_id), view = viewOf(f), job = one('SELECT * FROM jobs WHERE id=?', jobId), expectedStage = { CAPABILITIES: 'GENERATING_CAPABILITIES', ROADMAP: 'GENERATING_ROADMAP', MATERIAL: 'ANALYZING_MATERIAL' }[managed.stage];
    if (!f || ['PAUSED', 'COMPLETED', 'ABANDONED'].includes(f.goal.status) || writes[toolName] !== managed.stage || managed.stage !== f.stage || managed.input_key !== f.inputKey || (f.flow.status === 'ACTIVE' ? view.stage !== expectedStage : job?.status !== 'RUNNING')) fail('原规划输入或当前环节已改变，请重新查看当前任务后继续');
    return { managed: true, goal_id: managed.goal_id, stage: managed.stage };
  }
  function applyManagedWrite(jobId, toolName, args, write) {
    const managed = one('SELECT * FROM planning_flow_jobs WHERE job_id=?', jobId);
    if (!managed || !writes[toolName]) return write();
    return tx(() => {
      const { lease_token, ...semanticArgs } = args;
      const previous = one('SELECT * FROM planning_flow_outputs WHERE job_id=?', jobId), argumentHash = digest(semanticArgs);
      if (previous) {
        if (previous.tool_name === toolName && previous.request_id === args.request_id && previous.argument_hash === argumentHash) return JSON.parse(previous.result);
        fail('本规划任务已经保存过结果，请审阅当前提案或明确提出修改');
      }
      assertJobCurrent(jobId, toolName);
      if (args.goal_id && args.goal_id !== managed.goal_id) fail('规划写入不属于当前目标');
      if (!args.request_id || typeof args.request_id !== 'string') fail('规划写入需要稳定的操作 ID');
      const f = facts(managed.goal_id), result = write();
      if (result && typeof result.then === 'function') fail('规划写入必须在同一个事务内完成');
      const artifactId = result?.proposal_id || result?.id;
      if (!artifactId) fail('规划写入没有返回已保存的结果标识');
      run('INSERT INTO planning_flow_outputs VALUES(?,?,?,?,?,?,?,?,?)', jobId, managed.goal_id, toolName, args.request_id, argumentHash, JSON.stringify(result), artifactId, dependencies(f, toolName), now());
      reconcile(managed.goal_id);
      return result;
    });
  }
  function retry(a) {
    return receipt(a.request_id, 'planning-flow:retry:' + digest([a.goal_id, a.conversation_id, a.job_id, a.expected_revision]), () => {
      const { flow } = target(a.goal_id, a.conversation_id), view = state(a.goal_id);
      requireRevision(a, view);
      if (!flow || flow.status !== 'ACTIVE' || view.stage !== 'BLOCKED' || view.job_id !== a.job_id) fail('当前规划任务已改变，请重新查看');
      const task = one('SELECT ex.*,j.status FROM job_execution ex JOIN jobs j ON j.id=ex.job_id WHERE ex.job_id=?', a.job_id);
      if (!task || task.status !== 'QUEUED' || !task.blocked) fail('当前任务不能重试');
      const result = task.agent_role ? agents.retry({ job_id: a.job_id }) : models.reroute({ job_id: a.job_id, mode: task.mode, profile_id: task.profile_id });
      return { ...result, planning_flow: reconcile(a.goal_id) };
    });
  }
  return { state, list, discussionSource, discussionSources, start, startFromJob, control, revise, rework, retry, decide, beginDiagnostic, reconcile, safeReconcile, context, canClaim, assertJobCurrent, applyManagedWrite };
}
