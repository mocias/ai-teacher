const assert = require('node:assert/strict');

// Continue from the first goal's frozen snapshot using the normal Web controls.
exports.run = async ({main,post, exec, click, submit, until, closeWait, state, answer, journey, capture}) => {
  const {goal} = await post('goals', {title:'复用函数基础学习新场景', domain:'编程'});
  await click('[data-view="journey"]');
  await until(() => exec(`!!document.querySelector('#goal-select option[value="${goal.id}"]')`), '新目标出现');
  await exec(`{const select=document.querySelector('#goal-select');select.value=${JSON.stringify(goal.id)};select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await journey('capabilities'); await click('[data-action="journey-next"]');
  async function waitForProposal(ready, label) {
    await until(async () => {
      const s = await state();
      const conversations = new Set(s.conversations.filter(c => c.goal_id === goal.id).map(c => c.id));
      return ready(s) && !s.jobs.some(j => conversations.has(j.conversation_id) && ['QUEUED','RUNNING'].includes(j.status))
        && await exec("!!document.querySelector('#composer')");
    }, label);
  }
  await waitForProposal(s=>s.learning.capability_sets.some(p=>p.goal_id===goal.id && p.status==='PENDING'), '已返回新目标能力提案');
  await journey('confirm-cap'); await click('[data-action="journey-next"]'); await click('[data-action="v2-accept-cap"]');
  await journey('diagnostic'); await click('[data-action="v2-prior"]');
  await until(() => exec(`document.querySelector('#editor')?.innerText.includes('在当前目标短测这项要求')`), '历史作答');
  await click('#editor details summary');
  assert.match(await exec(`document.querySelector('#editor details[open]').innerText`), /double\(3\).*6/);
  await capture('prior-answers');
  await click('#editor [data-action="v2-results"]');
  await until(() => exec(`document.querySelector('#editor')?.innerText.includes('逐题记录')`), '来源考察');
  await click('#editor [aria-label="关闭"]');
  await click('[data-action="v2-prior"]'); await click('[data-action="v2-prior-check"]');
  await until(() => exec(`document.querySelector('#editor[open] #vkind')?.value==='INCREMENTAL_DIAGNOSTIC'`), '短测设置');
  assert.equal(await exec(`document.querySelector('#vkind').value`),'INCREMENTAL_DIAGNOSTIC');
  assert.equal(await exec(`document.querySelectorAll('#dialog-form [name^="req_"]:checked').length`),1);
  await submit(); await closeWait(); await answer('INCREMENTAL_DIAGNOSTIC');
  await journey('diagnostic'); await click('[data-action="journey-next"]');
  await until(() => exec(`document.querySelector('#editor[open] #vkind')?.value==='INITIAL_DIAGNOSTIC'`),'本目标初诊');
  await submit(); await closeWait(); await answer('INITIAL_DIAGNOSTIC');
  await journey('roadmap'); await click('[data-action="journey-next"]');
  await waitForProposal(s=>s.proposals.some(p=>p.goal_id===goal.id && p.status==='PENDING'), '已返回新目标路线提案');
  await journey('confirm-roadmap'); await click('[data-action="journey-next"]');
  await until(() => exec(`document.body.innerText.includes('这份路线如何使用旧作答')`), '提案依据');
  await capture('prior-roadmap'); await click('[data-action="accept"]');
  await until(async () => (await state()).proposals.some(p => p.goal_id===goal.id && p.status==='ACCEPTED'), '采纳新路线');
  await exec('location.reload()').catch(()=>{});
  await click('[data-view="plan"]');
  await until(() => exec(`document.body.innerText.includes('这份路线如何使用旧作答')`),'重载保留依据');
  const saved = await state();
  assert.deepEqual(saved.sessions.filter(s=>s.goal_id===goal.id).map(s=>s.title),['组合数据清洗函数','定位变换顺序错误']);
  assert.equal(saved.evidence.filter(e=>e.goal_id===goal.id).length,2);
  assert.equal(saved.goals.find(g=>g.id===goal.id).status,'ACTIVE');
  const canonical=process.argv.includes('--canonical-smoke')?await require('./canonical-smoke.cjs').run({main,goalId:goal.id,post,exec,click,submit,until,closeWait,state,capture}):undefined;
  return {canonical,sourceReport:true, targetedCheck:true, initialDiagnostic:true, confirmedRoute:true, reloadPreserved:true, newAnswers:2};
};
