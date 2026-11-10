import {createHash,randomUUID} from 'node:crypto';

const fail = (message, status = 409) => {
  throw Object.assign(new Error(message), {status});
};

const cleanScope = value => String(value || '').trim();
const hasSavedLocation = scope => cleanScope(scope).length > 0;
const locationLabel = scope => /^(全文|全篇|全文资料|全部|正文|整体|full|all)$/i.test(cleanScope(scope))
  ? '全文/正文版本'
  : cleanScope(scope);

function snippet(text, query, radius = 140) {
  const position = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (position < 0) return '';
  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + query.length + radius);
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** Read-only source search for a live OPEN_BOOK assessment. Search terms are never stored. */
export function openBookService(db,receipt) {
  db.exec(`CREATE TABLE IF NOT EXISTS open_book_note_sources (
    note_id TEXT PRIMARY KEY REFERENCES notes(id),
    assessment_id TEXT NOT NULL REFERENCES assessments(id),
    goal_id TEXT NOT NULL REFERENCES goals(id),
    created_at TEXT NOT NULL
  )`);
  const one = (query, ...params) => db.prepare(query).get(...params);
  const all = (query, ...params) => db.prepare(query).all(...params);

  function liveAssessment(assessmentId) {
    const assessment = one('SELECT * FROM assessments WHERE id = ?', assessmentId);
    if (!assessment || assessment.mode !== 'OPEN_BOOK' || !['WAITING_HOST', 'WAITING_ANSWER'].includes(assessment.status)) {
      fail('仅进行中的开卷考察可使用参考面板');
    }
    const goal = one('SELECT status FROM goals WHERE id = ?', assessment.goal_id);
    if (!goal || ['PAUSED', 'ABANDONED'].includes(goal.status)) fail('目标暂停或终止时不可使用参考面板');
    if (goal.status === 'COMPLETED' && !['REVIEW', 'REVIEW_DIAGNOSTIC'].includes(assessment.kind)) {
      fail('已完成目标只可在长期复习考察中使用参考面板');
    }
    return assessment;
  }

  function availableGoalSql(scope, assessment) {
    if (scope === 'CURRENT') return {sql: 'goal_id = ?', params: [assessment.goal_id]};
    if (scope !== 'ALL') fail('检索范围无效');
    return {
      sql: `goal_id IS NOT NULL
        AND goal_id IN (
          SELECT g.id FROM goals AS g
          LEFT JOIN learning_settings AS ls ON ls.goal_id = g.id
          WHERE COALESCE(ls.archived, 0) = 0
        )`,
      params: [],
    };
  }

  function availableMaterialSql(scope,assessment){
    const goalRef='COALESCE(gr.goal_id,r.goal_id)';
    if(scope==='CURRENT')return {sql:goalRef+'=?',params:[assessment.goal_id]};
    if(scope!=='ALL')fail('检索范围无效');
    return {sql:`${goalRef} IS NOT NULL AND ${goalRef} IN (
      SELECT g.id FROM goals AS g LEFT JOIN learning_settings AS ls ON ls.goal_id=g.id
      WHERE COALESCE(ls.archived,0)=0
    )`,params:[]};
  }

  function search(input) {
    const assessment = liveAssessment(input.assessment_id);
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query || query.length > 200) fail('请输入 1–200 个字符的检索内容', 400);
    const scope = input.scope || 'CURRENT';
    const target = availableGoalSql(scope, assessment);
    const notes = all(`
      SELECT n.id, n.goal_id, n.title, n.content, n.updated_at, g.title AS goal_title
      FROM notes AS n
      JOIN goals AS g ON g.id = n.goal_id
      WHERE n.archived = 0 AND ${target.sql}
        AND instr(lower(n.title || char(10) || n.content), lower(?)) > 0
      ORDER BY n.updated_at DESC, n.rowid DESC
      LIMIT 40
    `, ...target.params, query).map(note => ({
      id: note.id,
      type: 'note',
      title: note.title,
      goal_id: note.goal_id,
      goal_title: note.goal_title,
      location: '笔记',
      excerpt: snippet(note.content, query),
      updated_at: note.updated_at,
    }));

    const materialTarget=availableMaterialSql(scope,assessment);
    const materials = all(`
      SELECT mc.id,mc.resource_id,COALESCE(gr.goal_id,r.goal_id) AS goal_id,r.title,COALESCE(gr.scope,mc.scope) AS scope,mc.content,mc.created_at,g.title AS goal_title
      FROM material_contents AS mc
      JOIN resources AS r ON r.id=mc.resource_id
      LEFT JOIN goal_resources AS gr ON gr.resource_id=r.id AND gr.content_id=mc.id AND gr.scope=mc.scope
      JOIN goals AS g ON g.id=COALESCE(gr.goal_id,r.goal_id)
      WHERE (gr.goal_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM goal_resources any_link WHERE any_link.resource_id=r.id))
        AND (gr.goal_id IS NULL OR gr.scope_status='CONFIRMED') AND ${materialTarget.sql} AND instr(lower(mc.content), lower(?)) > 0
      ORDER BY mc.created_at DESC,mc.id
      LIMIT 80
    `, ...materialTarget.params, query).filter(row => hasSavedLocation(row.scope)).map(material => ({
      id: material.id,
      resource_id: material.resource_id,
      type: 'material',
      title: material.title,
      goal_id: material.goal_id,
      goal_title: material.goal_title,
      location: locationLabel(material.scope),
      excerpt: snippet(material.content, query),
      updated_at: material.created_at,
    }));

    return {
      assessment_id: assessment.id,
      scope,
      results: [...notes, ...materials]
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .slice(0, 40),
    };
  }

  function read(input) {
    const assessment = liveAssessment(input.assessment_id);
    const scope = input.scope || 'CURRENT';
    const target = availableGoalSql(scope, assessment);
    if (input.type === 'note') {
      const note = one(`
        SELECT n.id, n.goal_id, n.title, n.content, n.updated_at, g.title AS goal_title
        FROM notes AS n JOIN goals AS g ON g.id = n.goal_id
        WHERE n.id = ? AND n.archived = 0 AND ${target.sql}
      `, input.id, ...target.params);
      if (!note) fail('笔记不可用或已归档', 404);
      return {...note, type: 'note', location: '笔记'};
    }
    if (input.type === 'material') {
      const materialTarget=availableMaterialSql(scope,assessment);
      const material = one(`
        SELECT mc.id,mc.resource_id,COALESCE(gr.goal_id,r.goal_id) AS goal_id,r.title,COALESCE(gr.scope,mc.scope) AS scope,mc.content,
          mc.created_at AS updated_at,g.title AS goal_title
        FROM material_contents AS mc
        JOIN resources AS r ON r.id=mc.resource_id
        LEFT JOIN goal_resources AS gr ON gr.resource_id=r.id AND gr.content_id=mc.id AND gr.scope=mc.scope
        JOIN goals AS g ON g.id=COALESCE(gr.goal_id,r.goal_id)
        WHERE mc.id=? AND (gr.goal_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM goal_resources any_link WHERE any_link.resource_id=r.id))
          AND (gr.goal_id IS NULL OR gr.scope_status='CONFIRMED') AND ${materialTarget.sql}
      `, input.id, ...materialTarget.params);
      if (!material || !hasSavedLocation(material.scope)) fail('资料正文缺少范围信息或不可用', 404);
      return {...material, type: 'material', location: locationLabel(material.scope)};
    }
    fail('参考来源类型无效', 400);
  }

  function draftAssessment(input) {
    const assessment = one('SELECT * FROM assessments WHERE id = ?', input.assessment_id);
    if (!assessment || assessment.mode !== 'OPEN_BOOK') fail('笔记只能关联开卷考察');
    if (['WAITING_HOST', 'WAITING_ANSWER'].includes(assessment.status)) return liveAssessment(assessment.id);
    if (assessment.status==='PAUSED'||(input.pending_draft === true && ['COMPLETED', 'ENDED_EARLY'].includes(assessment.status))) return assessment;
    fail('开卷考察已结束；仅可保存结束前留下的临时草稿');
  }

  function saveDraft(input) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (!title || title.length > 200) fail('笔记标题不能为空且不能超过 200 个字符', 400);
    if (!content || content.length > 50000) fail('笔记正文不能为空且不能超过 50000 个字符', 400);
    const digest=createHash('sha256').update(JSON.stringify([title,content])).digest('hex');
    return receipt(input.request_id??randomUUID(), 'open-book-note:'+input.assessment_id+':'+digest, () => {
      const assessment=draftAssessment(input);
      const noteId=randomUUID(), timestamp=new Date().toISOString();
      db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?)').run(
        noteId, assessment.goal_id, title, content, 0, timestamp, timestamp,
      );
      db.prepare('INSERT INTO open_book_note_sources VALUES(?,?,?,?)').run(
        noteId, assessment.id, assessment.goal_id, timestamp,
      );
      return {note_id: noteId, assessment_id: assessment.id, goal_id: assessment.goal_id};
    });
  }

  return {search, read, saveDraft};
}
