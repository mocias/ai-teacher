const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const panels = new Map();

function panelState(assessmentId) {
  if (!panels.has(assessmentId)) {
    panels.set(assessmentId, {
      scope: 'CURRENT',
      query: '',
      results: [],
      tabs: [],
      activeTab: null,
      draftTitle: '',
      draft: '',
      pendingDraftOnly: false,
      saveAttempt: null,
    });
  }
  return panels.get(assessmentId);
}

function tabView(tab, selected) {
  return `<article class="open-book-tab" data-open-book-tab="${escapeHtml(tab.id)}" ${selected ? '' : 'hidden'}>
    <div class="row between"><div><strong>${escapeHtml(tab.title)}</strong><p class="help">${escapeHtml(tab.goal_title)} · ${escapeHtml(tab.location)}</p></div>
    <button type="button" class="small ghost" data-action="openbook-close-tab" data-tab="${escapeHtml(tab.id)}" aria-label="关闭此标签">关闭</button></div>
    <pre class="open-book-source" tabindex="0" aria-label="原文内容">${escapeHtml(tab.content)}</pre>
  </article>`;
}

export function openBookView(assessment) {
  if (!assessment || assessment.mode !== 'OPEN_BOOK') return '';
  const active = ['WAITING_HOST', 'WAITING_ANSWER'].includes(assessment.status);
  let panel = panels.get(assessment.id);
  if (!active) {
    if (!panel?.draft.trim() || !['COMPLETED', 'ENDED_EARLY'].includes(assessment.status)) {
      panels.delete(assessment.id);
      return '';
    }
    makePendingDraftOnly(panel);
    return pendingDraftView(assessment, panel);
  }
  panel = panelState(assessment.id);
  panel.pendingDraftOnly = false;
  return `<section class="panel open-book-panel" data-open-book-panel="${escapeHtml(assessment.id)}">
    <div class="panelhead"><div><h3>开卷参考</h3><p class="help">手动检索已保存的笔记和资料原文。面板只显示来源内容，不生成答题文本；搜索内容和浏览过程不会保存。</p></div>
      <span class="badge">${panel.tabs.length} / 5 个标签</span></div>
    <form class="open-book-search" data-open-book-search data-assessment="${escapeHtml(assessment.id)}">
      <label>检索范围 <select name="scope" data-open-book-scope>
        <option value="CURRENT" ${panel.scope === 'CURRENT' ? 'selected' : ''}>当前目标</option>
        <option value="ALL" ${panel.scope === 'ALL' ? 'selected' : ''}>全部可用目标</option>
      </select></label>
      <label class="open-book-query">搜索词 <input name="query" maxlength="200" value="${escapeHtml(panel.query)}" placeholder="输入概念、关键词或短语"></label>
      <button class="small" type="submit">搜索原文</button>
    </form>
    <div class="open-book-results" aria-live="polite">${panel.results.length ? `<h4>原文命中 · ${panel.results.length}</h4><ol>${panel.results.map((hit, index) => `<li>
      <strong>${escapeHtml(hit.title)}</strong><span class="muted"> · ${escapeHtml(hit.goal_title)} · ${escapeHtml(hit.location)}</span>
      <p class="preline">${escapeHtml(hit.excerpt)}</p><button type="button" class="small" data-action="openbook-open" data-index="${index}">查看原文</button>
    </li>`).join('')}</ol>` : '<p class="help">搜索结果只来自未归档笔记和带保存范围的关联资料正文。</p>'}</div>
    ${panel.tabs.length ? `<div class="open-book-tabs" role="tablist" aria-label="已打开的参考资料">${panel.tabs.map(tab => `<button type="button" role="tab" aria-selected="${tab.id === panel.activeTab}" data-action="openbook-select-tab" data-tab="${escapeHtml(tab.id)}">${escapeHtml(tab.title)}</button>`).join('')}</div>
      <div class="open-book-tab-body">${panel.tabs.map(tab => tabView(tab, tab.id === panel.activeTab)).join('')}</div>` : ''}
    ${draftFields(panel, false)}
  </section>`;
}

function draftFields(panel, readOnly) {
  return `<details class="open-book-draft" ${readOnly ? 'open' : ''}><summary>${readOnly ? '待处理的开卷草稿' : '临时草稿'}</summary>
    <p class="help">${readOnly
      ? '考察已结束。为保留你的输入，当前只可保存这份草稿为笔记或丢弃；搜索和资料阅读已关闭。'
      : '草稿只保留在当前页面内存中；可明确保存为本目标笔记，或丢弃。'}</p>
    <label>笔记标题 <input name="draft_title" data-open-book-title maxlength="200" value="${escapeHtml(panel.draftTitle)}" placeholder="给笔记起个标题" ${readOnly ? 'readonly' : ''}></label>
    <label>草稿正文 <textarea data-open-book-draft rows="5" maxlength="50000" ${readOnly ? 'readonly' : ''}>${escapeHtml(panel.draft)}</textarea></label>
    <div class="row"><button type="button" class="small" data-action="openbook-save-draft">保存为笔记</button><button type="button" class="small ghost" data-action="openbook-discard-draft">丢弃草稿</button></div>
  </details>`;
}

function pendingDraftView(assessment, panel) {
  return `<section class="panel open-book-panel open-book-pending" data-open-book-panel="${escapeHtml(assessment.id)}">
    <div class="panelhead"><div><h3>开卷草稿待处理</h3><p class="help">本次考察已结束。</p></div><span class="badge">只读</span></div>
    ${draftFields(panel, true)}
  </section>`;
}

function makePendingDraftOnly(panel) {
  panel.pendingDraftOnly = true;
  panel.query = '';
  panel.scope = 'CURRENT';
  panel.results = [];
  panel.tabs = [];
  panel.activeTab = null;
}

export function bindOpenBook(root, assessment) {
  const panel = root.querySelector(`[data-open-book-panel="${CSS.escape(assessment.id)}"]`);
  if (!panel) return;
  const saved = panelState(assessment.id);
  for (const source of panel.querySelectorAll('[data-open-book-tab]')) {
    const tab = saved.tabs.find(item => item.id === source.dataset.openBookTab);
    const body = source.querySelector('.open-book-source');
    if (!tab || !body) continue;
    body.scrollTop = tab.scrollTop || 0;
    body.addEventListener('scroll', () => { tab.scrollTop = body.scrollTop; }, {passive: true});
  }
}

export function updateOpenBookInput(event) {
  const form = event.target.closest('[data-open-book-search]');
  if (form) {
    const saved = panelState(form.dataset.assessment);
    if (event.target.name === 'query') saved.query = event.target.value;
    if (event.target.name === 'scope') saved.scope = event.target.value;
    return;
  }
  const panel = event.target.closest('[data-open-book-panel]');
  if (!panel) return;
  const saved = panelState(panel.dataset.openBookPanel);
  if (event.target.matches('[data-open-book-title]')) saved.draftTitle = event.target.value;
  if (event.target.matches('[data-open-book-draft]')) saved.draft = event.target.value;
}

export async function submitOpenBookSearch(event, {api}) {
  const form = event.target.closest('[data-open-book-search]');
  if (!form) return false;
  event.preventDefault();
  const saved = panelState(form.dataset.assessment);
  const query = new FormData(form).get('query')?.toString() || '';
  const scope = new FormData(form).get('scope')?.toString() || 'CURRENT';
  saved.query = query;
  saved.scope = scope;
  const response = await api('open-book/search', {assessment_id: form.dataset.assessment, query, scope});
  saved.results = response.results;
  return true;
}

export async function openBookAction(name, node, {state, api, toast}) {
  const panelId = node.closest('[data-open-book-panel]')?.dataset.openBookPanel;
  const currentAssessment = panelId ? state.learning?.assessments.find(item => item.id === panelId) : null;
  if (!currentAssessment || currentAssessment.mode !== 'OPEN_BOOK') {
    throw new Error('开卷考察已结束，参考面板不可用');
  }
  const saved = panelState(currentAssessment.id);
  const active = ['WAITING_HOST', 'WAITING_ANSWER'].includes(currentAssessment.status);
  const allowedPendingAction = saved.pendingDraftOnly && ['openbook-save-draft', 'openbook-discard-draft'].includes(name);
  if (!active && !allowedPendingAction) throw new Error('开卷考察已结束；只能处理已保留的临时草稿');
  if (name === 'openbook-open') {
    const hit = saved.results[Number(node.dataset.index)];
    if (!hit) return true;
    const existing = saved.tabs.find(tab => tab.type === hit.type && tab.id === hit.id);
    if (existing) {
      saved.activeTab = existing.id;
      return true;
    }
    if (saved.tabs.length >= 5) {
      toast('最多打开 5 个标签，请先关闭一个');
      return true;
    }
    const full = await api('open-book/read', {
      assessment_id: currentAssessment.id,
      scope: saved.scope,
      type: hit.type,
      id: hit.id,
    });
    const tab = {...full, id: `${full.type}:${full.id}`, scrollTop: 0};
    saved.tabs.push(tab);
    saved.activeTab = tab.id;
    return true;
  }
  if (name === 'openbook-select-tab') {
    saved.activeTab = node.dataset.tab;
    return true;
  }
  if (name === 'openbook-close-tab') {
    saved.tabs = saved.tabs.filter(tab => tab.id !== node.dataset.tab);
    if (saved.activeTab === node.dataset.tab) saved.activeTab = saved.tabs.at(-1)?.id || null;
    return true;
  }
  if (name === 'openbook-discard-draft') {
    saved.draftTitle = '';
    saved.draft = '';
    saved.saveAttempt = null;
    toast('临时草稿已丢弃');
    return true;
  }
  if (name === 'openbook-save-draft') {
    if (!saved.draft.trim()) throw new Error('草稿正文不能为空');
    return saveOpenBookDraft(currentAssessment.id, currentAssessment, {state, api, toast});
  }
  return false;
}

export function getOpenBookDraft(assessmentId) {
  const saved = panels.get(assessmentId);
  if (!saved?.draft.trim()) return null;
  return {title: saved.draftTitle, content: saved.draft, pending: saved.pendingDraftOnly};
}

export function discardOpenBookDraft(assessmentId, toast = () => {}) {
  const saved = panels.get(assessmentId);
  if (!saved) return;
  saved.draftTitle = '';
  saved.draft = '';
  saved.saveAttempt = null;
  toast('临时草稿已丢弃');
}

export async function saveOpenBookDraft(assessmentId, assessment, {state, api, toast}) {
  const saved = panelState(assessmentId);
  if (!saved.draft.trim()) throw new Error('草稿正文不能为空');
  const title = saved.draftTitle.trim() || '开卷考察笔记';
  const content = saved.draft;
  if (saved.saveAttempt?.title !== title || saved.saveAttempt?.content !== content) {
    saved.saveAttempt = {title, content, id: crypto.randomUUID()};
  }
  const savedNote = await api('open-book/save-draft', {
    request_id: saved.saveAttempt.id,
    assessment_id: assessment.id,
    title,
    content,
    pending_draft: saved.pendingDraftOnly,
  });
  if (saved.draft === content && (saved.draftTitle.trim() || '开卷考察笔记') === title) {
    saved.draftTitle = '';
    saved.draft = '';
    saved.saveAttempt = null;
  }
  const goal = state.goals.find(item => item.id === assessment.goal_id);
  toast(`已保存到目标“${goal?.title || ''}”的笔记，并关联本次开卷考察`);
  return {note_id: savedNote.note_id};
}

export function clearOpenBook(assessmentId) {
  panels.delete(assessmentId);
}

export function openBookNoteSource(state, noteId) {
  const source = state.open_book_note_sources?.find(item => item.note_id === noteId);
  if (!source) return '';
  const assessment = state.learning?.assessments.find(item => item.id === source.assessment_id);
  return `<p class="help">来自开卷考察${assessment ? ` · ${escapeHtml(assessment.scope)}` : ''}</p>${assessment
    ? `<button type="button" class="small ghost" data-chat="${escapeHtml(assessment.conversation_id)}">查看关联考察</button>`
    : ''}`;
}

export function syncOpenBookAssessments(assessments = []) {
  const byId = new Map(assessments.map(item => [item.id, item]));
  for (const assessmentId of panels.keys()) {
    const assessment = byId.get(assessmentId);
    const panel = panels.get(assessmentId);
    if (assessment?.mode === 'OPEN_BOOK' && ['WAITING_HOST', 'WAITING_ANSWER','PAUSED'].includes(assessment.status)) {
      panel.pendingDraftOnly = false;
    } else if (assessment?.mode === 'OPEN_BOOK'
        && ['COMPLETED', 'ENDED_EARLY'].includes(assessment.status)
        && panel.draft.trim()) {
      makePendingDraftOnly(panel);
    } else {
      panels.delete(assessmentId);
    }
  }
}
