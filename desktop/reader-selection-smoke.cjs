const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
exports.run=async(main,base)=>{
 const exec=code=>main.webContents.executeJavaScript(code);
 const command=(action,args={})=>exec(`window.teacherDesktop.command(${JSON.stringify(action)},${JSON.stringify(args)})`);
 const api=(path,data)=>exec(`fetch('/api/'+${JSON.stringify(path)},${data===undefined?'{}':`{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(data)})}`}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error);return value;})`);
 async function until(fn,label){const end=Date.now()+25000;let error;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){error=e;}await new Promise(resolve=>setTimeout(resolve,75));}throw Error('等待超时：'+label+(error?' · '+error.message:''));}
 main.show();main.focus();
 await api('agents/configure',{role:'reading',mode:'UNCONFIGURED'});
 const alpha='Alpha passage belongs only to an explicit reading question.';
 const beta='Beta passage is a separate annotation target.';
 const resource=await api('resources',{title:'选文与阅读标记隔离测试',file:{name:'selection.md',base64:Buffer.from('# Selection chapter\n\n'+alpha+'\n\n'+beta).toString('base64')}});
 await exec(`window.teacherDesktop.openReader(${JSON.stringify(resource.id)})`);
 const frame=await until(()=>main.webContents.mainFrame.frames.find(f=>f.url.includes('/reader.html')),'阅读器框架');
 const ui=code=>frame.executeJavaScript(code);
 await until(async()=>{const snapshot=await command('snapshot');return snapshot?.content?.includes(beta);},'资料正文');
 const view=await until(()=>main.contentView.children.find(v=>v.webContents?.getURL().includes(resource.id)),'原生正文视图');
 const native=code=>view.webContents.executeJavaScript(code);
 await until(()=>ui(`document.querySelector('#reading-title').textContent.includes('隔离测试')`),'阅读侧栏加载');
 if(await ui(`document.querySelector('#reader-side').hidden`))await ui(`document.querySelector('#reader-side-toggle').click()`);
 // Record the real requests and responses while leaving fetch and persistence intact.
 await ui(`window.__selectionRequests=[];window.__selectionFetch=window.fetch;window.fetch=async function(input,options){const path=typeof input==='string'?input:input.url;const tracked=path.endsWith('/api/study/ask')||path.endsWith('/api/study/annotate');const record=tracked?{path,body:JSON.parse(options.body),done:false}:null;if(record)__selectionRequests.push(record);try{const response=await __selectionFetch.apply(this,arguments);if(record){record.status=response.status;record.ok=response.ok;record.done=true;}return response;}catch(error){if(record){record.done=true;record.error=error.message;}throw error;}};`);
 const preview=()=>ui(`({text:document.querySelector('#selection').textContent,clearHidden:document.querySelector('#clear-selection').hidden})`);
 const select=async text=>{
  assert.equal(await native(`(()=>{const element=[...document.querySelectorAll('p')].find(p=>p.textContent===${JSON.stringify(text)});if(!element)throw Error('Missing test passage');const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString();})()`),text);
  assert.equal(await command('selection'),text,'原生视图确实选中了目标段落');
 };
 const annotations=()=>api('reading-annotations?id='+encodeURIComponent(resource.id));
 const mark=async(kind,text,note)=>{
  const count=(await annotations()).length;await select(text);await ui(`document.querySelector('#${kind}').click()`);
  if(kind==='note'){await until(()=>ui(`document.querySelector('#note-dialog').open`),'笔记弹窗');await ui(`document.querySelector('#note-text').value=${JSON.stringify(note)};document.querySelector('#note-form').requestSubmit()`);}
  const rows=await until(async()=>{const rows=await annotations();return rows.length===count+1&&rows;},kind+' 保存');
  assert.ok(rows.some(a=>a.kind===kind&&a.quote===text&&(!note||a.note===note)),kind+' 持久化正确选文');
  if(kind!=='note')await until(()=>native(`!!CSS.highlights.get('teacher-${kind}')&&[...CSS.highlights.get('teacher-${kind}')].some(range=>range.toString()===${JSON.stringify(text)})`),'原生正文标记实际绘制');
 };
 const pin=async()=>{await select(alpha);await ui(`document.querySelector('#select-ask').click()`);await until(async()=>(await preview()).text===alpha,'显式选择提问');assert.equal((await preview()).clearHidden,false);};
 const ask=async(content,expected)=>{
  const before=await ui(`__selectionRequests.filter(r=>r.path.endsWith('/ask')).length`);
  await ui(`document.querySelector('#question').value=${JSON.stringify(content)};document.querySelector('#question').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#ask-form').requestSubmit()`);
  const request=await until(()=>ui(`__selectionRequests.filter(r=>r.path.endsWith('/ask'))[${before}]?.done&&__selectionRequests.filter(r=>r.path.endsWith('/ask'))[${before}]`),'实际提问请求');
  assert.equal(request.ok,true,'提问真实保存成功');assert.equal(request.body.selection,expected,'发送的选文只来自显式提问选择');
  await until(()=>ui(`document.querySelector('#messages').textContent.includes(${JSON.stringify(content)})&&!document.querySelector('#send').disabled`),'提问保存并恢复输入');
  const state=await api('state'),cid=state.study.chats.find(c=>c.resource_id===resource.id).conversation_id;
  assert.ok((await api('messages?conversation_id='+encodeURIComponent(cid))).some(m=>m.role==='user'&&m.content===content),'后端保留实际用户问题');
  assert.equal((await preview()).text,'','成功发送后显式选文清空');
  assert.equal((await preview()).clearHidden,true,'成功发送后清除按钮隐藏');
 };
 await mark('highlight',alpha);assert.deepEqual(await preview(),{text:'',clearHidden:true},'高亮不得注入提问选文');
 await mark('underline',beta);assert.deepEqual(await preview(),{text:'',clearHidden:true},'划线不得注入提问选文');
 await mark('note',beta,'独立阅读笔记');assert.deepEqual(await preview(),{text:'',clearHidden:true},'笔记不得注入提问选文');
 await pin();
 await mark('highlight',beta);assert.equal((await preview()).text,alpha,'高亮另一段保留已选提问原文');
 await mark('underline',beta);assert.equal((await preview()).text,alpha,'划线另一段保留已选提问原文');
 await mark('note',beta,'保留提问引用的笔记');assert.equal((await preview()).text,alpha,'保存笔记保留已选提问原文');
 await native('getSelection().removeAllRanges()');
 const beforeNoSelection=new Set((await annotations()).map(a=>a.id));
 await ui(`document.querySelector('#status').textContent='';window.__noSelectionRequestStart=__selectionRequests.length;document.querySelector('#highlight').click()`);
 await until(()=>ui(`document.querySelector('#status').textContent||__selectionRequests.slice(__noSelectionRequestStart).some(r=>r.done)`),'无原生选文的标记完成');
 const afterNoSelection=await annotations();assert.ok(!afterNoSelection.filter(a=>!beforeNoSelection.has(a.id)).some(a=>a.quote===alpha),'无选文标记不得复用提问原文');
 assert.ok(await ui(`!__selectionRequests.slice(__noSelectionRequestStart).some(r=>r.body.quote===${JSON.stringify(alpha)})`),'标记请求不得使用过期提问原文');
 assert.equal((await preview()).text,alpha,'无选文标记不影响提问引用');
 await select(beta);await ui(`document.querySelector('#clear-selection').click()`);
 assert.deepEqual(await preview(),{text:'',clearHidden:true});
 assert.equal(await command('selection'),beta,'清空提问选文时原生正文仍选中另一段');
 await ask('清除引用后只问当前位置','');
 await pin();await select(beta);await ask('显式引用 Alpha 提问',alpha);
 await ask('发送后的第二次提问不沿用引用','');
 const annotationCountBeforeContext=(await annotations()).length;
 const contextTabId=await ui(`document.querySelector('[data-tab].active').dataset.tab`);
 main.webContents.send('reader:selection',{tabId:contextTabId,text:alpha});
 await until(async()=>(await preview()).text===alpha,'右键提问传输事件固定原文');
 assert.equal((await annotations()).length,annotationCountBeforeContext,'右键提问事件不创建标记');
 await ui(`document.querySelector('#clear-selection').click()`);
 const requests=await ui('__selectionRequests');
 const state=await api('state');assert.equal(state.evidence.length,0,'阅读操作不生成能力证据');
 assert.equal(await ui("document.querySelector('#status').textContent"),'','成功操作后移除先前缺少选文的提示');
 const output=process.env.TEACHER_SMOKE_OUTPUT;mkdirSync(output,{recursive:true});
 main.show();main.focus();
 await command('overlay',{visible:true});
 try{writeFileSync(join(output,'reader-selection.png'),(await until(()=>main.webContents.capturePage(),'阅读侧栏截图')).toPNG());}finally{await command('overlay',{visible:false});}
 writeFileSync(join(output,'reader-selection-content.png'),(await until(()=>view.webContents.capturePage(),'原生正文截图')).toPNG());
 const result={markingDoesNotPin:true,pinnedQuoteSurvivesOtherMarks:true,noStaleQuoteOnMark:true,clearPreventsNativeFallback:true,explicitQuoteConsumedOnce:true,annotations:(await annotations()).length,askSelections:requests.filter(r=>r.path.endsWith('/ask')).map(r=>r.body.selection),actualMessagesPersisted:true,contextMenuTransportPinsQuote:true,modelsUnconfigured:true};
 writeFileSync(join(output,'reader-selection-result.json'),JSON.stringify(result,null,2));console.log('READER_SELECTION_SMOKE_OK '+JSON.stringify(result));
};
