const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const relations = {SUPPORTS:'曾展示该能力', CONTRADICTS:'曾出现相反表现', INCONCLUSIVE:'当时证据不足'};
const plans = {BUILD_ON:'省去重复学习', VERIFY_FIRST:'先做针对性短测'};

export function priorLearningView(rows, canVerify) {
  if (!rows.length) return '<p>还没有与当前已确认要求匹配的旧作答。完成领域和知识点相同的其他目标考察后，可在这里回看。</p>';
  const groups = Map.groupBy(rows, r => r.requirement_id);
  const sections = [];
  for (const [id, records] of groups) {
    const first = records[0];
    const counts = new Map(records.map(r => [r.relation, r.total]));
    const summary = [...counts].map(([key, count]) => relations[key] + ' ' + count + ' 条').join(' · ');
    const cards = records.map(r => `<details class="goalcard"><summary>${esc(r.created_at.slice(0,10))} · ${esc(r.source_goal)} · ${r.mode === 'CLOSED_BOOK' ? '闭卷' : '开卷'} · ${esc(relations[r.relation])}</summary>
      <p>当时的要求 · ${esc(r.source_requirement)}</p><p class="preline"><strong>原题节选</strong>　${esc(r.question)}</p>
      <p class="preline"><strong>你的回答</strong>　${esc(r.answer)}</p><p class="preline"><strong>当时的反馈</strong>　${esc(r.feedback)}</p>
      <button type="button" class="small" data-action="v2-results" data-id="${esc(r.assessment_id)}">查看原考察全部问答</button></details>`).join('');
    sections.push(`<section><h3>${esc(first.node_name)} · ${esc(first.description)}</h3><p class="help">${esc(summary)}</p>${cards}
      ${canVerify ? `<button type="button" class="small" data-action="v2-prior-check" data-id="${esc(id)}">在当前目标短测这项要求</button>` : ''}</section>`);
  }
  return '<p class="help">每项要求按证据关系各列最近三条。打开旧记录可比较当时的题目、回答和条件；短测会在当前目标留下新的作答记录。</p>' + sections.join('');
}

export function planHistoryView(state, proposalId) {
  const phases = state.learning?.roadmap_details?.find(d => d.proposal_id === proposalId)?.structure ?? [];
  const choices = [];
  for (const phase of phases) for (const topic of phase.topics) for (const basis of topic.prior_learning ?? []) {
    const source = state.evidence.find(e => e.id === basis.evidence_id);
    const assessment = source && state.learning.assessments.find(a => a.conversation_id === source.conversation_id);
    const requirement = state.learning.requirements.find(r => r.id === basis.requirement_id);
    choices.push(`<article><strong>${esc(topic.title)} · ${esc(plans[basis.action])}</strong>
      <p class="help">${esc(requirement?.description)}</p><p class="preline">${esc(basis.reason)}</p>
      ${assessment ? `<button type="button" class="small" data-action="v2-results" data-id="${esc(assessment.id)}">查看依据的原考察</button>` : ''}</article>`);
  }
  return choices.length ? '<section class="panel"><h3>这份路线如何使用旧作答</h3>' + choices.join('') + '</section>' : '';
}
