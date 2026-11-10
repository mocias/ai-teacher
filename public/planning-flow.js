const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pending = new Set(), requests = new Map();
const button = (action, label, id = '', primary = false) => `<button type="button" class="${primary ? 'primary' : 'small ghost'}" data-action="planning-${action}" data-id="${esc(id)}">${esc(label)}</button>`;
export const planningFlow = (state, goalId) => (state.planning_flow || []).find(flow => flow.goal_id === goalId);
export function planningFlowReminder(state) {
  const reminders = [];
  for (const flow of state.planning_flow || []) {
    const goal = state.goals.find(g => g.id === flow.goal_id), anchor = state.conversations.find(c => c.id === flow.conversation_id && c.goal_id === flow.goal_id && c.kind === 'PLANNING');
    if (flow.status !== 'ACTIVE' || !goal || ['PAUSED', 'COMPLETED', 'ABANDONED'].includes(goal.status) || !anchor) continue;
    let label = '', conversation = anchor.id;
    if (flow.stage === 'REVIEW_CAPABILITIES' && state.learning?.capability_sets?.some(p => p.id === flow.proposal_id && p.goal_id === goal.id && p.status === 'PENDING')) label = '确认能力要求';
    if (flow.stage === 'REVIEW_ROADMAP' && state.proposals?.some(p => p.id === flow.proposal_id && p.goal_id === goal.id && p.status === 'PENDING')) label = '确认学习路线';
    if (flow.stage === 'DIAGNOSIS') {
      if (!flow.assessment_id && (flow.suggested_options || []).some(option => option.action === 'START_DIAGNOSIS')) label = '选择是否开始初始诊断';
      else {
        const assessment = state.learning?.assessments?.find(a => a.id === flow.assessment_id && a.goal_id === goal.id && a.conversation_id === flow.assessment_conversation_id);
        if (assessment?.status === 'WAITING_ANSWER' && state.conversations.some(c => c.id === assessment.conversation_id && c.goal_id === goal.id)) {
          label = '继续回答初始诊断';
          conversation = assessment.conversation_id;
        }
      }
    }
    if (label) reminders.push(`<button type="button" data-chat="${esc(conversation)}" class="planning-reminder-link" aria-label="${esc(goal.title)}：${esc(label)}"><strong>${esc(goal.title)}</strong><span>${esc(label)} →</span></button>`);
  }
  return reminders.length ? `<section class="planning-reminders" aria-label="学习计划待办"><h2>学习计划 · 等你继续</h2>${reminders.join('')}</section>` : '';
}
export function planningFlowCard(state, goalId, conversationId) {
  const flow = planningFlow(state, goalId), conversation = state.conversations.find(c => c.id === conversationId), goal = state.goals.find(g => g.id === goalId);
  if (!conversation || !goal || ['COMPLETED', 'ABANDONED'].includes(goal.status)) return '';
  const diagnostic = flow?.assessment_conversation_id === conversationId;
  if (conversation.kind !== 'PLANNING' && !diagnostic) return '';
  if (flow && flow.conversation_id !== conversationId && !diagnostic) return '';
  if (!flow) {
    if (state.proposals?.some(p => p.goal_id === goalId && p.status === 'ACCEPTED')) return '';
    const source=state.planning_sources?.[conversationId];
    if(!source)return '';
    return `<section class="planning-flow planning-invite" data-planning-flow data-goal="${esc(goalId)}" data-conversation="${esc(conversationId)}"><details><summary>把这段讨论整理成学习路线</summary><p>${source.discovery?'将使用创建此目标时的首页讨论。':''}Teacher 会先整理能力要求，确认后通过初始诊断制定路线。</p><div class="row">${button('start', '从这段讨论开始', '', true)}${button('chat', '先继续聊聊')}</div></details></section>`;
  }
  let content = '', actions = '';
  const options = flow.suggested_options || [];
  if (diagnostic) {
    actions = button('return', '回到规划讨论', flow.conversation_id);
  } else if (flow.status === 'DEFERRED' || flow.status === 'STOPPED') {
    actions = button('resume', flow.status === 'DEFERRED' ? '继续整理计划' : '重新继续规划', '', true);
  } else {
    const cap = state.learning?.capability_sets?.find(p => p.id === (flow.proposal_id || flow.capability_set_id) && p.status === 'PENDING');
    const proposal = state.proposals?.find(p => p.id === flow.proposal_id && p.status === 'PENDING');
    if (flow.stage === 'REVIEW_CAPABILITIES' && cap) {
      content = `<details class="planning-preview" open><summary>查看待确认的能力要求</summary>${(cap.content || []).map(item => `<h4>${esc(item.title)}</h4><ul>${(item.requirements || []).map(r => `<li>${esc(r.node)}：${esc(r.description)}</li>`).join('')}</ul>`).join('')}</details>`;
      actions = button('accept-cap', '确认这些能力要求', cap.id, true) + button('revision', '我想调整', cap.id) + button('reject-cap', '暂不采用', cap.id);
    } else if (flow.stage === 'REVIEW_ROADMAP' && proposal) {
      content = `<details class="planning-preview" open><summary>${esc(proposal.title)}</summary><p class="preline">${esc(proposal.summary)}</p><ol>${(proposal.items || []).map(item => `<li><strong>${esc(item.title)}</strong><p>${esc(item.objective)}</p>${item.phase ? `<small>${esc(item.phase)} / ${esc(item.topic)}</small>` : ''}</li>`).join('')}</ol></details>`;
      actions = button('accept-roadmap', '确认并采用这份路线', proposal.id, true) + button('revision', '我想调整', proposal.id) + button('reject-roadmap', '暂不采用', proposal.id);
    }
    for (const option of options) {
      if (option.action === 'START_DIAGNOSIS') actions += button('begin-diagnosis', '开始初始诊断', flow.capability_set_id, true);
      if (option.action === 'CONTINUE_DIAGNOSIS' && (option.conversation_id || flow.assessment_conversation_id)) actions += button('diagnosis', '开始 / 继续初始诊断', option.conversation_id || flow.assessment_conversation_id, true);
      if (option.action === 'OPEN_MATERIALS') actions += button('materials', option.label || '查看目标资料');
      if (option.action === 'DISCUSS_REVISION') actions += button('revision', option.label || '继续讨论调整', option.proposal_id || flow.proposal_id || '');
      if (option.action === 'REWORK_JOB' && option.job_id) actions += button('rework', option.label || '重新整理这一环节', option.job_id, true);
      if (option.action === 'RETRY_JOB' && option.job_id) actions += button('retry', option.label || '按当前配置重试', option.job_id, true);
    }
    if (flow.stage === 'COMPLETE') actions += button('route', '查看路线与学习任务');
    else actions += button('later', '先继续聊聊，稍后整理') + button('stop', '停止这次整理');
  }
  return `<section class="planning-flow" data-planning-flow data-goal="${esc(goalId)}" data-conversation="${esc(flow.conversation_id)}" data-stage="${esc(flow.stage)}" data-proposal="${esc(flow.proposal_id)}" data-revision="${esc(flow.expected_revision)}" aria-label="学习计划进度" ${pending.has(goalId) ? 'aria-busy="true"' : ''}><strong>${esc(flow.title || '学习计划')}</strong><p class="planning-detail">${esc(flow.detail)}</p>${content}<div class="row planning-actions">${actions}</div>${pending.has(goalId) ? '<small role="status">正在保存选择…</small>' : ''}</section>`;
}

export async function planningFlowAction(name, node, env) {
  const { api, refresh, openChat, openView, revise, toast } = env, card = node.closest('[data-planning-flow]');
  if (!card) return;
  const goalId = card.dataset.goal, conversationId = card.dataset.conversation;
  if (pending.has(goalId)) return;
  if (name === 'chat') {
    card.querySelector('details')?.removeAttribute('open');
    return;
  }
  if (name === 'revision') {
    revise();
    return;
  }
  if (['diagnosis', 'return'].includes(name)) {
    await openChat(node.dataset.id);
    return;
  }
  if (name === 'route' || name === 'materials') {
    await openView(name === 'route' ? 'plan' : 'resources');
    return;
  }
  pending.add(goalId);
  card.querySelectorAll('button').forEach(b => {
    b.disabled = true;
  });
  const expected_revision = card.dataset.revision;
  const requestKey = JSON.stringify([goalId, conversationId, name, node.dataset.id, expected_revision]);
  if (!requests.has(requestKey)) requests.set(requestKey, crypto.randomUUID());
  try {
    const request_id = requests.get(requestKey);
    if (name === 'begin-diagnosis') {
      const result = await api('planning-flow/diagnostic', { goal_id: goalId, conversation_id: conversationId, capability_set_id: node.dataset.id, request_id });
      requests.delete(requestKey);
      await refresh();
      await openChat(result.conversation_id, { from: conversationId });
      return;
    }
    else if (name === 'retry') await api('planning-flow/retry', { goal_id: goalId, conversation_id: conversationId, job_id: node.dataset.id, expected_revision, request_id });
    else if (name === 'rework') await api('planning-flow/rework', { goal_id: goalId, conversation_id: conversationId, job_id: node.dataset.id, expected_revision, request_id });
    else if (name === 'start') await api('planning-flow/start', { goal_id: goalId, conversation_id: conversationId, request_id });
    else if (['later', 'stop', 'resume'].includes(name)) await api('planning-flow/control', { goal_id: goalId, conversation_id: conversationId, action: { later: 'LATER', stop: 'STOP', resume: 'RESUME' }[name], expected_revision, request_id });
    else if (['accept-cap', 'reject-cap', 'accept-roadmap', 'reject-roadmap'].includes(name)) await api('planning-flow/decide', { goal_id: goalId, conversation_id: conversationId, proposal_id: node.dataset.id, accept: name === 'accept-cap' || name === 'accept-roadmap', request_id });
    else return;
    requests.delete(requestKey);
    await refresh();
    if (name === 'reject-cap' || name === 'reject-roadmap') toast('已保留为未采用方案，可继续讨论调整');
  } catch (error) {
    await refresh().catch(() => { });
    throw error;
  }
  finally {
    pending.delete(goalId);
    card.querySelectorAll('button').forEach(b => {
      b.disabled = false;
    });
    await refresh().catch(() => { });
  }
}
