const assert=require('node:assert/strict');
const http=require('node:http');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');

// Real local HTTP model, real executor and browser controls; no paid model or user library.
exports.run=async({main,exec,execFrame,post,until,capture,cid})=>{
 const state=()=>exec(main,`fetch('/api/state').then(r=>r.json())`);
 const messages=()=>exec(main,`fetch('/api/messages?conversation_id=${cid}').then(r=>r.json())`);
 const click=selector=>execFrame(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const ask=content=>execFrame(`document.querySelector('#question').value=${JSON.stringify(content)};document.querySelector('#question').dispatchEvent(new Event('input'));document.querySelector('#ask-form').requestSubmit()`);
 await until(()=>execFrame(`document.querySelector('#reading-jobs').textContent.includes('尚未配置')`),'未配置阅读答疑提示');
 const original=(await state()).jobs.find(j=>j.conversation_id===cid);
 await execFrame(`document.querySelector('#question').value='保留这条未发送的问题';document.querySelector('#question').dispatchEvent(new Event('input'))`);
 await click('[data-job-action="configure"]');
 await until(()=>exec(main,`document.querySelector('#embedded-reader').hidden && document.querySelector('#crumb').textContent.includes('模型与分工')`),'阅读器直达功能配置');
 assert.ok(main.contentView.children.filter(v=>v.webContents!==main.webContents).every(v=>!v.getVisible()));
 await exec(main,`document.querySelector('[data-view="reader"]').click()`);
 await until(()=>execFrame(`document.querySelector('#question').value==='保留这条未发送的问题' && document.querySelector('#position').textContent==='First chapter'`),'配置往返保留草稿和章节');
 let calls=0;const requests=[],pending=[];
 const server=http.createServer((req,res)=>{
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
  let body='';req.on('data',b=>body+=b);req.on('end',()=>{
   requests.push(JSON.parse(body));calls++;
   if(calls===1){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"isolated failure"}');}
   else pending.push(res);
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const answer=(res,content)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content}}]}));};
 try{
  const profile=await post('models/profile',{name:'隔离阅读模型',base_url:`http://127.0.0.1:${server.address().port}/v1`,model:'reader-smoke'});
  await post('agents/configure',{role:'reading',mode:'API',profile_id:profile.id});
  await click('[data-job-action="retry"]');
  await until(()=>execFrame(`document.querySelector('#reading-jobs').textContent.includes('HTTP 503') && !!document.querySelector('[data-job-action="retry"]')`),'失败后在阅读器显示重试');
  const other=await post('resources',{title:'隔离标签',file:{name:'other.md',base64:Buffer.from('# Another document\n\nIndependent reading tab.').toString('base64')}});
  await exec(main,`window.teacherDesktop.openReader('${other.id}')`);
  await until(()=>execFrame(`document.querySelector('#position').textContent==='Another document' && !document.querySelector('.reading-job') && !document.querySelector('#messages').textContent.includes('请解释这段文字')`),'其他标签不显示当前问题和失败状态');
  await execFrame(`document.querySelector('#question').value='另一标签的草稿';document.querySelector('#question').dispatchEvent(new Event('input'));document.querySelectorAll('[data-tab]')[0].click()`);
  await until(()=>execFrame(`document.querySelector('#reading-jobs').textContent.includes('HTTP 503') && document.querySelector('#question').value==='保留这条未发送的问题'`),'切回原问题与草稿');
  await execFrame(`document.querySelectorAll('[data-tab]')[1].click()`);
  await until(()=>execFrame(`document.querySelector('#question').value==='另一标签的草稿' && !document.querySelector('.reading-job')`),'另一标签草稿独立');
  await execFrame(`document.querySelectorAll('[data-close]')[1].click()`);
  await until(()=>execFrame(`document.querySelectorAll('[data-tab]').length===1 && document.querySelector('#reading-jobs').textContent.includes('HTTP 503')`),'关闭标签恢复原问题');
  const output=process.env.TEACHER_SMOKE_OUTPUT;mkdirSync(output,{recursive:true});writeFileSync(join(output,'reader-retry.png'),await capture(main));
  await click('[data-job-action="retry"]');
  await until(()=>pending.length===1,'重试请求发出');
  await until(()=>execFrame(`document.querySelector('#reading-jobs').textContent.includes('正在回答') && !document.querySelector('#reading-jobs').textContent.includes('HTTP 503')`),'重试运行时移除过期错误');
  answer(pending.shift(),'已根据原始阅读快照恢复回答。');
  await until(()=>execFrame(`document.querySelector('#messages').textContent.includes('已根据原始阅读快照恢复回答。') && !document.querySelector('.reading-job')`),'重试成功清除等待状态');
  const rows=await messages();assert.equal(rows.filter(m=>m.role==='user').length,1);assert.equal(rows.filter(m=>m.role==='assistant').length,1);
  const recovered=await state();assert.equal(recovered.jobs.find(j=>j.id===original.id).status,'COMPLETED');assert.equal(recovered.models.runs.find(r=>r.job_id===original.id).status,'COMPLETED');assert.equal(calls,2);
  assert.ok(requests.every(r=>JSON.stringify(r.messages).includes('Reading sample text.')),'重试使用原始阅读正文');
  assert.equal(await execFrame(`document.querySelector('#question').value`),'保留这条未发送的问题');
  await post('models/enabled',{enabled:false});await ask('取消尚未处理的问题');
  await until(()=>execFrame(`document.querySelector('#reading-jobs').textContent.includes('API 已暂停')`),'暂停状态说明');
  await click('[data-job-action="cancel"]');
  await until(()=>execFrame(`!document.querySelector('.reading-job') && document.querySelector('#messages').textContent.includes('已取消处理')`),'取消排队问题');
  assert.equal(calls,2,'取消排队不调用模型');
  await post('models/enabled',{enabled:true});await ask('取消正在回答的问题');
  await until(()=>pending.length===1,'正在执行的请求');
  await until(()=>execFrame(`document.querySelector('#reading-jobs').textContent.includes('正在回答')`),'运行中的取消入口');
  await click('[data-job-action="cancel"]');
  await until(()=>execFrame(`!document.querySelector('.reading-job')`),'取消执行中的问题');
  answer(pending.shift(),'不应写回的迟到回复');
  await until(async()=>{const s=await state();return s.models.runs.every(r=>r.status!=='RUNNING');},'取消任务收尾');
  assert.ok(!(await messages()).some(m=>m.content.includes('不应写回')));
  const final=await state();assert.equal(final.evidence.length,0);assert.equal(final.jobs.filter(j=>j.conversation_id===cid&&j.status==='CANCELLED').length,2);
  console.log('READER_RECOVERY_OK '+JSON.stringify({configureReturn:true,draftPreserved:true,tabIsolation:true,apiFailureRetry:true,noDuplicateMessage:true,queuedCancel:true,runningCancel:true,lateReplyDiscarded:true}));
 }finally{await post('models/enabled',{enabled:false});for(const res of pending)res.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
};
