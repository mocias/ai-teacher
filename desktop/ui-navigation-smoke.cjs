const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Uses an isolated desktop smoke database. The shared planning fixture creates
// actual planning, task-learning and assessment conversations through normal APIs.
exports.run = async (main, base) => {
  const exec = code => main.webContents.executeJavaScript(code);
  const state = () => exec(`fetch('/api/state').then(r=>r.json())`);
  const post = (path, body) => exec(`fetch('/api/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error);return value;})`);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check, label) {
    for (let n = 0; n < 200; n++) {
      if (await check()) return;
      await pause(100);
    }
    throw Error(label + '\n' + await exec('document.body.innerText.slice(-2200)'));
  }
  async function click(selector) {
    await until(() => exec(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
    await exec(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await pause(220);
  }
  const capture = async name => {
    for (let attempt = 0; ; attempt++) {
      try {
        writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT, name + '.png'), (await main.webContents.capturePage()).toPNG());
        return;
      } catch (error) {
        if (error.message !== 'UnknownVizError' || attempt >= 2) throw error;
        await pause(200);
      }
    }
  };
  const report = { nativeElectron: true, packaged: require('electron').app.isPackaged, routes: [], screenshots: [], viewports: [] };
  main.showInactive();
  main.webContents.debugger.attach('1.3');
  const posts = [];
  const listener = (_event, method, params) => {
    if (method === 'Network.requestWillBeSent' && params.request.method === 'POST') posts.push(new URL(params.request.url).pathname);
  };
  main.webContents.debugger.on('message', listener);
  await main.webContents.debugger.sendCommand('Network.enable');
  try {
    // Navigation, grouping and panel visibility must not create learning data.
    const initial = await state();
    const status = await exec(`({text:document.querySelector('#hoststatus').textContent,title:document.querySelector('#hoststatus').title})`);
    assert.equal(status.title, '尚未连接宿主');
    assert.equal(status.text, status.title, 'unconfigured status must remain truthful');
    assert.equal(initial.host.last_seen, null);
    const links = await exec(`({routes:[...document.querySelectorAll('nav [data-view]')].map(n=>n.dataset.view),profile:document.querySelector('nav [data-view="profile"]').closest('details').querySelector('summary').textContent,settings:[...document.querySelector('nav [data-view="settings"]').closest('details').querySelectorAll('[data-view]')].map(n=>n.dataset.view),assistant:document.querySelector('nav .nav-agent-link').getAttribute('href')})`);
    assert.deepEqual(links.routes.slice().sort(), ['home','chat','journey','plan','learning','review','weekly','reader','resources','notes','profile','models','settings'].sort());
    assert.match(links.profile, /学习管理/);
    assert.deepEqual(links.settings, ['models','settings']);
    assert.equal(links.assistant, '/agents.html');
    await pause(700);
    const routePosts = posts.length;
    for (const route of links.routes) {
      await exec(`{const button=document.querySelector('nav [data-view="${route}"]');const group=button.closest('details');if(group)group.open=true;button.click();}`);
      await until(() => exec(`document.querySelector('nav [data-view="${route}"]').getAttribute('aria-current')==='page'`), 'route ' + route);
      if (route === 'reader') await until(() => exec(`!document.querySelector('#embedded-reader').hidden&&!!document.querySelector('#reader-frame')`), 'reader mounted');
      else await until(() => exec(`!document.querySelector('#main').hidden&&document.body.dataset.view===${JSON.stringify(route)}`), route + ' displayed');
      assert.equal(await exec(`document.querySelector('nav .nav-agent-link').getAttribute('href')`), '/agents.html');
      report.routes.push(route);
    }
    await click('nav [data-view="home"]');
    await pause(500);
    assert.deepEqual(posts.slice(routePosts), [], 'display-only route changes must not POST');
    report.navigationNoWrites = true;

    // Native Chromium composition is checked across autosave/SSE, including
    // every existing ancestor between the editor and main.
    await click('[data-action="home-conversation"][data-id="discovery"]');
    await until(() => exec(`!!document.querySelector('#discovery-input')`), 'discovery input');
    const discussion = await exec(`document.querySelector('#discussion-select').value`);
    await exec(`window.navInput=document.querySelector('#discovery-input');window.navAncestors=[];for(let n=navInput.parentElement;n;n=n.parentElement){navAncestors.push(n);if(n.id==='main')break;}navInput.focus()`);
    await main.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
    await pause(1200);
    assert.equal(await exec(`navInput===document.querySelector('#discovery-input')&&document.activeElement===navInput&&navAncestors.every((n,i)=>n.isConnected&&(i?navAncestors[i-1].parentElement:navInput.parentElement)===n)`), true, 'composition retains input and ancestor identity');
    await post('discussions/input', { conversation_id: discussion, content: '后台刷新草稿' });
    await pause(850);
    assert.equal(await exec(`navInput===document.querySelector('#discovery-input')&&document.activeElement===navInput&&navAncestors.every((n,i)=>n.isConnected&&(i?navAncestors[i-1].parentElement:navInput.parentElement)===n)`), true, 'SSE retains editor ancestors during composition');
    await main.webContents.debugger.sendCommand('Input.insertText', { text: '中文草稿' });
    await pause(900);
    assert.equal(await exec('navInput.value'), '中文草稿');
    report.discoveryNativeImeAndAncestorIdentity = true;

    async function checkTab(tab) {
      const data = await exec(`(()=>{const tab=${JSON.stringify(tab)};return [...document.querySelectorAll('[data-home-agenda]')].map(button=>{const panel=document.getElementById(button.getAttribute('aria-controls'));return {key:button.dataset.homeAgenda,selected:button.getAttribute('aria-selected'),tabIndex:button.tabIndex,hidden:panel.hidden,role:panel.getAttribute('role'),label:panel.getAttribute('aria-labelledby'),id:button.id}})})()`);
      assert.equal(data.length, 2);
      for (const item of data) {
        assert.equal(item.selected, String(item.key === tab));
        assert.equal(item.tabIndex, item.key === tab ? 0 : -1);
        assert.equal(item.hidden, item.key !== tab);
        assert.equal(item.role, 'tabpanel');
        assert.equal(item.label, item.id);
      }
      assert.equal(await exec(`localStorage.getItem('teacher.home.agenda')`), tab);
    }
    const tabPosts = posts.length;
    await click('[data-home-agenda="overview"]');
    await checkTab('overview');
    await exec(`document.querySelector('[data-home-agenda="overview"]').focus()`);
    await main.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await main.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await checkTab('today');
    assert.equal(await exec(`document.activeElement.dataset.homeAgenda`), 'today');
    await click('[data-home-agenda="overview"]');
    await click('nav [data-view="notes"]');
    await click('nav [data-view="home"]');
    await checkTab('overview');
    assert.deepEqual(posts.slice(tabPosts), [], 'home tabs and route restoration must not POST');
    await main.webContents.reload();
    await until(() => exec(`!!document.querySelector('[data-home-agenda="overview"][aria-selected="true"]')`), 'agenda reload persistence');
    await click('[data-action="home-conversation"][data-id="discovery"]');
    await checkTab('overview');
    assert.equal(await exec(`document.querySelector('#discovery-input').value`), '中文草稿');
    report.homeTabs = { aria: true, nativeArrowKeyboard: true, routePersistence: true, reloadPersistence: true, noWrites: true, draftRetained: true };

    // Run existing real workflow to populate all three kinds without direct DB
    // mutation or synthetic DOM conversations.
    let checkedReminder = false;
    const fixtureMain = {
      showInactive: () => main.showInactive(),
      loadURL: url => main.loadURL(url),
      webContents: {
        executeJavaScript: code => main.webContents.executeJavaScript(code),
        reload: () => main.webContents.reload(),
        once: (...args) => main.webContents.once(...args),
        capturePage: async () => {
          // The helper's first capture occurs while a real capability proposal
          // awaits confirmation. Check reminders against that genuine state.
          if (!checkedReminder) {
            checkedReminder = true;
            const before = posts.length;
            await click('nav [data-view="home"]');
            for (const tab of ['today','overview']) {
              await click(`[data-home-agenda="${tab}"]`);
              assert.equal(await exec(`(()=>{const reminder=document.querySelector('.planning-reminders');return !!reminder&&!reminder.closest('[role="tabpanel"]')&&reminder.getBoundingClientRect().height>0&&reminder.innerText.includes('确认能力要求')})()`), true, 'pending planning reminder remains outside both home tabs');
            }
            await click('nav [data-view="chat"]');
            await exec(`document.querySelector('#message-input').focus()`);
            assert.deepEqual(posts.slice(before), [], 'reading pending reminders does not confirm or write proposals');
            report.pendingReminderVisibleInBothTabs = true;
          }
          return main.webContents.capturePage();
        }
      }
    };
    try {
      await require('./guided-planning-smoke.cjs').run(fixtureMain, base);
    } catch (error) {
      const visibility = await exec(`import('/live-events.js').then(module=>({hidden:document.hidden,dialog:document.querySelector('#editor').open,view:document.body.dataset.view,eventSourceState:module.liveEvents.readyState}))`);
      writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT, 'ui-navigation-failure.json'), JSON.stringify({ error: error.message, visibility }, null, 2));
      throw Error(error.message + '\nFixture visibility: ' + JSON.stringify(visibility));
    }
    const populated = await state();
    const goal = populated.goals.find(g => g.title === '推理性能七天练习');
    const conversations = populated.conversations.filter(c => c.goal_id === goal.id);
    const chosen = ['PLANNING','SESSION_LEARNING','ASSESSMENT_INITIAL_DIAGNOSTIC'].map(kind => conversations.find(c => c.kind === kind));
    if (!chosen[2]) chosen[2] = conversations.find(c => c.kind.startsWith('ASSESSMENT'));
    assert.ok(chosen.every(Boolean), 'all three kinds exist in actual database state');
    const groupingPosts = posts.length;
    for (const conversation of chosen) {
      await exec(`{const button=document.querySelector('#conversation-list [data-chat="${conversation.id}"]');button.closest('details').open=true;button.click();}`);
      await until(() => exec(`document.querySelector('.chatitem.selected')?.dataset.chat===${JSON.stringify(conversation.id)}`), conversation.kind);
      assert.equal(await exec(`document.querySelector('.chatitem.selected').closest('details').open`), true);
    }
    const groups = await exec(`Array.from(document.querySelectorAll('.conversation-group'),group=>({key:group.dataset.chatGroup,label:group.querySelector('summary span').textContent,count:Number(group.querySelector('summary small').textContent),actual:group.querySelectorAll('.chatitem').length}))`);
    assert.deepEqual(groups.map(g => g.label), ['目标与规划','任务学习','正式考察']);
    for (const group of groups) {
      assert.equal(group.key, goal.id + '|' + group.label);
      assert.equal(group.count, group.actual);
    }
    // Closing a current group is an explicit user choice. A later refresh must
    // preserve that choice; switching to another chat opens its own group.
    await exec(`window.navGroup=document.querySelector('.chatitem.selected').closest('details');window.navGroupSummary=navGroup.querySelector('summary');navGroupSummary.focus()`);
    const summaryId = await exec(`navGroupSummary.id`);
    assert.ok(summaryId, 'group summary exposes stable focus identity');
    assert.equal(await exec(`document.activeElement.id`), summaryId, 'group summary receives keyboard focus');
    await main.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
    await main.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(() => exec(`!document.querySelector('.chatitem.selected').closest('details').open`), 'keyboard closes selected conversation group');
    assert.deepEqual(posts.slice(groupingPosts), [], 'conversation selection and disclosure must not POST');
    // This explicit fixture write generates a genuine SSE state change while
    // leaving the selected chat and all learning/assessment data untouched.
    await post('discussions/input', { conversation_id: discussion, content: '会话分组刷新验证' });
    const afterStimulusPosts = posts.length;
    await until(() => exec(`navGroup!==document.querySelector('.chatitem.selected').closest('details')`), 'actual SSE rerenders conversation groups');
    assert.equal(await exec(`document.querySelector('.chatitem.selected').closest('details').open`), false);
    assert.equal(await exec(`document.activeElement.id`), summaryId, 'passive refresh retains keyboard focus on group summary');
    await exec(`document.querySelector('#conversation-list [data-chat="${chosen[0].id}"]').closest('details').open=false`);
    await pause(100);
    await click('[data-action="planning-return"]');
    await until(() => exec(`document.querySelector('.chatitem.selected')?.dataset.chat===${JSON.stringify(chosen[0].id)}`), 'return to planning');
    assert.equal(await exec(`document.querySelector('.chatitem.selected').closest('details').open`), true);
    assert.deepEqual(posts.slice(afterStimulusPosts), [], 'conversation selection after SSE must not POST');
    assert.deepEqual((await state()).sessions, populated.sessions);
    assert.deepEqual((await state()).evidence, populated.evidence);
    assert.deepEqual((await state()).learning.assessments, populated.learning.assessments);
    report.conversationGroups = { groups, actualConversationKinds: chosen.map(c => c.kind), selectedAutoOpens: true, genuineSseKeepsUserChoice: true, passiveRefreshKeepsSummaryFocus: true, nativeKeyboardDisclosure: true, noWrites: true };

    const today = await exec(`(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`);
    const scheduledTask = populated.sessions.find(session => session.goal_id === goal.id);
    const entry = await post('calendar', { title: scheduledTask.title, date: today, time: '10:00', duration: 30, session_id: scheduledTask.id });
    report.populatedCalendarFixture = { sessionId: scheduledTask.id, entryId: entry.id, date: today };
    const populatedDisplayPosts = posts.length;

    for (const width of [1366, 1024]) {
      main.setSize(width, 900);
      await pause(300);
      await click('nav [data-view="home"]');
      for (const tab of ['today','overview']) {
        await click(`[data-home-agenda="${tab}"]`);
        assert.equal(await exec(`document.querySelector('#home-agenda-${tab}').innerText.includes(${JSON.stringify(tab === 'today' ? scheduledTask.title : goal.title)})`), true, 'home screenshot displays actual populated ' + tab + ' records');
        const geometry = await exec(`(()=>{const r=document.querySelector('#discovery-input').getBoundingClientRect();return {viewport:innerWidth,width:document.documentElement.scrollWidth,visible:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}})()`);
        assert.ok(geometry.width <= geometry.viewport + 1, 'home no horizontal overflow at ' + width);
        assert.equal(geometry.visible, true, 'discovery composer visible at ' + width);
        const name = 'home-' + tab + '-' + width;
        await capture(name); report.screenshots.push(name + '.png');
        report.viewports.push({ windowWidth: width, view: 'home-' + tab, ...geometry });
      }
      await click('nav [data-view="chat"]');
      if (await exec(`document.querySelector('#conversation-list').hidden`)) await click('#chatlist-toggle');
      await exec(`document.querySelectorAll('.conversation-group').forEach(g=>g.open=true)`);
      await pause(300);
      const geometry = await exec(`(()=>{const r=document.querySelector('#message-input').getBoundingClientRect();return {viewport:innerWidth,width:document.documentElement.scrollWidth,visible:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}})()`);
      assert.ok(geometry.width <= geometry.viewport + 1, 'chat no horizontal overflow at ' + width);
      assert.equal(geometry.visible, true, 'chat composer visible at ' + width);
      const name = 'grouped-chat-' + width;
      await capture(name); report.screenshots.push(name + '.png');
      report.viewports.push({ windowWidth: width, view: 'chat', ...geometry });
    }
    report.version = (await state()).version;
    assert.deepEqual(posts.slice(populatedDisplayPosts), [], 'viewing populated home and chat panels must not POST');
    assert.deepEqual((await state()).sessions, populated.sessions);
    assert.deepEqual((await state()).evidence, populated.evidence);
    report.populatedDisplayNoWrites = true;
    assert.equal(await exec(`document.querySelector('#hoststatus').title.replace('主 Agent · ','AI 设置 · ')===document.querySelector('#hoststatus').textContent`), true, 'AI settings label retains original underlying status in tooltip');
    report.truthfulStatusTooltip = true;
    writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT, 'ui-navigation-result.json'), JSON.stringify(report, null, 2));
    console.log('UI_NAVIGATION_SMOKE_OK ' + JSON.stringify(report));
  } finally {
    main.webContents.debugger.off('message', listener);
    main.webContents.debugger.detach();
  }
};
