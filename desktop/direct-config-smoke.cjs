const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {once}=require('node:events');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
exports.run=async(main,base)=>{
 const exec=code=>main.webContents.executeJavaScript(code),post=(path,body)=>exec(`fetch('/api/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v;})`);
 const until=async check=>{for(let i=0;i<180;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Direct configuration UI timed out');};
 let profile,calls=0;
 const mock=createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);calls++;assert.ok(body.tools.some(t=>t.function.name==='teacher_set_agent_configuration'));
  const used=body.messages.filter(m=>m.role==='tool');let message;
  const call=(name,args)=>({role:'assistant',tool_calls:[{id:'tool-'+calls,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  if(!used.length)message=call('teacher_get_agent_configuration',{});
  else if(used.length===1){const config=JSON.parse(used[0].content);message=call('teacher_set_agent_configuration',{revision:config.revision,summary:'已按要求配置两个功能',routes:[{role:'chat',mode:'API',profile_id:profile.id},{role:'reading',mode:'MCP',harness:'CODEX'}]});}
  else{assert.equal(JSON.parse(used.at(-1).content).status,'APPLIED');message={role:'assistant',content:'已直接设置普通对话与阅读答疑，配置已经生效。'};}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message}]}));
 });mock.listen(0,'127.0.0.1');await once(mock,'listening');
 try{
  profile=await post('models/profile',{name:'配置测试',base_url:'http://127.0.0.1:'+mock.address().port+'/v1',model:'local-config-test',key:'',options:{}});
  await post('agents/configure',{role:'master',mode:'API',profile_id:profile.id});await main.loadURL(base+'/agents.html');
  await until(()=>exec(`!document.querySelector('#send').disabled`));await exec(`document.querySelector('#content').value='请直接设置普通对话和阅读答疑';document.querySelector('#send').click()`);
  await until(()=>exec(`document.querySelector('#messages').textContent.includes('配置已经生效')`));
  await main.loadURL(base+'/?view=models');await until(()=>exec(`!!document.querySelector('#configuration-history [data-action="agent-undo-configuration"]')`));
  let state=await exec(`fetch('/api/state').then(r=>r.json())`);assert.equal(state.agents.proposals.length,0);assert.equal(state.agents.routes.find(r=>r.role==='chat').profile_id,profile.id);assert.equal(state.agents.routes.find(r=>r.role==='reading').harness,'CODEX');
  await exec(`document.querySelector('[data-action="agent-undo-configuration"]').click()`);await until(()=>exec(`document.querySelector('#configuration-history')?.textContent.includes('已撤销')`));
  state=await exec(`fetch('/api/state').then(r=>r.json())`);assert.equal(state.agents.routes.find(r=>r.role==='chat').mode,'UNCONFIGURED');assert.equal(state.agents.routes.find(r=>r.role==='reading').mode,'UNCONFIGURED');
  const result={directToolExecuted:true,noConfirmationRequired:true,appliedVisible:true,undoFromUI:true,calls,localMock:true};if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'direct-config-result.json'),JSON.stringify(result,null,2));console.log('DIRECT_CONFIG_SMOKE_OK '+JSON.stringify(result));
 }finally{await post('models/enabled',{enabled:false});mock.closeAllConnections();await new Promise(r=>mock.close(r));}
};
