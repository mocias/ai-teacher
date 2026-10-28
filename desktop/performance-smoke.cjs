const assert=require('node:assert/strict');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
exports.run=async(main,base)=>{
 main.showInactive();main.setMinimumSize(360,500);main.setSize(1280,800);
 const exec=code=>main.webContents.executeJavaScript(code).catch(error=>{throw Error(error.message+' · '+code.slice(0,100));});
 const until=async(check,label)=>{const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error('等待超时：'+label);};
 const post=(path,body)=>exec(`fetch('/api/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v;})`);
 const requests=[];
 const painted=()=>exec(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
 main.webContents.debugger.attach('1.3');
 const record=(_event,method,params)=>{if(method==='Network.requestWillBeSent'&&params.request.url.startsWith(base+'/api/'))requests.push(new URL(params.request.url).pathname);};
 main.webContents.debugger.on('message',record);await main.webContents.debugger.sendCommand('Network.enable');
 await main.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 try{
  await main.loadURL(base);await until(()=>exec(`!!document.querySelector('#discovery-input')`),'homepage');
  await new Promise(r=>setTimeout(r,300));
  const startup=requests.slice();assert.equal(startup.filter(p=>p==='/api/events').length,1,'only one SSE connection per document');assert.equal(startup.filter(p=>p==='/api/state').length,1);assert.equal(startup.filter(p=>p==='/api/messages').length,1);
  await exec(`window.keptComposer=document.querySelector('#discovery-input');window.keptComposer.value='等待时保留草稿';window.keptComposer.focus();window.keptComposer.setSelectionRange(2,5);`);
  const before=requests.length;
  await exec(`import('/live-events.js').then(({liveEvents})=>{for(let i=0;i<20;i++)liveEvents.dispatchEvent(new MessageEvent('message',{data:'changed'}));})`);
  await until(()=>Promise.resolve(requests.length>=before+2),'coalesced refresh');await new Promise(r=>setTimeout(r,200));
  assert.equal(requests.slice(before).filter(p=>p==='/api/state').length,1,'burst must coalesce');
  assert.equal(await exec(`document.querySelector('#discovery-input')===window.keptComposer`),true,'unchanged background state must preserve DOM');
  assert.equal(await exec(`document.querySelector('#discovery-input').value`),'等待时保留草稿');
  assert.deepEqual(await exec(`[document.activeElement.selectionStart,document.activeElement.selectionEnd]`),[2,5]);
  const idle=requests.length;await new Promise(r=>setTimeout(r,16000));assert.equal(requests.length,idle,'healthy idle page must not poll');
  const goal=await post('goals',{title:'性能验收目标',domain:'隔离测试',scope:'仅用于界面验收'});
  await until(()=>exec(`document.querySelector('.home-goals').textContent.includes('性能验收目标')`),'new goal update');
  const routes=['chat','journey','plan','learning','review','resources','notes','profile','models','settings','home'];const timings={};
  for(const route of routes){
   timings[route]=await exec(`(()=>{const start=performance.now();document.querySelector('[data-view="${route}"]').click();return Math.round(performance.now()-start);})()`);
   await new Promise(r=>setTimeout(r,150));
   assert.equal(await exec(`document.documentElement.scrollWidth>innerWidth`),false,'overflow in '+route);
  }
  // Delay one conversation, then switch: its late result must never replace the selected chat.
  const second=await post('conversations',{goal_id:goal.goal.id,title:'第二段对话'});
  await post('messages',{conversation_id:goal.conversation.id,content:'第一段对话的独有文字',request_id:crypto.randomUUID()});
  await post('messages',{conversation_id:second.id,content:'第二段对话的独有文字',request_id:crypto.randomUUID()});
  await until(()=>exec(`document.querySelector('.home-goals').textContent.includes('性能验收目标')`),'state ready');
  await exec(`document.querySelector('[data-view="chat"]').click()`);
  await until(()=>exec(`!!document.querySelector('[data-chat="${second.id}"]')`),'chat list');
  await exec(`window.originalFetch=window.fetch;window.fetch=async(...args)=>{const result=await window.originalFetch(...args);if(String(args[0]).includes('messages?conversation_id=${goal.conversation.id}'))await new Promise(r=>setTimeout(r,250));return result;};document.querySelector('[data-chat="${goal.conversation.id}"]').click();setTimeout(()=>document.querySelector('[data-chat="${second.id}"]').click(),30);`);
  await until(()=>exec(`document.querySelector('.messages')?.textContent.includes('第二段对话的独有文字')`),'selected conversation wins');
  assert.equal(await exec(`document.querySelector('.messages').textContent.includes('第一段对话的独有文字')`),false);await exec(`void(window.fetch=window.originalFetch)`);
  await exec(`document.querySelector('[data-view="home"]').click()`);await new Promise(r=>setTimeout(r,200));
  const composer=await exec(`({bottom:document.querySelector('#discovery-composer').getBoundingClientRect().bottom,height:innerHeight})`);assert.ok(composer.bottom<=composer.height,'composer must fit desktop viewport');
  await painted();if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'workspace-wide.png'),(await main.webContents.capturePage()).toPNG());
  await main.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:560,height:760,deviceScaleFactor:1,mobile:false});await painted();assert.ok(await exec(`innerWidth<=560`),'test must actually use a narrow viewport');assert.equal(await exec(`document.documentElement.scrollWidth>innerWidth`),false,'narrow layout');
  if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'workspace-narrow.png'),(await main.webContents.capturePage()).toPNG());
  const result={oneEventConnection:true,startupRequests:startup,burstCoalesced:true,unchangedDOMPreserved:true,idleRequests:0,idleSeconds:16,conversationRaceProtected:true,desktopComposerVisible:true,narrowLayout:true,routeRenderMs:timings};
  if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'performance-result.json'),JSON.stringify(result,null,2));
  console.log('PERFORMANCE_SMOKE_OK '+JSON.stringify(result));
 }finally{await main.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');main.webContents.debugger.removeListener('message',record);main.webContents.debugger.detach();}
};
