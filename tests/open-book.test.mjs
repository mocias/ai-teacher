import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {openBookView, openBookAction, submitOpenBookSearch, updateOpenBookInput, bindOpenBook, openBookNoteSource, syncOpenBookAssessments} from '../public/open-book.js';

function addGoal(db, id, title, status = 'ACTIVE') {
  db.prepare('INSERT INTO goals VALUES(?,?,?,?,?,?)').run(id, title, 'Research', '', status, '2026-01-01');
}

function addAssessment(db, {id, goal, mode = 'OPEN_BOOK', status = 'WAITING_ANSWER'}) {
  const conversation = `chat-${id}`;
  db.prepare('INSERT INTO conversations VALUES(?,?,?,?,?)').run(conversation, goal, 'Exam', 'ASSESSMENT_V2', '2026-01-01');
  db.prepare('INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, conversation, goal, null, 'LEARN', mode, status, 'Check a topic', '[]', '[]', null, null, null, '2026-01-01', null);
  return {id, conversation_id: conversation, goal_id: goal, mode, status};
}

function addMaterial(db, {id, goal, title, scope, content, saved = 0}) {
  const resource = `resource-${id}`;
  db.prepare('INSERT INTO resources VALUES(?,?,?,?,?,?,?)').run(resource, goal, title, 'https://example.test', 'SUPPLEMENTARY', saved, '2026-01-01');
  db.prepare('INSERT INTO material_contents VALUES(?,?,?,?,?,?)').run(id, resource, scope, content, 'hash-' + id, '2026-01-01');
  if (goal) db.prepare('INSERT INTO goal_resources(goal_id,resource_id,role,scope,scope_status,content_id,supplement_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(goal, resource, 'SUPPLEMENTARY', scope, 'CONFIRMED', id, 'NONE', '2026-01-01', '2026-01-01');
  return resource;
}

test('search exposes only unarchived notes and scoped material snapshots, with full original text on read', t => {
  const store = createStore(':memory:');
  t.after(() => store.db.close());
  const db = store.db;
  addGoal(db, 'g1', 'Current goal');
  addGoal(db, 'g2', 'Other goal', 'PAUSED');
  addGoal(db, 'g3', 'Initializing goal', 'INITIALIZING');
  addAssessment(db, {id: 'open', goal: 'g1'});
  addAssessment(db, {id: 'initial', goal: 'g3'});
  db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?)').run('n1', 'g1', 'Current note', 'needle in the exact note body', 0, '2026-01-01', '2026-01-02');
  db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?)').run('archived', 'g1', 'Archived note', 'needle hidden', 1, '2026-01-01', '2026-01-02');
  db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?)').run('n2', 'g2', 'Other note', 'needle from another goal', 0, '2026-01-01', '2026-01-02');
  addMaterial(db, {id: 'm1', goal: 'g1', title: 'Chapter source', scope: '第 2 章 · 2.1 节', content: 'original text with needle and surrounding context', saved: 1});
  addMaterial(db, {id: 'whole', goal: 'g1', title: 'Full text', scope: '全文', content: 'needle in a generic full-text snapshot'});
  addMaterial(db, {id: 'favorite', goal: null, title: 'Saved favorite', scope: '第 1 章', content: 'needle in an unattached favorite'});

  const current = store.openBook.search({assessment_id: 'open', query: 'needle', scope: 'CURRENT'});
  assert.deepEqual(current.results.map(result => result.id).sort(), ['m1', 'n1', 'whole']);
  assert.equal(current.results.find(result => result.id === 'whole').location, '全文/正文版本');
  const all = store.openBook.search({assessment_id: 'open', query: 'needle', scope: 'ALL'});
  assert.deepEqual(all.results.map(result => result.id).sort(), ['m1', 'n1', 'n2', 'whole']);
  assert.equal(store.openBook.read({assessment_id: 'open', type: 'note', id: 'n1'}).content, 'needle in the exact note body');
  assert.equal(store.openBook.read({assessment_id: 'open', type: 'material', id: 'm1'}).content, 'original text with needle and surrounding context');
  assert.equal(store.openBook.read({assessment_id: 'open', type: 'material', id: 'whole'}).location, '全文/正文版本');
  assert.ok(store.openBook.search({assessment_id: 'initial', query: 'needle', scope: 'ALL'}).results.length > 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='open_book_note_sources'").get().count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name LIKE '%query%'").get().count, 0);
});

test('shared resource reads only the exact body version bound to each goal scope', t => {
  const store = createStore(':memory:');
  t.after(() => store.db.close());
  const db = store.db;
  addGoal(db, 'goal-a', 'Goal A');
  addGoal(db, 'goal-b', 'Goal B');
  addAssessment(db, {id: 'open-a', goal: 'goal-a'});
  addAssessment(db, {id: 'open-b', goal: 'goal-b'});
  db.prepare('INSERT INTO resources VALUES(?,?,?,?,?,?,?)').run('shared', 'goal-a', 'Shared source', 'https://example.test/shared', 'PRIMARY', 1, '2026-01-01');
  db.prepare('INSERT INTO material_contents VALUES(?,?,?,?,?,?)').run('body-a', 'shared', '第1章', 'alpha-only-text', 'hash-a', '2026-01-01');
  db.prepare('INSERT INTO material_contents VALUES(?,?,?,?,?,?)').run('body-b', 'shared', '第2章', 'beta-only-text', 'hash-b', '2026-01-02');
  const link = db.prepare('INSERT INTO goal_resources(goal_id,resource_id,role,scope,scope_status,content_id,supplement_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  link.run('goal-a', 'shared', 'PRIMARY', '第1章', 'CONFIRMED', 'body-a', 'NONE', '2026-01-01', '2026-01-01');
  link.run('goal-b', 'shared', 'REFERENCE', '第2章', 'CONFIRMED', 'body-b', 'NONE', '2026-01-02', '2026-01-02');

  assert.equal(store.learning.readMaterial({goal_id: 'goal-a', content_id: 'body-a'}).content, 'alpha-only-text');
  assert.equal(store.learning.readMaterial({goal_id: 'goal-b', content_id: 'body-b'}).scope, '第2章');
  assert.equal(store.learning.readMaterial({goal_id: 'goal-b', content_id: 'body-b'}).content, 'beta-only-text');
  assert.throws(() => store.learning.readMaterial({goal_id: 'goal-b', content_id: 'body-a'}), /没有在当前目标下明确绑定/);

  assert.deepEqual(store.openBook.search({assessment_id: 'open-b', query: 'alpha-only-text', scope: 'CURRENT'}).results, []);
  const bSearch = store.openBook.search({assessment_id: 'open-b', query: 'beta-only-text', scope: 'CURRENT'});
  assert.deepEqual(bSearch.results.map(result => result.id), ['body-b']);
  assert.equal(bSearch.results[0].location, '第2章');
  assert.equal(store.openBook.read({assessment_id: 'open-b', type: 'material', id: 'body-b'}).content, 'beta-only-text');
  assert.throws(() => store.openBook.read({assessment_id: 'open-b', type: 'material', id: 'body-a'}), /不可用/);
});

test('closed book, unrelated, paused-goal, and ended assessments cannot use source APIs', t => {
  const store = createStore(':memory:');
  t.after(() => store.db.close());
  const db = store.db;
  addGoal(db, 'g1', 'Current goal');
  addGoal(db, 'g2', 'Paused goal', 'PAUSED');
  addAssessment(db, {id: 'closed', goal: 'g1', mode: 'CLOSED_BOOK'});
  addAssessment(db, {id: 'ended', goal: 'g1', status: 'COMPLETED'});
  addAssessment(db, {id: 'paused', goal: 'g2'});
  addGoal(db, 'g3', 'Completed goal', 'COMPLETED');
  addAssessment(db, {id: 'review', goal: 'g3', mode: 'OPEN_BOOK', status: 'WAITING_ANSWER'});
  db.prepare('UPDATE assessments SET kind=? WHERE id=?').run('REVIEW', 'review');
  for (const id of ['closed', 'ended', 'paused', 'missing']) {
    assert.throws(() => store.openBook.search({assessment_id: id, query: 'needle'}), /开卷考察|目标暂停/);
    assert.throws(() => store.openBook.read({assessment_id: id, type: 'note', id: 'x'}), /开卷考察|目标暂停/);
  }
  assert.throws(() => store.openBook.search({assessment_id: 'missing', query: 'needle'}), /开卷考察/);
  assert.deepEqual(store.openBook.search({assessment_id: 'review', query: 'needle'}).results, []);
  assert.equal(store.openBook.saveDraft({assessment_id: 'review', title: 'Long-term review', content: 'Saved scratch'}).goal_id, 'g3');
  assert.equal(db.prepare('SELECT assessment_id FROM open_book_note_sources').get().assessment_id, 'review');
  const note = db.prepare('SELECT * FROM notes WHERE title=?').get('Long-term review');
  assert.match(openBookNoteSource(store.overview(), note.id), /查看关联考察/);
  addAssessment(db, {id: 'ended-open', goal: 'g1', status: 'ENDED_EARLY'});
  assert.throws(() => store.openBook.search({assessment_id: 'ended-open', query: 'needle'}), /开卷考察/);
  const pendingInput = {assessment_id: 'ended-open', pending_draft: true, request_id: 'pending-save', title: 'Pending save', content: 'Save after Teacher ends'};
  const saved = store.openBook.saveDraft(pendingInput);
  assert.deepEqual(store.openBook.saveDraft(pendingInput), saved);
  assert.throws(() => store.openBook.saveDraft({...pendingInput, content: 'Changed after first save'}), /request_id/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM open_book_note_sources WHERE assessment_id=?').get('ended-open').count, 1);
});

test('HTTP routes require the browser session and the UI panel appears only during an active open-book assessment', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-open-book-'));
  const app = startServer({port: 0, dataDir});
  await once(app.server, 'listening');
  t.after(async () => { await app.close(); rmSync(dataDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const cookie = (await fetch(base)).headers.get('set-cookie').split(';')[0];
  const moduleResponse = await fetch(`${base}/open-book.js`);
  assert.equal(moduleResponse.status, 200);
  assert.match(await moduleResponse.text(), /开卷参考/);
  addGoal(app.store.db, 'g', 'Open book goal');
  addAssessment(app.store.db, {id: 'open', goal: 'g'});
  addAssessment(app.store.db, {id: 'closed', goal: 'g', mode: 'CLOSED_BOOK'});
  const request = (path, body, withCookie = true) => fetch(`${base}/api/${path}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...(withCookie ? {Cookie: cookie} : {})},
    body: JSON.stringify(body),
  });

  assert.equal((await request('open-book/search', {assessment_id: 'open', query: 'x'}, false)).status, 401);
  const success = await request('open-book/search', {assessment_id: 'open', query: 'x'});
  assert.equal(success.status, 200);
  const forbidden = await request('open-book/search', {assessment_id: 'closed', query: 'x'});
  assert.equal(forbidden.status, 409);
  const savedDraft = await request('open-book/save-draft', {assessment_id: 'open', title: 'My scratch', content: 'My note'});
  assert.equal(savedDraft.status, 200);
  const relation = app.store.db.prepare('SELECT assessment_id FROM open_book_note_sources').get();
  assert.equal(relation.assessment_id, 'open');
  assert.match(openBookView({id: 'open', mode: 'OPEN_BOOK', status: 'WAITING_ANSWER'}), /搜索原文/);
  assert.equal(openBookView({id: 'closed', mode: 'CLOSED_BOOK', status: 'WAITING_ANSWER'}), '');
  assert.equal(openBookView({id: 'done', mode: 'OPEN_BOOK', status: 'COMPLETED'}), '');
});

test('temporary panel keeps its query, five tabs, scroll position and draft only for the live assessment', async t => {
  const assessment = {id: 'A', conversation_id: 'chat-A', goal_id: 'g', mode: 'OPEN_BOOK', status: 'WAITING_ANSWER'};
  const state = {learning: {assessments: [assessment]}, goals: [{id: 'g', title: 'Goal'}]};
  const savedFormData = globalThis.FormData;
  globalThis.FormData = class {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values[name]; }
  };
  t.after(() => { globalThis.FormData = savedFormData; });
  const searchForm = {dataset: {assessment: 'A'}, values: {query: 'needle', scope: 'ALL'}};
  searchForm.closest = () => searchForm;
  await submitOpenBookSearch({target: searchForm, preventDefault() {}}, {
    api: async (_path, input) => ({scope: input.scope, results: Array.from({length: 6}, (_, index) => ({
      id: `doc-${index}`, type: 'note', title: `Note ${index}`, goal_title: 'Goal', location: '笔记', excerpt: 'source excerpt',
    }))}),
  });
  updateOpenBookInput({target: {closest: () => searchForm, name: 'query', value: 'needle revised'}});
  assert.match(openBookView(assessment), /needle revised/);

  const panelNode = {closest: () => ({dataset: {openBookPanel: 'A'}})};
  const api = async (_path, input) => ({...input, title: `Opened ${input.id}`, goal_title: 'Goal', location: '第 1 章', content: `Original ${input.id}`});
  for (let index = 0; index < 5; index++) {
    await openBookAction('openbook-open', {dataset: {index: String(index)}, closest: panelNode.closest}, {state, api, toast() {}});
  }
  assert.match(openBookView(assessment), /5 \/ 5 个标签/);
  let limitToast = '';
  await openBookAction('openbook-open', {dataset: {index: '5'}, closest: panelNode.closest}, {state, api, toast(message) { limitToast = message; }});
  assert.match(limitToast, /最多打开 5 个标签/);

  const tabIds = ['note:doc-0', 'note:doc-1', 'note:doc-2', 'note:doc-3', 'note:doc-4'];
  let listener;
  const makeRoot = () => {
    const elements = tabIds.map(id => {
      const body = {scrollTop: 0, addEventListener(_type, callback) { this.scrollCallback = callback; }};
      return {dataset: {openBookTab: id}, querySelector: () => body, body};
    });
    return {elements, querySelector: () => ({querySelectorAll: () => elements})};
  };
  const savedCss = globalThis.CSS;
  globalThis.CSS = {escape: value => value};
  t.after(() => { globalThis.CSS = savedCss; });
  const first = makeRoot();
  bindOpenBook(first, assessment);
  first.elements[0].body.scrollTop = 123;
  first.elements[0].body.scrollCallback();
  const second = makeRoot();
  bindOpenBook(second, assessment);
  assert.equal(second.elements[0].body.scrollTop, 123);

  const panel = {dataset: {openBookPanel: 'A'}};
  updateOpenBookInput({target: {closest: selector => selector === '[data-open-book-search]' ? null : panel, matches: selector => selector === '[data-open-book-title]', value: 'Scratch title'}});
  updateOpenBookInput({target: {closest: selector => selector === '[data-open-book-search]' ? null : panel, matches: selector => selector === '[data-open-book-draft]', value: 'scratch body'}});
  let savedNote;
  await openBookAction('openbook-save-draft', panelNode, {state, api: async (path, value) => { savedNote = {path, value}; return {note_id: 'saved'}; }, toast() {}});
  assert.equal(savedNote.path, 'open-book/save-draft');
  assert.equal(savedNote.value.content, 'scratch body');
  assert.doesNotMatch(openBookView(assessment), /scratch body/);
  updateOpenBookInput({target: {closest: selector => selector === '[data-open-book-search]' ? null : panel, matches: selector => selector === '[data-open-book-draft]', value: 'discard me'}});
  await openBookAction('openbook-discard-draft', panelNode, {state, api, toast() {}});
  assert.doesNotMatch(openBookView(assessment), /discard me/);
  assert.equal(openBookView({...assessment, status: 'COMPLETED'}), '');
});

test('teacher completion preserves only an unsaved draft for explicit save or discard', async t => {
  const assessment = {id: 'pending-A', conversation_id: 'chat-pending', goal_id: 'g', mode: 'OPEN_BOOK', status: 'WAITING_ANSWER'};
  const state = {learning: {assessments: [assessment]}, goals: [{id: 'g', title: 'Goal'}]};
  const panel = {dataset: {openBookPanel: assessment.id}};
  updateOpenBookInput({target: {closest: selector => selector === '[data-open-book-search]' ? null : panel, matches: selector => selector === '[data-open-book-title]', value: 'Unfinished notes'}});
  updateOpenBookInput({target: {closest: selector => selector === '[data-open-book-search]' ? null : panel, matches: selector => selector === '[data-open-book-draft]', value: 'Keep this after Teacher finishes.'}});
  state.learning.assessments = [{...assessment, status: 'COMPLETED'}];
  syncOpenBookAssessments(state.learning.assessments);
  const pending = openBookView(state.learning.assessments[0]);
  assert.match(pending, /考察已结束/);
  assert.match(pending, /Keep this after Teacher finishes/);
  assert.doesNotMatch(pending, /搜索原文|查看原文|已打开的参考资料/);
  assert.match(pending, /保存为笔记/);

  let payload;
  const node = {closest: () => ({dataset: {openBookPanel: assessment.id}})};
  await openBookAction('openbook-save-draft', node, {
    state,
    api: async (_path, input) => { payload = input; return {note_id: 'pending-note'}; },
    toast() {},
  });
  assert.equal(payload.pending_draft, true);
  assert.equal(payload.assessment_id, assessment.id);
  assert.equal(payload.content, 'Keep this after Teacher finishes.');
  assert.equal(openBookView(state.learning.assessments[0]), '');
});

test('opt-in verification uses a typed note action keyed by note hash and current capability version', t => {
  const store = createStore(':memory:');
  t.after(() => store.db.close());
  const db = store.db;
  addGoal(db, 'g', 'Goal');
  db.prepare('INSERT INTO capability_sets VALUES(?,?,?,?,?)').run('set-v1', 'g', '[]', 'ACCEPTED', '2026-01-01');
  db.prepare('INSERT INTO readiness_items VALUES(?,?,?,?,?)').run('core', 'g', 'set-v1', 'Core', 'CORE');
  db.prepare('INSERT INTO knowledge_nodes VALUES(?,?,?)').run('node', 'Topic', 'Research');
  db.prepare('INSERT INTO requirements VALUES(?,?,?,?,?,?)').run('req', 'g', 'set-v1', 'core', 'node', 'Explain topic');
  const chat = store.newConversation('g', 'Planning');
  const note = store.saveNote({goal_id: 'g', title: 'Evidence of change', content: 'I can now explain this topic.'});
  const hash = createHash('sha256').update('Evidence of change\0I can now explain this topic.').digest('hex').slice(0, 58);
  const requestId = `nv:${hash}:set-v1`;
  const prompt = 'Evaluate whether the note warrants an invitation; do not start an assessment.';
  const sent = store.send(chat.id, prompt, requestId, {intent: 'NOTE_VERIFICATION', subject_id: note.id});
  const action = db.prepare('SELECT * FROM goal_chat_actions WHERE job_id=?').get(sent.job_id);
  assert.equal(action.intent, 'NOTE_VERIFICATION');
  assert.equal(action.subject_id, note.id);
  assert.deepEqual(store.send(chat.id, prompt, requestId, {intent: 'NOTE_VERIFICATION', subject_id: note.id}), sent);
  assert.equal(db.prepare('SELECT count(*) AS count FROM jobs WHERE conversation_id=?').get(chat.id).count, 1);

  const second = store.saveNote({goal_id: 'g', title: 'Saved before queue failure', content: 'This must remain saved.'});
  assert.throws(() => store.send(chat.id, prompt, 'nv:failed', {intent: 'NOTE_VERIFICATION', subject_id: 'missing-note'}), /来源不属于当前目标/);
  assert.equal(db.prepare('SELECT id FROM notes WHERE id=?').get(second.id).id, second.id);
  assert.equal(db.prepare('SELECT count(*) AS count FROM jobs WHERE conversation_id=?').get(chat.id).count, 1);
});
