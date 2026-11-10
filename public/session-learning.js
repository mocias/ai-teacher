const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function conversationLabel(conversation) {
  if (conversation.kind === 'SESSION_LEARNING') return '任务学习';
  if (conversation.kind.startsWith('ASSESSMENT')) return '正式考察';
  return '目标与规划';
}

export function sessionLearningBanner(state, conversationId) {
  const chat = state.session_chats?.find(row => row.conversation_id === conversationId);
  const task = state.sessions.find(row => row.id === chat?.session_id);
  if (!task) return '';
  const detail = state.learning?.session_details.find(row => row.session_id === task.id);
  const planning = chat.planning_conversation_id || state.planning_flow?.find(row => row.goal_id === task.goal_id)?.conversation_id
    || state.conversations.find(row => row.goal_id === task.goal_id && row.kind === 'PLANNING')?.id;
  return `<section class="session-learning-context" aria-label="当前学习任务" data-learning-session="${esc(task.id)}">
    <div class="row between"><strong>任务学习 · ${esc(task.title)}</strong><div class="row">
      ${planning ? `<button type="button" class="small ghost" data-chat="${esc(planning)}">返回目标与规划</button>` : ''}
      <button type="button" class="small ghost" data-action="session-route" data-id="${esc(task.goal_id)}">查看学习路线</button>
    </div></div>
    <p>${esc(task.objective)}</p>
    <small>围绕这项已确认任务提问、讨论和练习。正式评估通过任务的评估入口进行。</small>
    ${detail?.resources?.length ? `<details><summary>本任务资料 · ${detail.resources.length}</summary><div class="row">${detail.resources.map(id => `<button type="button" class="small" data-action="reader-open" data-id="${esc(id)}">${esc(state.resources.find(row => row.id === id)?.title || '打开资料')}</button>`).join('')}</div></details>` : ''}
    ${chat.read_only ? `<p role="status" class="notice">${esc(chat.unavailable_reason)}，可查看既有学习记录。</p>` : ''}
  </section>`;
}

export function planningScopeBanner(state, conversationId) {
  const conversation = state.conversations.find(row => row.id === conversationId);
  if (conversation?.kind !== 'PLANNING') return '';
  const goal = state.goals.find(row => row.id === conversation.goal_id);
  const hasTasks = state.sessions.some(row => row.goal_id === goal?.id && row.status !== 'REMOVED_FROM_PLAN'
    && state.proposals.some(proposal => proposal.id === row.proposal_id && proposal.status === 'ACCEPTED'));
  return `<div class="planning-scope"><span><strong>目标与规划</strong> · 在这里讨论目标、范围和路线。${hasTasks ? '学习与答疑请进入具体任务。' : '确认学习路线后，即可进入具体任务学习。'}</span>
    ${hasTasks ? `<button type="button" class="small ghost" data-action="session-route" data-id="${esc(goal.id)}">查看路线与学习任务</button>` : ''}
  </div>`;
}
