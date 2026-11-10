const assert = require('node:assert/strict');
const http = require('node:http');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

// A local model fixture exercises the actual chat, executor, confirmations and DB.
const days = ['量化基线', 'KV 容量估算', '分页访问', 'CUDA 访存', '批处理策略', '性能剖析', 'D7 独立复现'];
const explain = '先讨论七天安排，暂时只聊思路。';
const proceed = '我们刚才商量的就这么办吧，到了要我做决定的时候再问我。';
const postpone = '先放一放路线整理，我想再聊聊。', resume = '继续刚才暂停的整理吧。', adjust = '把能力要求里的验收条件改成比较两次基线。';
const roadmapAdjust = '把第一天任务改成比较两次基线，仍然保留七天安排。';
const learningQuestion = '比较两次量化基线时，怎样判断差异来自测量波动？';
const learningReply = '先固定模型、输入与运行参数，再重复两次基线，比较波动范围后解释差异。';
function respond(payload, history, expectedLearning, learningRequests) {
  const { task, context } = JSON.parse(payload.messages[1].content);
  const L = context.learning, called = payload.messages.flatMap(m => m.tool_calls || []).map(c => c.function.name);
  for (const msg of payload.messages.filter(m => m.role === 'tool')) assert.equal(JSON.parse(msg.content).error, undefined, msg.content);
  function call(name, args) {
    assert.ok(payload.tools?.some(t => t.function.name === name), 'tool available to ' + task.module + ': ' + name);
    history.push({ module: task.module, name });
    return { tool_calls: [{ id: 'call_' + history.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
  }
  if (task.module === 'chat') {
    const message = context.messages.find(m => m.id === task.claimed_message_id)?.content;
    if (context.session_learning) {
      assert.ok(expectedLearning, 'learning request follows confirmed route');
      const scope = context.session_learning;
      assert.equal(message, learningQuestion);
      assert.equal(context.conversation.kind, 'SESSION_LEARNING');
      assert.equal(context.conversation.id, expectedLearning.conversationId);
      assert.equal(context.goal.id, expectedLearning.goalId);
      assert.equal(scope.session.id, expectedLearning.sessionId);
      assert.equal(scope.session.proposal_id, expectedLearning.proposalId, 'task belongs to current approved route');
      assert.equal(scope.session.objective, '比较两次基线并解释差异', 'revised approved objective reaches chat');
      assert.equal(scope.details.session_id, expectedLearning.sessionId);
      assert.deepEqual(scope.details.requirements, expectedLearning.requirementIds);
      assert.deepEqual(scope.capabilities.map(r => r.id), expectedLearning.requirementIds);
      assert.ok(scope.capabilities.some(r => r.description.includes('比较两次基线')), 'confirmed revised capabilities reach chat');
      assert.equal(scope.planning_conversation.id, expectedLearning.planningId);
      assert.ok(scope.planning_conversation.messages.some(m => m.content === roadmapAdjust), 'original planning history reaches task chat');
      assert.equal(scope.read_only, false);
      assert.equal(context.learning.assessment, null);
      assert.deepEqual(context.evidence, []);
      assert.equal(payload.tools, undefined, 'ordinary learning has no planning or formal assessment tools');
      assert.equal(called.length, 0);
      assert.equal(payload.model, 'planning-fixture', 'normal configured chat model handles task learning');
      learningRequests.push({ session_id: scope.session.id, conversation_id: context.conversation.id, proposal_id: scope.session.proposal_id, capabilities: scope.capabilities.map(r => r.id), noPlanningTools: true });
      return { content: learningReply };
    }
    if (message === explain) return { content: '讨论稿：' + days.join(' → ') };
    if (!called.length) {
      if (message === proceed) return call('teacher_advance_learning_plan', {});
      const flow = context.planning_flow;
      const control = { expected_revision: flow.expected_revision };
      if (message === postpone) return call('teacher_advance_learning_plan', { ...control, action: 'LATER' });
      if (message === resume) return call('teacher_advance_learning_plan', { ...control, action: 'RESUME' });
      assert.ok([adjust, roadmapAdjust].includes(message));
      return call('teacher_advance_learning_plan', { ...control, action: 'REVISE', proposal_id: flow.proposal_id, feedback: message });
    }
    return { content: '已处理这一步，原对话中的规划卡会显示当前进度。' };
  }
  if (task.module === 'capabilities' || task.module === 'roadmap') {
    assert.ok(context.messages.some(m => m.content.includes(days.at(-1))), 'specialist gets original discussion');
    if (called.length) return { content: '提案已提交，请查看本对话中的选项。' };
    if (task.module === 'capabilities') {
      const revised = context.messages.find(m => m.id === task.claimed_message_id)?.content.includes(adjust);
      return call('teacher_propose_capabilities', { items: [{ title: '独立复现推理性能对比', kind: 'CORE', requirements: [{ node: 'KV 容量估算', description: revised ? '比较两次基线，解释缓存容量的估算偏差。' : '能依据序列长度和数据类型估算缓存容量，并用实际样本解释偏差。' }] }] });
    }
    return call('teacher_plan_learning', { title: '七天推理性能学习路线', summary: '沿用原讨论的七个主题，根据实际诊断安排独立复现。', phases: [{ title: '七天练习', topics: [{ key: 'inference', title: '推理优化', dependencies: [], resource_ids: [], requirement_ids: L.requirements.map(r => r.id), sessions: days.map((title, i) => ({ title, objective: i === 0 && context.messages.some(m => m.content === roadmapAdjust) ? '比较两次基线并解释差异' : '第 ' + (i + 1) + ' 天完成并解释' + title })) }] }] });
  }
  const assessment = L.assessment;
  assert.equal(assessment.kind, 'INITIAL_DIAGNOSTIC');
  const round = assessment.rounds.at(-1);
  if (!round) return call('teacher_assessment_question', { question: '缓存容量与序列长度有什么关系？', requirement_ids: assessment.requirement_ids });
  assert.ok(round.answer_message_id && context.messages.some(m => m.id === round.answer_message_id && m.role === 'user' && m.content.includes('线性增加')), 'diagnosis uses the learner answer');
  if (!called.includes('teacher_assessment_feedback')) return call('teacher_assessment_feedback', { round_id: round.id, feedback: '能说明长度对显存的影响。' });
  return call('teacher_finish_assessment', { summary: '完成一次有实际作答的诊断。', profile: '能定性解释，但还需要独立计算。', change_summary: '按当前回答记录', relations: assessment.requirement_ids.map(requirement_id => ({ requirement_id, relation: 'SUPPORTS' })), gaps: [], readiness: [], completion_recommended: false });
}

exports.run = async (main, base) => {
  const history = [], errors = [], learningRequests = [];
  let expectedLearning;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', b => {
      raw += b;
    });
    req.on('end', () => {
      try {
        const message = respond(JSON.parse(raw), history, expectedLearning, learningRequests);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', ...message } }] }));
      } catch (e) {
        errors.push(String(e));
        res.writeHead(500);
        res.end('fixture failed');
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  main.showInactive();
  const exec = code => main.webContents.executeJavaScript(code);
  const post = (path, data) => exec(`fetch('/api/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(data)})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v;})`);
  const state = () => exec(`fetch('/api/state').then(r=>r.json())`);
  async function until(check, label) {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (errors.length) throw Error(errors.join('\n'));
      if (await check()) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw Error(label + '\n' + await exec('document.body.innerText.slice(-1800)'));
  }
  const click = async action => {
    const selector = '[data-action="planning-' + action + '"]';
    await until(() => exec(`!!document.querySelector('${selector}:not(:disabled)')`), action);
    await exec(`document.querySelector('${selector}').click()`);
  };
  const send = async content => {
    await until(() => exec(`!!document.querySelector('#message-input:not(:disabled)')`), '消息输入框');
    await exec(`(()=>{const input=document.querySelector('#message-input');input.value=${JSON.stringify(content)};input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();})()`);
  };
  async function revisionDraft(content, screenshot) {
    const before = await state();
    await exec(`(()=>{const input=document.querySelector('#message-input');input.value=${JSON.stringify(content)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('revision');
    await new Promise(r => setTimeout(r, 1800));
    assert.deepEqual(await exec(`({focused:document.activeElement?.id,draft:document.querySelector('#message-input').value,mini:!!document.querySelector('#planning-feedback')})`), {focused:'message-input',draft:content,mini:false});
    const after = await state();
    assert.deepEqual(after.proposals, before.proposals, '点击调整不得写入或拒绝路线');
    assert.deepEqual(after.learning.capability_sets, before.learning.capability_sets, '点击调整不得拒绝能力提案');
    assert.equal((await exec(`fetch('/api/messages?conversation_id='+encodeURIComponent(new URL(location.href).searchParams.get('conversation_id'))).then(r=>r.json())`)).filter(m=>m.content===content).length,0,'草稿尚未发送');
    writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,screenshot),(await main.webContents.capturePage()).toPNG());
    await send(content);
  }
  try {
    const profile = await post('models/profile', { name: '本机路线验收', base_url: 'http://127.0.0.1:' + server.address().port + '/v1', model: 'planning-fixture' });
    for (const role of ['chat', 'capabilities', 'assessment', 'roadmap']) await post('agents/configure', { role, mode: 'API', profile_id: profile.id });
    await post('models/enabled', { enabled: true });
    const { goal, conversation } = await post('goals', { title: '推理性能七天练习', domain: '测试' });
    const openSource = () => main.loadURL(base + '/?view=chat&goal_id=' + goal.id + '&conversation_id=' + conversation.id);
    await openSource();
    await send(explain);
    await until(() => exec(`document.querySelector('.messages').innerText.includes('D7 独立复现')`), '讨论稿显示');
    assert.equal((await state()).planning_flow.length, 0, '普通讨论不启动正式流程');
    assert.equal(await exec(`!!document.querySelector('#task-kind')`), false);
    await send(proceed);
    await until(async () => (await state()).learning.capability_sets.some(s => s.goal_id === goal.id && s.status === 'PENDING'), '自然语言触发真实能力提案');
    const before = await state();
    assert.equal(before.sessions.length, 0);
    assert.equal(before.learning.assessments.length, 0);
    await until(() => exec(`document.querySelector('[data-planning-flow]')?.innerText.includes('独立复现推理性能对比')`), '原对话显示实际提案内容');
    await send(postpone);
    await until(async () => (await state()).planning_flow[0]?.status === 'DEFERRED', '自然语言暂缓');
    await send(resume);
    await until(async () => (await state()).planning_flow[0]?.stage === 'REVIEW_CAPABILITIES', '自然语言恢复');
    await revisionDraft(adjust, 'capability-revision-composer.png');
    await until(() => exec(`document.querySelector('[data-planning-flow]')?.innerText.includes('比较两次基线')`), '自然语言提交修改后的能力提案');
    assert.equal((await state()).learning.capability_sets.filter(s => s.status === 'REJECTED').length, 1, '原提案留在历史中');
    await click('accept-cap');
    await until(async () => (await state()).learning.capability_sets.some(s => s.status === 'ACCEPTED'), '确认能力');
    if (!(await state()).learning.assessments.length) await click('begin-diagnosis');
    await until(async () => (await state()).learning.assessments.some(a => a.status === 'WAITING_ANSWER'), '正式诊断提问');
    await until(() => exec(`document.querySelector('.messages')?.innerText.includes('缓存容量与序列长度')`), '诊断对话显示');
    await send('其他参数固定时，缓存容量随序列长度线性增加。');
    await until(async () => (await state()).proposals.some(p => p.status === 'PENDING'), '诊断结束后自动生成路线');
    if (await exec(`!!document.querySelector('[data-action="planning-return"]')`)) await click('return');
    await until(() => exec(`document.querySelector('[data-planning-flow]')?.innerText.includes('七天推理性能学习路线')`), '原对话等待路线确认');
    assert.equal((await state()).sessions.length, 0, '确认前不创建正式任务');
    await revisionDraft(roadmapAdjust, 'roadmap-revision-composer.png');
    await until(async () => (await state()).proposals.some(p => p.status === 'REJECTED'), '发送后拒绝旧路线');
    await until(() => exec(`document.querySelector('[data-planning-flow]')?.innerText.includes('比较两次基线并解释差异')`), '修改路线显示新目标');
    await main.webContents.reload();
    await click('accept-roadmap');
    await until(async () => (await state()).goals.some(g => g.id === goal.id && g.status === 'ACTIVE'), '采纳正式路线');
    const end = await state();
    assert.deepEqual(end.sessions.filter(s => s.goal_id === goal.id).map(s => s.title), days);
    assert.equal(end.evidence.length, 1);
    assert.ok(end.sessions.some(s => s.goal_id === goal.id && s.objective.includes('比较两次基线')));
    const messages = await exec(`fetch('/api/messages?conversation_id=${conversation.id}').then(r=>r.json())`);
    for (const feedback of [adjust,roadmapAdjust]) assert.equal(messages.filter(m => m.role === 'user' && m.content === feedback).length,1,'调整意见只保存一次');
    await until(async () => {
      const latest = await state(), conversations = new Set(latest.conversations.filter(c => c.goal_id === goal.id).map(c => c.id));
      return !latest.jobs.some(j => conversations.has(j.conversation_id) && ['QUEUED','RUNNING'].includes(j.status));
    }, '规划任务结束后进入任务学习');
    const stable = await state(), [firstTask, secondTask] = stable.sessions.filter(s => s.goal_id === goal.id);
    const diagnostic = stable.learning.assessments.find(a => a.goal_id === goal.id && a.kind === 'INITIAL_DIAGNOSTIC');
    assert.ok(diagnostic?.conversation_id);
    const readMessages = id => exec(`fetch('/api/messages?conversation_id='+encodeURIComponent(${JSON.stringify(id)})).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error);return value;})`);
    const diagnosticMessages = await readMessages(diagnostic.conversation_id);
    const currentChat = () => exec(`document.querySelector('.chatitem.selected')?.dataset.chat`);
    async function openTask(task) {
      const route = '[data-action="session-route"]';
      await until(() => exec(`!!document.querySelector('${route}')`), '从对话进入学习路线');
      await exec(`document.querySelector('${route}').click()`);
      const card = '.roadmap-task[data-id="' + task.id + '"]';
      await until(() => exec(`!!document.querySelector('${card}')`), '路线图显示实际任务');
      await exec(`document.querySelector('${card}').click()`);
      await until(() => exec(`document.querySelector('#editor[open]')?.innerText.includes('进入学习答疑')`), '实际任务详情提供学习答疑入口');
      await exec(`document.querySelector('#editor [data-action="task-chat"][data-id="${task.id}"]').click()`);
      await until(() => exec(`document.querySelector('[data-learning-session="${task.id}"]')?.innerText.includes(${JSON.stringify(task.title)})`), '任务学习上下文显示');
      const opened = await state(), binding = opened.session_chats.find(row => row.session_id === task.id);
      assert.ok(binding);
      assert.equal(await currentChat(), binding.conversation_id);
      assert.equal(opened.conversations.find(c => c.id === binding.conversation_id)?.kind, 'SESSION_LEARNING');
      assert.ok(await exec(`document.querySelector('.chatitem.selected small')?.innerText.includes('任务学习')`), '学习对话有清晰标签');
      return binding.conversation_id;
    }
    const firstChat = await openTask(firstTask);
    assert.notEqual(firstChat, conversation.id);
    assert.notEqual(firstChat, diagnostic.conversation_id, '学习答疑与正式诊断对话分开');
    let learningState = await state();
    assert.deepEqual(learningState.jobs, stable.jobs, '打开任务不自动启动作业');
    assert.deepEqual(await readMessages(firstChat), [], '打开任务不自动发送消息');
    assert.deepEqual(learningState.sessions, stable.sessions, '打开任务不改变任务状态');
    assert.deepEqual(learningState.evidence, stable.evidence, '打开任务不产生证据');
    assert.deepEqual(learningState.learning.assessments, stable.learning.assessments, '打开任务不启动正式评估');
    const accepted = stable.proposals.find(p => p.id === firstTask.proposal_id);
    assert.equal(accepted.status, 'ACCEPTED');
    expectedLearning = { conversationId: firstChat, goalId: goal.id, sessionId: firstTask.id, proposalId: accepted.id, planningId: conversation.id, requirementIds: stable.learning.session_details.find(d => d.session_id === firstTask.id).requirements };
    const toolsBeforeLearning = history.length;
    await send(learningQuestion);
    await until(() => exec(`document.querySelector('.messages')?.innerText.includes(${JSON.stringify(learningReply)})`), '普通输入框显示模型学习答复');
    await until(async () => !(await state()).jobs.some(j => j.conversation_id === firstChat && ['QUEUED','RUNNING'].includes(j.status)), '学习答复正常完成');
    const firstMessages = await readMessages(firstChat);
    assert.deepEqual(firstMessages.map(m => [m.role,m.content]), [['user',learningQuestion],['assistant',learningReply]]);
    assert.equal(learningRequests.length, 1, '任务问题实际调用本地模型');
    assert.equal(history.length, toolsBeforeLearning, '学习答疑未调用规划工具');
    learningState = await state();
    assert.deepEqual(learningState.sessions, stable.sessions, '普通答疑不改变任务状态');
    assert.deepEqual(learningState.evidence, stable.evidence, '普通答疑不产生评估证据');
    assert.deepEqual(learningState.learning.assessments, stable.learning.assessments, '普通答疑不改变正式诊断');
    assert.deepEqual(learningState.proposals, stable.proposals, '普通答疑不修改路线');
    assert.deepEqual(learningState.learning.capability_sets, stable.learning.capability_sets, '普通答疑不修改能力要求');
    writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT, 'task-learning.png'), (await main.webContents.capturePage()).toPNG());
    await new Promise(resolve => { main.webContents.once('did-finish-load', resolve); main.webContents.reload(); });
    await until(() => exec(`!!document.querySelector('[data-action="session-route"]')`), '刷新后可以重新进入学习任务');
    const reopenFirst = await openTask(firstTask);
    assert.equal(reopenFirst, firstChat, '同一任务重新进入仍使用原对话');
    await until(() => exec(`document.querySelector('.messages')?.innerText.includes(${JSON.stringify(learningReply)})`), '重新进入保留答疑记录');
    assert.deepEqual(await readMessages(firstChat), firstMessages);
    assert.deepEqual((await state()).jobs, learningState.jobs, '刷新和重新进入不自动启动作业');
    const beforeSecond = await state(), secondChat = await openTask(secondTask);
    assert.notEqual(secondChat, firstChat, '同主题无依赖的其他任务拥有独立学习对话');
    assert.notEqual(secondChat, diagnostic.conversation_id);
    assert.deepEqual(await readMessages(secondChat), []);
    const afterSecond = await state();
    assert.deepEqual(afterSecond.jobs, beforeSecond.jobs, '打开其他任务同样不启动作业');
    assert.deepEqual(afterSecond.sessions, stable.sessions);
    assert.deepEqual(afterSecond.evidence, stable.evidence);
    assert.equal(afterSecond.session_chats.filter(row => [firstTask.id,secondTask.id].includes(row.session_id)).length, 2);
    await exec(`document.querySelector('.session-learning-context [data-chat="${conversation.id}"]').click()`);
    await until(async () => await currentChat() === conversation.id, '通过任务横幅返回原目标规划对话');
    await until(() => exec(`document.querySelector('.messages')?.innerText.includes(${JSON.stringify(roadmapAdjust)})`), '原规划历史显示');
    assert.deepEqual(await readMessages(conversation.id), messages, '返回规划保留原始完整历史');
    assert.deepEqual(await readMessages(diagnostic.conversation_id), diagnosticMessages, '任务学习保留正式诊断历史');
    assert.equal(learningRequests.length, 1, '重新打开和返回均不自动请求模型');
    const report = { version: end.version, packaged: require('electron').app.isPackaged, localMock: true, ordinaryQuestionStayedChat: true, semanticToolCalled: true, sourceHistoryUsed: true, naturalPauseResumeAndRevision: true, confirmedCapabilities: true, realDiagnosticAnswer: true, automaticRoadmap: true, userConfirmedAfterReload: true, acceptedSessions: days, taskLearning: { actualTaskDetailEntry: true, scopedProviderContext: true, normalComposerReply: true, sameTaskKeepsHistoryAfterReload: true, differentTaskSeparateChat: true, separateFormalAssessment: true, noAutomaticMessagesOrJobs: true, taskStatusAndEvidenceUnchanged: true, returnedToOriginalPlanningHistory: true, firstChat, secondChat, requests: learningRequests }, tools: history };
    writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT, 'guided-planning.json'), JSON.stringify(report, null, 2));
    console.log('GUIDED_PLANNING_OK ' + JSON.stringify(report));
  } finally {
    await post('models/enabled', { enabled: false });
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
};
