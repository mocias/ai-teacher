// A requirement belongs to one goal. The knowledge node is the shared identity.
export function priorLearning(db, goalId, {requirementIds = null, sourceLimit = 3, limit = -1} = {}) {
  const rows = db.prepare(`
    WITH matches AS (
      SELECT target.id AS requirement_id, target.description, node.name AS node_name,
             source.id AS source_requirement_id, source.description AS source_requirement,
             g.title AS source_goal, e.id AS evidence_id, e.created_at, link.relation,
             a.id AS assessment_id, a.kind, a.mode,
             count(*) OVER (PARTITION BY target.id, link.relation) AS total,
             row_number() OVER (
               PARTITION BY target.id, link.relation ORDER BY e.created_at DESC, e.rowid DESC, source.id
             ) AS position
      FROM requirements target
      JOIN capability_sets cs ON cs.id = target.set_id AND cs.status = 'ACCEPTED'
      JOIN knowledge_nodes node ON node.id = target.node_id
      JOIN requirements source ON source.node_id = target.node_id AND source.goal_id <> target.goal_id
      JOIN evidence_requirements link ON link.requirement_id = source.id
      JOIN evidence e ON e.id = link.evidence_id AND e.goal_id = source.goal_id
      JOIN goals g ON g.id = e.goal_id
      JOIN assessments a ON a.conversation_id = e.conversation_id AND a.status = 'COMPLETED'
      WHERE target.goal_id = ? AND (? IS NULL OR target.id IN (SELECT value FROM json_each(?)))
    ), samples AS (
      SELECT * FROM matches WHERE position <= ?
      ORDER BY position, requirement_id, relation LIMIT ?
    )
    SELECT s.*, r.answer_message_id, substr(question.content, 1, 280) AS question,
           substr(answer.content, 1, 400) AS answer, substr(r.feedback, 1, 280) AS feedback
    FROM samples s
    JOIN assessment_rounds r ON r.id = (
      SELECT ar.id FROM assessment_rounds ar
      WHERE ar.assessment_id = s.assessment_id AND ar.answer_message_id IS NOT NULL
        AND s.source_requirement_id IN (SELECT value FROM json_each(ar.requirement_ids))
      ORDER BY ar.rowid DESC LIMIT 1
    )
    JOIN messages question ON question.id = r.question_message_id
    JOIN messages answer ON answer.id = r.answer_message_id AND answer.role = 'user'
    ORDER BY s.requirement_id, s.created_at DESC, s.evidence_id, s.source_requirement_id
  `).all(goalId, requirementIds && JSON.stringify(requirementIds), JSON.stringify(requirementIds), sourceLimit, limit);
  return rows;
}

export function previouslyAssessedNodes(db, goalId) {
  return db.prepare(`
    SELECT node.name FROM goals current
    JOIN knowledge_nodes node ON node.domain = current.domain
    JOIN requirements source ON source.node_id = node.id AND source.goal_id <> current.id
    JOIN evidence_requirements link ON link.requirement_id = source.id
    JOIN evidence e ON e.id = link.evidence_id AND e.goal_id = source.goal_id
    WHERE current.id = ? GROUP BY node.id ORDER BY max(e.rowid) DESC, node.name LIMIT 40
  `).all(goalId).map(row => row.name);
}

export const priorLearningGuide = 'prior_learning 是其他目标对同一知识点的历史作答节选。逐项比较新旧要求、日期、开闭卷、回答和提示，不把同名当成同等能力。初诊可减少重复提问，优先验证要求提高、证据较旧或表现矛盾的部分。路线可在主题的 prior_learning 中引用依据：BUILD_ON 表示省去重复讲练，VERIFY_FIRST 表示先安排针对性短测。所有当前要求仍需覆盖，历史引用不计为本目标考察结果。';

export function validatePriorLearning(db, goalId, topics) {
  const annotated = topics.filter(t => t.prior_learning?.length);
  if (!annotated.length) return;
  const invalid = message => { throw Object.assign(new Error(message), {status: 409}); };
  const lookup = db.prepare(`
    SELECT link.relation FROM requirements target
    JOIN capability_sets cs ON cs.id = target.set_id AND cs.status = 'ACCEPTED'
    JOIN requirements source ON source.node_id = target.node_id AND source.goal_id <> target.goal_id
    JOIN evidence_requirements link ON link.requirement_id = source.id
    JOIN evidence e ON e.id = link.evidence_id AND e.goal_id = source.goal_id
    JOIN assessments a ON a.conversation_id = e.conversation_id AND a.status = 'COMPLETED'
    WHERE target.goal_id = ? AND target.id = ? AND source.id = ? AND e.id = ?
  `);
  const conflict = db.prepare(`
    SELECT EXISTS (
      SELECT 1 FROM requirements previous
      JOIN evidence_requirements link ON link.requirement_id = previous.id
      JOIN evidence e ON e.id = link.evidence_id AND e.goal_id = previous.goal_id
      WHERE previous.node_id = target.node_id AND link.relation = 'CONTRADICTS'
        AND e.rowid >= coalesce((
          SELECT max(local.rowid) FROM evidence local
          JOIN evidence_requirements ok ON ok.evidence_id = local.id
          WHERE ok.requirement_id = target.id AND ok.relation = 'SUPPORTS'
        ), 0)
    ) AS unresolved
    FROM requirements target WHERE target.id = ?
  `);
  for (const topic of annotated) {
    const seen = new Set();
    for (const basis of topic.prior_learning) {
      if (!topic.requirement_ids.includes(basis.requirement_id) || seen.has(basis.requirement_id))
        invalid('历史依据必须对应本主题的不重复能力要求');
      seen.add(basis.requirement_id);
      if (!['BUILD_ON', 'VERIFY_FIRST'].includes(basis.action) || !basis.reason?.trim() || basis.reason.length > 1200)
        invalid('请说明如何使用历史作答及其原因');
      const ref = lookup.get(goalId, basis.requirement_id, basis.source_requirement_id, basis.evidence_id);
      if (!ref) invalid('引用必须来自其他目标对同一知识点的已完成考察');
      if (basis.action === 'BUILD_ON') {
        if (ref.relation !== 'SUPPORTS') invalid('省去重复学习需要对应要求的支持性作答证据');
        if (conflict.get(basis.requirement_id).unresolved) invalid('同一知识点出现相反表现，请先短测；本目标的新作答可用于重新规划');
      }
    }
  }
}
