const assert=require('node:assert/strict');

exports.run=async({main,base,exec,post,chatTool,until})=>{
 const failures=[];
 const answer=async(cid,content)=>{
  const {job}=await chatTool('teacher_claim_message',{conversation_id:cid});
  assert.ok(job);await chatTool('teacher_reply',{job_id:job.id,lease_token:job.lease_token,content,request_id:crypto.randomUUID()});
 };
 for(const home of [true,false]){
  const name=home?'目标讨论':'Teacher 对话';
  const cid=home?(await post('discussions',{request_id:crypto.randomUUID()})).conversation_id:(await post('goals',{title:'长对话滚动验证',domain:'测试'})).conversation.id;
  for(let turn=1;turn<=9;turn++){
   await post('messages',{conversation_id:cid,content:'第 '+turn+' 次提问',request_id:crypto.randomUUID()});
   await answer(cid,('第 '+turn+' 轮讲解。\n\n').repeat(4)+'这一轮结束');
  }
  await main.loadURL(home?base:base+'/?view=chat&conversation_id='+cid);
  if(home){
   await until(()=>exec(`!!document.querySelector('#discussion-select option[value="${cid}"]')`),'目标讨论可切换');
   await exec(`(()=>{const s=document.querySelector('#discussion-select');s.value='${cid}';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  const list=home?'.discovery-messages':'.messages';
  await until(()=>exec(`document.querySelector(${JSON.stringify(list)})?.innerText.includes('第 9 轮讲解')`),name+' 加载历史');
  const listExpr=`document.querySelector(${JSON.stringify(list)})`;
  const position=()=>exec(`(()=>{const l=${listExpr};return {top:l.scrollTop,gap:l.scrollHeight-l.clientHeight-l.scrollTop};})()`);
  const checkBottom=async(label)=>{
   await exec('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');
   const pos=await position();if(pos.gap>2)failures.push({name,label,...pos});
  };
  await checkBottom('打开长历史');
  await exec(`${listExpr}.scrollTo({top:1e7,behavior:'instant'})`);
  await exec(`window.dispatchEvent(new Event('dsh-model-changed'))`);await new Promise(r=>setTimeout(r,350));
  await checkBottom('底部收到界面刷新');
  await exec(`${listExpr}.scrollTo({top:175,behavior:'instant'})`);
  await exec(`window.dispatchEvent(new Event('dsh-model-changed'))`);await new Promise(r=>setTimeout(r,350));
  const reading=await position();if(Math.abs(reading.top-175)>2)failures.push({name,label:'上翻位置',...reading});
  const input=home?'#discovery-input':'#message-input';
  await exec(`(()=>{const x=document.querySelector('${input}');x.focus({preventScroll:true});x.value='我发出的下一轮';x.dispatchEvent(new Event('input',{bubbles:true}));x.form.requestSubmit();})()`);
  await until(()=>exec(`${listExpr}.innerText.includes('我发出的下一轮')`),'发送显示');
  await checkBottom('从历史发送');
  const replyTo=await exec(`Array.from(${listExpr}.querySelectorAll('.message.user')).at(-1).dataset.messageId`);
  const preview=async revision=>{const row={conversation_id:cid,job_id:'scroll-'+cid,run_id:'scroll-'+cid,reply_to:replyTo,status:'GENERATING',revision,content:'分段回复。\n\n'.repeat(12*revision)};
   await exec(`import('/live-events.js').then(({liveEvents})=>liveEvents.dispatchEvent(new MessageEvent('reply-stream',{data:${JSON.stringify(JSON.stringify(row))}})))`);
   await until(()=>exec(`!!${listExpr}.querySelector('[data-reply-preview][data-signature="${revision}:GENERATING"]')`),'分段回复已绘制');
  };
  await preview(1);await checkBottom('跟随分段回复');
  await exec(`${listExpr}.scrollTo({top:175,behavior:'instant'})`);await preview(2);
  const whileStreaming=await position();if(Math.abs(whileStreaming.top-175)>2)failures.push({name,label:'分段回复期间上翻',...whileStreaming});
  await exec(`${listExpr}.scrollTo({top:1e7,behavior:'instant'})`);
  await answer(cid,'最新回复。\n\n'.repeat(25)+'尾部标记');
  await until(()=>exec(`${listExpr}.innerText.includes('尾部标记')`),'长回复显示');await checkBottom('收到长回复');
 }
 assert.deepEqual(failures,[],'对话打开、发送和收到回复应停在底部，后台更新应保留历史阅读位置');
};
