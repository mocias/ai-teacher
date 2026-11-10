const assert = require('node:assert/strict');

exports.run = async ({main,goalId,exec,post,click,submit,closeWait,until,state,capture}) => {
  async function capturePanel(selector, name) {
    await exec(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await exec("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 180))))");
    await capture(name);
  }
  await click('[data-view="plan"]');
  const goalSessions=(await state()).sessions.filter(s=>s.goal_id===goalId);
  const first=goalSessions[0].id;
  await click(`[data-action="rolling-defer"][data-id="${first}"]`);
  await until(()=>exec("document.querySelector('#editor').open"),'延后确认');
  await submit(); await closeWait();
  await until(async()=>(await state()).rolling_plan.deferred.some(d=>d.session_id===first),'延后生效');
  assert.equal((await state()).rolling_plan.queue.some(item=>item.session.id===first),false);
  const restore=`[data-action="rolling-restore"][data-id="${first}"]`;
  await exec(`document.querySelector(${JSON.stringify(restore)}).closest('details').open=true`);
  await click(restore);
  await until(async()=>(await state()).rolling_plan.queue.some(x=>x.session.id===first),'恢复后使用原任务');
  await click('[data-view="weekly"]'); await click('[data-action="weekly-settings"]');
  await until(()=>exec("!!document.querySelector('#editor[open] #adaptive-intensity')"),'复习强度');
  await exec("document.querySelector('#adaptive-intensity').value='INTENSIVE';document.querySelector('[name=auto_enabled]').checked=true");
  await submit(); await closeWait();
  await until(()=>exec("document.body.innerText.includes('密集')"),'强度保存');
  await click('[data-action="weekly-plan"]');
  await until(()=>exec("!!document.querySelector('#editor[open] #wp-capacity')"),'周排期设置');
  await exec("document.querySelector('#wp-capacity').value=240;document.querySelectorAll('#dialog-form input[name^=weekday_]').forEach(c=>c.checked=true)");
  await submit();await until(()=>exec("document.querySelector('#wp-preview')?.innerText.includes('组合数据清洗函数')"),'本周任务和具体日期');
  await capturePanel('#wp-preview','week-plan');await submit();await closeWait();
  assert.equal((await state()).calendar.filter(e=>goalSessions.some(s=>s.id===e.session_id)&&!e.cancelled).length,2);
  await click('[data-action="weekly-shift"][data-step="-7"]');
  await until(()=>exec("document.body.innerText.includes('历史周')"),'历史周');
  await capturePanel('[data-action="weekly-settings"]','weekly-history');

  for (const [title,content] of [['旧版函数规范','旧版先做 A 再做 B。'],['新版函数规范','新版先做 B 再做 A。']]) {
    const resource=await post('resources',{goal_id:goalId,title,role:'SUPPLEMENTARY'});
    await post('material-content',{resource_id:resource.id,scope:'第 1 节',content});
  }
  await click('[data-view="journey"]'); await click('[data-action="material-map-start"]');
  await until(async()=>{
    const s=await state();
    return s.learning.material_map.by_goal[goalId].conflicts.some(c=>c.current&&c.status==='OPEN')
      && await exec("!!document.querySelector('#composer')");
  },'Teacher 读过双方原文并登记冲突');
  await click('[data-view="journey"]');
  await until(()=>exec("document.querySelector('.material-map')?.innerText.includes('执行顺序冲突')"),'显示冲突和双方来源');
  const panel=await exec("document.querySelector('.material-map').innerText");
  assert.match(panel,/旧版函数规范/);assert.match(panel,/新版函数规范/);
  assert.ok((await state()).rolling_plan.excluded.some(x=>x.session.id===first && x.reason.includes('冲突')));
  await capturePanel('.material-map','material-conflict');
  const before=await state();
  const chosen=before.learning.material_contents.find(c=>before.resources.some(r=>r.id===c.resource_id && r.title==='新版函数规范'));
  await click(`[data-action="material-conflict-adopt"][data-content="${chosen.id}"]`);
  await until(()=>exec("!!document.querySelector('#editor[open] #material-decision-note')"),'选择采用正文');
  await exec("document.querySelector('#material-decision-note').value='本目标按新版函数规范验证执行顺序'");
  await submit(); await closeWait();
  await until(async()=>(await state()).rolling_plan.queue.some(x=>x.session.id===first),'裁决后恢复学习入口');
  const record=(await state()).learning.material_map.by_goal[goalId].conflicts.find(c=>c.current);
  assert.equal(record.status,'RESOLVED');assert.equal(record.decision,'ADOPTED');assert.equal(record.decision_history.at(-1).source_content_id,chosen.id);
  const note=await post('notes',{goal_id:goalId,title:'对学习进展的自述',content:'我现在能独立排查函数组合的执行顺序了，想检验一下。'});
  const initialEvidence=(await state()).evidence.length;
  await click('[data-view="journey"]');await click(`[data-action="detail-note"][data-id="${note.id}"]`);
  await click('[data-action="note-verification-ask"]');
  await until(async()=>(await state()).learning.note_verification_invites.some(i=>i.note_id===note.id && i.status==='PENDING'),'只凭用户笔记产生邀请');
  assert.equal((await state()).evidence.length,initialEvidence);
  await click('[data-view="learning"]');await click('[data-action="v2-note-verification-defer"]');
  await until(async()=>(await state()).learning.note_verification_invites.some(i=>i.note_id===note.id && i.status==='DEFERRED'),'邀请已暂缓');
  await click('[data-action="v2-quick-check"]');
  await until(()=>exec("!!document.querySelector('#editor[open] #qc-scope')"),'自测填写范围');
  await exec(`document.querySelector('#qc-scope').value='已学习函数组合中内外层的运行顺序';document.querySelector('#qc-session').value=${JSON.stringify(first)};document.querySelector('#qc-mode').value='OPEN_BOOK';document.querySelector('#dialog-form [name^="req_"]').checked=true`);
  await submit();await closeWait();
  let qc;
  for(let index=0; index<3;index++){
    await until(async()=>{qc=(await state()).learning.assessments.find(a=>a.goal_id===goalId && a.kind==='QUICK_CHECK');if(qc?.status!=='WAITING_ANSWER')return false;
      const rounds=await exec(`fetch('/api/assessment-rounds?id=${qc.assessment_id||qc.id}').then(r=>r.json())`);
      return rounds.length===index+1&&!rounds.at(-1).answer && await exec("!document.querySelector('#message-input')?.disabled && !!document.querySelector('#composer')");
    },'自测第 '+(index+1)+' 题');
    if(index===0){
      await until(()=>exec("!!document.querySelector('[data-open-book-search] [name=query]')"),'开卷检索面板');
      // Exercise the real assessment page, including app.render's editor selection.
      main.webContents.debugger.attach('1.3');
      try{
        for(const selector of ['[data-open-book-panel] input[name=query]','[data-open-book-title]','[data-open-book-draft]']){
          await exec(`document.querySelector('[data-open-book-panel] details').open=true;window.openBookLiveInput=document.querySelector(${JSON.stringify(selector)});openBookLiveInput.focus();window.openBookFetch=fetch;window.openBookRefreshes=0;window.fetch=async(...args)=>{const result=await openBookFetch(...args);if(args[0]==='/api/state')openBookRefreshes++;return result;};void 0`);
          await main.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'kao',selectionStart:3,selectionEnd:3});
          await post('notes',{goal_id:goalId,title:'开卷输入刷新验证',content:'仅在隔离学习库触发状态更新。'});
          await until(()=>exec('openBookRefreshes>0'),'开卷输入期间收到状态更新');
          await exec('new Promise(r=>setTimeout(r,250))');
          assert.equal(await exec('openBookLiveInput.isConnected&&document.activeElement===openBookLiveInput'),true);
          await main.webContents.debugger.sendCommand('Input.insertText',{text:'考'});
          assert.equal(await exec('openBookLiveInput.value'),'考');
          await exec("window.fetch=openBookFetch;openBookLiveInput.value='';openBookLiveInput.dispatchEvent(new Event('input',{bubbles:true}));");
        }
      }finally{main.webContents.debugger.detach();}
      await exec("document.querySelector('[data-open-book-search] [name=query]').value='执行顺序';document.querySelector('[data-open-book-search]').requestSubmit()");
      await until(()=>exec("document.querySelector('.open-book-results')?.innerText.includes('自述')"),'开卷查到自己写的笔记');
    }
    await exec("document.querySelector('#message-input').value='先完成内层函数，再把结果传入外层';document.querySelector('#message-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composer').requestSubmit()");
  }
  await until(async()=>(await state()).learning.assessments.some(a=>a.id===qc.id&&a.status==='COMPLETED'),'自测已完成');
  const ended=await state();assert.equal(ended.sessions.find(s=>s.id===first).status,'PLANNED');
  const rounds=await exec(`fetch('/api/assessment-rounds?id=${qc.id}').then(r=>r.json())`);
  assert.deepEqual(rounds.map(r=>r.phase),['BROAD','BROAD','FOCUSED']);
  await exec("location.href='/personal.html'").catch(()=>{});
  await until(()=>exec("document.querySelector('#knowledge-profile')?.innerText.includes('已在作答中说明先算内层再算外层')"),'知识画像保留来源判断');
  await capturePanel('#knowledge-profile','knowledge-profile');
  return {knowledgeProfileVisible:true,weekScheduleConfirmed:true,quickCheckThreeRounds:true,openBookSearch:true,openBookNativeImeDuringRefresh:true,deferredNoteInvite:true,adoptedSource:true,weeklySettings:true,historicalWeek:true,deferRestorePreservesTask:true,readAndRegisterConflict:true,blockedTopic:true};
};
