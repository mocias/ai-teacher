const now = () => new Date().toISOString();

function fail(message, status = 409) {
  throw Object.assign(new Error(message), {status});
}

/** Build an explainable queue from active work without changing source session IDs. */
export function buildRollingQueue({
  goals = [],
  sessions = [],
  details = [],
  proposals = [],
  settings = {},
  deferred = [],
  removed = [],
  excludedTopics = [],
  blockers = () => [],
  limit = settings.global_limit ?? 3,
} = {}) {
  const deferredIds = new Set(deferred.map(item => typeof item === 'string' ? item : item.session_id));
  const removedIds = new Set(removed.map(item => typeof item === 'string' ? item : item.session_id));
  const excludedTopicIds = new Set(excludedTopics.map(item => `${item.proposal_id}\0${item.topic_key}`));
  const detailBySession = new Map(details.map(detail => [detail.session_id, detail]));
  const goalById = new Map(goals.map(goal => [goal.id, goal]));
  const proposalById = new Map(proposals.map(proposal => [proposal.id, proposal]));
  const activeGoals = goals.filter(goal => goal.status === 'ACTIVE');
  const goalRank = new Map(activeGoals.map((goal, index) => [goal.id, index]));
  const availableSessions = sessions.filter(session => session.status !== 'REMOVED_FROM_PLAN');
  const topicSessions = new Map();

  for (const session of availableSessions) {
    const proposal = proposalById.get(session.proposal_id);
    const item = proposal?.items?.[session.position];
    const detail = detailBySession.get(session.id);
    const topicKey = item?.key || detail?.topic || session.id;
    const groupKey = `${session.proposal_id || 'legacy'}\0${topicKey}`;
    if (!topicSessions.has(groupKey)) topicSessions.set(groupKey, []);
    topicSessions.get(groupKey).push(session);
  }

  const completedTopics = new Set();
  for (const [topicKey, topic] of topicSessions) {
    if (topic.every(session => session.status === 'COMPLETED')) completedTopics.add(topicKey);
  }

  const candidates = [];
  const excluded = [];
  for (const session of availableSessions) {
    const goal = goalById.get(session.goal_id);
    const proposal = proposalById.get(session.proposal_id);
    const item = proposal?.items?.[session.position];
    const detail = detailBySession.get(session.id);
    const topicKey = item?.key || detail?.topic || session.id;
    const groupKey = `${session.proposal_id || 'legacy'}\0${topicKey}`;
    let reason = null;

    if (!goal || goal.status !== 'ACTIVE') {
      reason = goal?.status === 'PAUSED'
        ? '目标已暂停'
        : ['COMPLETED', 'ABANDONED'].includes(goal?.status)
          ? '目标已结束'
          : '目标不可用';
    } else if (session.status !== 'PLANNED') {
      reason = session.status === 'ASSESSING' ? '考察进行中' : `任务状态为${session.status}`;
    } else if (goal.current_set_id && proposal?.set_id !== goal.current_set_id) {
      reason = '能力要求已更新，请先确认新版路线';
    } else if (deferredIds.has(session.id)) {
      reason = '你已延后此任务';
    } else if (removedIds.has(session.id)) {
      reason = '你已移除此单个任务';
    } else if (excludedTopicIds.has(groupKey)) {
      reason = '你已排除此主题';
    } else {
      const dependencies = item?.dependencies || detail?.dependencies || [];
      const missing = dependencies.filter(dependency => !completedTopics.has(`${session.proposal_id}\0${dependency}`));
      if (missing.length) {
        reason = `等待先修主题：${missing.join('、')}`;
      } else {
        const requirementIds = detail?.requirements || item?.requirement_ids || [];
        const materialBlockers = blockers(session.goal_id, requirementIds);
        if (materialBlockers.length) {
          reason = `重要资料冲突待裁决：${materialBlockers.map(blocker => blocker.description || blocker.id).join('、')}`;
        }
      }
    }

    const row = {
      session,
      goal: goal || null,
      topic: item?.topic || detail?.topic || '',
      phase: item?.phase || detail?.phase || '',
      reason,
    };
    if (reason) excluded.push(row);
    else candidates.push(row);
  }

  const explicitOrder = settings.goal_order || [];
  candidates.sort((left, right) => {
    const leftExplicit = explicitOrder.indexOf(left.session.goal_id);
    const rightExplicit = explicitOrder.indexOf(right.session.goal_id);
    const explicitDifference = (leftExplicit < 0 ? 9999 : leftExplicit) - (rightExplicit < 0 ? 9999 : rightExplicit);
    if (explicitDifference) return explicitDifference;
    const goalDifference = (goalRank.get(left.session.goal_id) ?? 9999) - (goalRank.get(right.session.goal_id) ?? 9999);
    if (goalDifference) return goalDifference;
    const proposalDifference = String(left.session.proposal_id || '').localeCompare(String(right.session.proposal_id || ''));
    if (proposalDifference) return proposalDifference;
    const positionDifference = (left.session.position ?? 0) - (right.session.position ?? 0);
    return positionDifference || String(left.session.id).localeCompare(String(right.session.id));
  });

  const defaultLimit = Math.max(0, Math.min(50, Number.isInteger(limit) ? limit : 3));
  const activeDomains = [...new Set(activeGoals.map(goal => goal.domain))];
  const domainLimits = new Map(activeDomains.map(domain => [domain, settings.domain_limits?.[domain] ?? defaultLimit]));
  const queueLimit = Math.max(defaultLimit, ...domainLimits.values(), 0);
  const queue = [];
  const overflow = [];
  const domainCounts = new Map();

  for (const item of candidates) {
    const domain = item.goal.domain;
    const domainLimit = domainLimits.get(domain) ?? defaultLimit;
    const count = domainCounts.get(domain) || 0;
    if (queue.length < queueLimit && count < domainLimit) {
      queue.push(item);
      domainCounts.set(domain, count + 1);
    } else {
      overflow.push(item);
    }
  }

  return {limit: queueLimit, queue, overflow, excluded, available_count: candidates.length};
}

export function rollingPlanService(db, materialMap) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rolling_plan_config (
      scope TEXT PRIMARY KEY,
      global_limit INTEGER NOT NULL DEFAULT 3,
      domain_limits TEXT NOT NULL DEFAULT '{}',
      goal_order TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rolling_plan_deferred (
      session_id TEXT PRIMARY KEY,
      deferred_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS rolling_plan_removed (
      session_id TEXT PRIMARY KEY,
      removed_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS rolling_plan_excluded_topics (
      proposal_id TEXT NOT NULL,
      topic_key TEXT NOT NULL,
      excluded_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (proposal_id, topic_key)
    );
    INSERT OR IGNORE INTO rolling_plan_config (scope, global_limit, domain_limits, goal_order, revision, updated_at)
      VALUES ('global', 3, '{}', '[]', 1, '${now()}');
  `);

  const one = (query, ...params) => db.prepare(query).get(...params);
  const all = (query, ...params) => db.prepare(query).all(...params);
  const run = (query, ...params) => db.prepare(query).run(...params);

  function configuration() {
    const row = one("SELECT * FROM rolling_plan_config WHERE scope = 'global'");
    return {
      ...row,
      domain_limits: JSON.parse(row.domain_limits),
      goal_order: JSON.parse(row.goal_order),
    };
  }

  function queueInputs() {
    return {
      goals: all(`SELECT g.*, cs.id AS current_set_id FROM goals g LEFT JOIN capability_sets cs
        ON cs.goal_id=g.id AND cs.status='ACCEPTED' ORDER BY g.created_at DESC,g.rowid DESC`),
      sessions: all("SELECT * FROM sessions WHERE status <> 'REMOVED_FROM_PLAN' ORDER BY rowid"),
      details: all('SELECT * FROM session_details').map(detail => ({
        ...detail,
        requirements: JSON.parse(detail.requirements),
        dependencies: JSON.parse(detail.dependencies),
      })),
      proposals: all("SELECT p.*,d.set_id FROM proposals p LEFT JOIN roadmap_details d ON d.proposal_id=p.id WHERE p.status='ACCEPTED'").map(proposal => ({
        ...proposal,
        items: JSON.parse(proposal.items),
      })),
      deferred: all('SELECT * FROM rolling_plan_deferred'),
      removed: all('SELECT * FROM rolling_plan_removed'),
      excludedTopics: all('SELECT * FROM rolling_plan_excluded_topics'),
    };
  }

  function calculate(inputs, settings) {
    const conflictsByGoal = new Map();
    return buildRollingQueue({
      ...inputs,
      settings,
      blockers(goalId, requirementIds) {
        if (!requirementIds.length) return [];
        if (!conflictsByGoal.has(goalId)) conflictsByGoal.set(goalId, materialMap.openConflicts(goalId));
        return conflictsByGoal.get(goalId).filter(c => c.requirement_ids.some(id => requirementIds.includes(id)));
      },
    });
  }

  function state(goalId) {
    const config = configuration();
    const inputs = queueInputs();
    const result = calculate(inputs, config);
    if (goalId) {
      result.queue = result.queue.filter(item => item.session.goal_id === goalId);
      result.overflow = result.overflow.filter(item => item.session.goal_id === goalId);
      result.excluded = result.excluded.filter(item => item.session.goal_id === goalId);
    }
    return {
      ...result,
      config,
      deferred: inputs.deferred,
      removed: inputs.removed,
      excluded_topics: inputs.excludedTopics,
    };
  }

  function configure(input) {
    const current = configuration();
    if (input.revision !== current.revision) fail('队列设置已被其他操作更新，请刷新后重试');
    const globalLimit = input.global_limit ?? current.global_limit;
    if (!Number.isInteger(globalLimit) || globalLimit < 0 || globalLimit > 50) {
      fail('近期队列数量须为 0–50 的整数');
    }

    const domainLimits = input.domain_limits ?? current.domain_limits;
    const goalOrder = input.goal_order ?? current.goal_order;
    const invalidDomains = !domainLimits || typeof domainLimits !== 'object' || Array.isArray(domainLimits)
      || Object.values(domainLimits).some(value => !Number.isInteger(value) || value < 0 || value > 50);
    const invalidOrder = !Array.isArray(goalOrder) || new Set(goalOrder).size !== goalOrder.length
      || goalOrder.some(id => !one('SELECT id FROM goals WHERE id = ?', id));
    if (invalidDomains || invalidOrder) fail('队列覆盖或目标优先顺序无效');

    const result = run(`
      UPDATE rolling_plan_config
      SET global_limit = ?, domain_limits = ?, goal_order = ?, revision = revision + 1, updated_at = ?
      WHERE scope = 'global' AND revision = ?
    `, globalLimit, JSON.stringify(domainLimits), JSON.stringify(goalOrder), now(), input.revision);
    if (!result.changes) fail('队列设置已被其他操作更新，请刷新后重试');
    return configuration();
  }

  function defer(input) {
    const session = one('SELECT * FROM sessions WHERE id = ?', input.session_id);
    if (!session) fail('学习任务不存在', 404);
    const goal = one('SELECT status FROM goals WHERE id = ?', session.goal_id);
    if (goal?.status !== 'ACTIVE') fail('仅进行中目标的任务可延后');
    if (session.status !== 'PLANNED') fail('仅待学习任务可延后');
    run(`
      INSERT INTO rolling_plan_deferred (session_id, deferred_at, reason) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET deferred_at = excluded.deferred_at, reason = excluded.reason
    `, session.id, now(), String(input.reason || '').slice(0, 500));
    return state(session.goal_id);
  }

  function removeSession(input) {
    const session = one('SELECT * FROM sessions WHERE id = ?', input.session_id);
    if (!session) fail('学习任务不存在', 404);
    const goal = one('SELECT status FROM goals WHERE id = ?', session.goal_id);
    if (goal?.status !== 'ACTIVE' || session.status !== 'PLANNED') {
      fail('仅进行中目标的待学习任务可移除');
    }
    run(`
      INSERT INTO rolling_plan_removed (session_id, removed_at, reason) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET removed_at = excluded.removed_at, reason = excluded.reason
    `, session.id, now(), String(input.reason || '').slice(0, 500));
    return state(session.goal_id);
  }

  function restore(input) {
    const deferred = one('SELECT session_id FROM rolling_plan_deferred WHERE session_id = ?', input.session_id);
    const removed = one('SELECT session_id FROM rolling_plan_removed WHERE session_id = ?', input.session_id);
    if (!deferred && !removed) fail('此任务没有被延后或移除');
    run('DELETE FROM rolling_plan_deferred WHERE session_id = ?', input.session_id);
    run('DELETE FROM rolling_plan_removed WHERE session_id = ?', input.session_id);
    const session = one('SELECT goal_id FROM sessions WHERE id = ?', input.session_id);
    return state(session?.goal_id);
  }

  function currentCapabilitySet(goalId) {
    return one(`
      SELECT id FROM capability_sets
      WHERE goal_id = ? AND status = 'ACCEPTED'
      ORDER BY rowid DESC LIMIT 1
    `, goalId);
  }

  function latestRoute(goalId, setId) {
    return one(`
      SELECT proposal.id, proposal.items
      FROM roadmap_details AS route
      JOIN proposals AS proposal ON proposal.id = route.proposal_id
      WHERE proposal.goal_id = ? AND proposal.status = 'ACCEPTED' AND route.set_id = ?
      ORDER BY proposal.created_at DESC, proposal.rowid DESC
      LIMIT 1
    `, goalId, setId);
  }

  function excludeTopic(input) {
    const proposal = one("SELECT * FROM proposals WHERE id = ? AND status = 'ACCEPTED'", input.proposal_id);
    if (!proposal) fail('主题路线不存在');
    const currentSet = currentCapabilitySet(proposal.goal_id);
    const currentRoute = currentSet && latestRoute(proposal.goal_id, currentSet.id);
    if (!currentRoute || currentRoute.id !== proposal.id) fail('只能排除当前能力版本的最新路线主题');
    const item = JSON.parse(proposal.items).find(candidate => candidate.key === input.topic_key);
    if (!item) fail('主题不属于当前路线');
    const coreRequirements = new Set(all(`
      SELECT requirement.id
      FROM requirements AS requirement
      JOIN readiness_items AS readiness ON readiness.id = requirement.readiness_id
      WHERE requirement.set_id = ? AND readiness.kind = 'CORE'
    `, currentSet.id).map(row => row.id));
    run(`
      INSERT INTO rolling_plan_excluded_topics (proposal_id, topic_key, excluded_at, reason)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(proposal_id, topic_key) DO UPDATE
      SET excluded_at = excluded.excluded_at, reason = excluded.reason
    `, proposal.id, input.topic_key, now(), String(input.reason || '').slice(0, 500));
    return {
      ok: true,
      blocks_completion: (item.requirement_ids || []).some(id => coreRequirements.has(id)),
    };
  }

  function restoreTopic(input) {
    const result = run(
      'DELETE FROM rolling_plan_excluded_topics WHERE proposal_id = ? AND topic_key = ?',
      input.proposal_id,
      input.topic_key,
    );
    if (!result.changes) fail('主题没有被排除');
    return {ok: true};
  }

  function isScheduleEligible(sessionId) {
    const session = one('SELECT * FROM sessions WHERE id = ?', sessionId);
    if (!session || session.status !== 'PLANNED') return false;
    const set=currentCapabilitySet(session.goal_id);
    if(set && !one('SELECT 1 FROM roadmap_details WHERE proposal_id=? AND set_id=?',session.proposal_id,set.id))return false;
    if (one('SELECT 1 FROM rolling_plan_deferred WHERE session_id = ?', sessionId)) return false;
    if (one('SELECT 1 FROM rolling_plan_removed WHERE session_id = ?', sessionId)) return false;
    const proposal = one("SELECT * FROM proposals WHERE id = ? AND status = 'ACCEPTED'", session.proposal_id);
    const item = proposal ? JSON.parse(proposal.items)[session.position] : null;
    return !(item?.key && one(`
      SELECT 1 FROM rolling_plan_excluded_topics WHERE proposal_id = ? AND topic_key = ?
    `, session.proposal_id, item.key));
  }

  function assertNoCoreTopicExclusion(goalId) {
    if (!one('SELECT id FROM goals WHERE id = ?', goalId)) fail('目标不存在');
    const currentSet = currentCapabilitySet(goalId);
    if (!currentSet) return;
    const currentRoute = latestRoute(goalId, currentSet.id);
    if (!currentRoute) return;
    const coreRequirements = new Set(all(`
      SELECT requirement.id
      FROM requirements AS requirement
      JOIN readiness_items AS readiness ON readiness.id = requirement.readiness_id
      WHERE requirement.set_id = ? AND readiness.kind = 'CORE'
    `, currentSet.id).map(row => row.id));
    const exclusions = all(`
      SELECT excluded.topic_key, proposal.items
      FROM rolling_plan_excluded_topics AS excluded
      JOIN proposals AS proposal ON proposal.id = excluded.proposal_id
      WHERE proposal.goal_id = ? AND proposal.status = 'ACCEPTED' AND proposal.id = ?
    `, goalId, currentRoute.id);
    for (const exclusion of exclusions) {
      const item = JSON.parse(exclusion.items).find(candidate => candidate.key === exclusion.topic_key);
      if ((item?.requirement_ids || []).some(id => coreRequirements.has(id))) {
        fail('必要核心主题仍被排除，请恢复后再完成目标');
      }
    }
  }

  function assertExecutable(sessionId) {
    const session = one('SELECT * FROM sessions WHERE id = ?', sessionId);
    if (!session) fail('学习任务不存在', 404);
    if (session.status !== 'PLANNED') return true;
    const inputs = queueInputs();
    const result = calculate(inputs, {goal_order: [], global_limit: 50});
    const exclusion = result.excluded.find(item => item.session.id === sessionId);
    if (exclusion) fail(exclusion.reason);
    const candidate = result.queue.some(item => item.session.id === sessionId)
      || result.overflow.some(item => item.session.id === sessionId);
    if (!candidate) fail('当前任务不在可执行路线中');
    return true;
  }

  return {
    state,
    configuration,
    configure,
    defer,
    removeSession,
    excludeTopic,
    restoreTopic,
    restore,
    isScheduleEligible,
    assertExecutable,
    assertNoCoreTopicExclusion,
  };
}
