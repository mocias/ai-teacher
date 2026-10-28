const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
exports.run=async(main,base)=>{
 main.showInactive();const exec=code=>main.webContents.executeJavaScript(code);
 const until=async(check,label)=>{const end=Date.now()+(process.env.TEACHER_REGISTRY_SMOKE==='1'?45000:15000);while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,75));}throw Error('Model picker timed out: '+label);};
 const post=(path,body)=>exec(`fetch('/api/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v;})`);
 if(process.env.TEACHER_REGISTRY_SMOKE==='1'){
  await post('agents/configure',{role:'master',mode:'MCP',harness:'DSH'});
  await main.loadURL(base+'/agents.html');
  await until(()=>exec(`!!document.querySelector('.dsh-model-picker option[value="qoder-cn/Auto"]')`),'installed Qoder catalog');
  const catalog=await exec(`fetch('/api/agents/dsh-models').then(r=>r.json())`);assert.equal(catalog.discovery,'runtime');assert.equal(catalog.diagnostics.length,0,JSON.stringify(catalog.diagnostics));
  await exec(`(()=>{const select=document.querySelector('.dsh-model-picker select');select.value='qoder-cn/Auto';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(()=>exec(`!!document.querySelector('.dsh-model-picker select:not(:disabled)')&&document.querySelector('.dsh-model-picker select').value==='qoder-cn/Auto'`),'Qoder saved');
  await main.loadURL(base+'/agents.html');await until(()=>exec(`document.querySelector('.dsh-model-picker select')?.value==='qoder-cn/Auto'`),'Qoder persisted');
  const state=await exec(`fetch('/api/state').then(r=>r.json())`);assert.equal(state.agents.runs.length,0);assert.equal(state.goals.length,0);
  const report={runtimeCatalog:true,models:catalog.models.length,providers:[...new Set(catalog.models.map(m=>m.provider))],qoderSelected:true,reloadPersisted:true,noModelRequests:true};
  if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'model-picker-result.json'),JSON.stringify(report,null,2));
  console.log('MODEL_PICKER_SMOKE_OK '+JSON.stringify(report));return;
 }
 const home=process.env.DSH_HOME;assert.ok(home.includes('teacher-desktop-smoke-'));mkdirSync(join(home,'profiles','desktop'),{recursive:true});
 writeFileSync(join(home,'profiles','desktop','cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'local-picker',model:'one'}},{id:'llm-pi-ai',config:{providers:{'local-picker':{api:'anthropic-messages',baseURL:'http://127.0.0.1:9',apiKeyEnv:'TEACHER_DSH_TEST_KEY',models:[{id:'one',name:'模型一'},{id:'smart/two',name:'模型二'}]}}}}]));
 for(const role of ['master','chat','reading'])await post('agents/configure',{role,mode:'MCP',harness:'DSH'});
 // Create the onboarding conversation without running any model.
 await post('agents/configure',{role:'onboarding',mode:'MCP',harness:'MANUAL'});
 const intro=await post('study/onboarding',{action:'start',request_id:crypto.randomUUID()});
 const introJobs=await exec(`fetch('/api/state').then(r=>r.json()).then(s=>s.jobs.filter(j=>j.conversation_id==='${intro.conversation_id}'&&j.status==='QUEUED'))`);
 for(const job of introJobs)await post('jobs/cancel',{id:job.id});
 await post('agents/configure',{role:'onboarding',mode:'MCP',harness:'DSH'});
 const goal=await post('goals',{title:'模型选择验收',domain:'隔离测试'});
 const pick=async(run=exec)=>{await until(()=>run(`!!document.querySelector('.dsh-model-picker select option[value="local-picker/smart/two"]')`),'choices visible');await run(`(()=>{const select=document.querySelector('.dsh-model-picker select');select.value='local-picker/smart/two';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>run(`!!document.querySelector('.dsh-model-picker select:not(:disabled)')&&document.querySelector('.dsh-model-picker select').value==='local-picker/smart/two'`),'selection retained');};
 await main.loadURL(base+'/agents.html');await pick();const master=await post('agents/conversation',{});
 await main.loadURL(base);await pick();
 await exec(`document.querySelector('[data-view="chat"]').click()`);await pick();
 await main.loadURL(base+'/personal.html?conversation='+intro.conversation_id);await pick();
 await main.loadURL(base+'/?view=models');await until(()=>exec(`!!document.querySelector('[data-action="agent-configure"][data-id="chat"]')`),'settings');
 await exec(`document.querySelector('[data-action="agent-configure"][data-id="chat"]').click()`);await until(()=>exec(`!!document.querySelector('#agent-dsh-model option[value="local-picker/smart/two"]')`),'function catalog');
 await exec(`document.querySelector('#agent-dsh-model').value='local-picker/smart/two';document.querySelector('#editor button[type=submit]').click();`);
 await until(()=>exec(`fetch('/api/state').then(r=>r.json()).then(s=>s.agents.routes.find(r=>r.role==='chat').model==='local-picker/smart/two')`),'function choice saved');
 const resource=await post('resources',{title:'模型选择阅读资料',file:{name:'model-picker.md',base64:Buffer.from('# 阅读页\n\n隔离验收内容。').toString('base64')}});
 await exec(`window.teacherDesktop.openReader(${JSON.stringify(resource.id)})`);
 let frame;await until(()=>{frame=main.webContents.mainFrame.frames.find(f=>f.url.includes('/reader.html'));return !!frame;},'reader frame');const run=code=>frame.executeJavaScript(code);await pick(run);
 const state=await exec(`fetch('/api/state').then(r=>r.json())`);assert.equal(state.agents.dsh_conversation_models.length,5);assert.ok(state.agents.dsh_conversation_models.every(row=>row.model==='local-picker/smart/two'));assert.equal(state.agents.runs.length,0,'choosing models must not launch a model');
 await main.loadURL(base+'/agents.html');await until(()=>exec(`document.querySelector('.dsh-model-picker select')?.value==='local-picker/smart/two'`),'reload persistence');
 main.setMinimumSize(360,500);await main.webContents.debugger.attach('1.3');
 try{await main.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:420,height:760,deviceScaleFactor:1,mobile:false});await exec(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);assert.equal(await exec(`document.documentElement.scrollWidth>innerWidth`),false);assert.ok(await exec(`document.querySelector('#send').getBoundingClientRect().bottom<=innerHeight`));}
 finally{await main.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');main.webContents.debugger.detach();}
 const result={master:true,discovery:true,teacher:true,onboarding:true,reader:true,functionDefaults:true,reloadPersisted:true,narrowComposerVisible:true,noModelRequests:true};
 if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'model-picker-result.json'),JSON.stringify(result,null,2));
 console.log('MODEL_PICKER_SMOKE_OK '+JSON.stringify(result));
};
