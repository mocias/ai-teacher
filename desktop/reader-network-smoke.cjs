const assert=require('node:assert/strict');
const http=require('node:http');
const {app,BrowserWindow,session}=require('electron');
const {readFileSync,mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');

exports.run=async(main)=>{
 const exec=code=>main.webContents.executeJavaScript(code);
 const command=(action,args={})=>exec(`window.teacherDesktop.command(${JSON.stringify(action)},${JSON.stringify(args)})`);
 const api=(path,data)=>exec(`fetch('/api/${path}',${data===undefined?'{}':`{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(data)})}`}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v;})`);
 async function until(fn,label){const end=Date.now()+25000;let error;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){error=e;}await new Promise(resolve=>setTimeout(resolve,75));}throw Error('等待超时：'+label+(error?' · '+error.message:''));}
 const sockets=new Set();let directRequests=0,proxyRequests=0;
 const origin=http.createServer((req)=>{directRequests++;req.socket.destroy();});
 const proxy=http.createServer((req,res)=>{
  if(new URL(req.url).hostname!=='reader-probe.invalid'){res.writeHead(502);res.end('Unexpected proxy target');return;}
  proxyRequests++;
  if(proxyRequests===1){req.socket.destroy();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end('<title>Proxy fixture lesson</title><main><h1>Proxy recovered chapter</h1><p>READER_PROXY_FIXTURE_SUCCESS</p></main>');
 });
 for(const server of [origin,proxy])server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await Promise.all([listen(origin),listen(proxy)]);
 try{
  await api('agents/dsh-network',{proxy_url:'http://127.0.0.1:'+proxy.address().port});
  const md=await api('resources',{title:'Network control local fixture',file:{name:'network.md',base64:Buffer.from('# Local fixture\n\nLOCAL_READER_FIXTURE').toString('base64')}});
  await exec(`window.teacherDesktop.openReader(${JSON.stringify(md.id)})`);
  const frame=await until(()=>main.webContents.mainFrame.frames.find(f=>f.url.includes('/reader.html')),'阅读器框架');
  const ui=code=>frame.executeJavaScript(code);
  await until(async()=>{const snapshot=await command('snapshot');return snapshot?.content?.includes('LOCAL_READER_FIXTURE');},'本地资料加载');
  assert.ok(await ui(`document.querySelector('#reader-proxy').hidden`),'本地资料隐藏代理开关');
  const url='http://reader-probe.invalid:'+origin.address().port+'/lesson';
  const originalRoute=await session.defaultSession.resolveProxy(url);
  const before=await api('state');
  await command('new',{url});
  await until(()=>ui(`document.querySelector('#reader-network-error').textContent.includes('页面加载失败')`),'显示原始加载失败信息');
  assert.ok(directRequests>0,'默认路径必须直达模拟源站');assert.equal(proxyRequests,0,'启用前不能使用已配置代理');
  assert.ok(await ui(`!document.querySelector('#reader-proxy').hidden`));
  const tab=await ui(`document.querySelector('[data-tab].active').dataset.tab`);
  const count=await ui(`document.querySelectorAll('[data-tab]').length`);
  await ui(`document.querySelector('#question').value='保留这一条未发送的问题';document.querySelector('#question').dispatchEvent(new Event('input',{bubbles:true}))`);
  await assert.rejects(command('snapshot',{tabId:tab}),'错误页不得成为阅读快照');
  let state=await api('state');
  assert.deepEqual(state.study.progress.filter(p=>state.resources.find(r=>r.id===p.resource_id)?.url===url),[],'失败页面不能保存阅读进度');
  await ui(`document.querySelector('#reader-proxy').click()`);
  await until(async()=>{const snapshot=await command('snapshot',{tabId:tab});return snapshot?.content?.includes('READER_PROXY_FIXTURE_SUCCESS');},'授权后代理恢复正文');
  await until(()=>ui(`document.querySelector('#reader-proxy').textContent.includes('系统网络')`),'恢复系统网络按钮');
  await until(()=>ui(`!document.querySelector('#reader-network-error').textContent.trim()`),'清除旧网络错误');
  assert.equal(await ui(`document.querySelector('[data-tab].active').dataset.tab`),tab,'恢复使用同一标签');
  assert.equal(await ui(`document.querySelectorAll('[data-tab]').length`),count,'恢复不能新建标签');
  assert.equal(await ui(`document.querySelector('#question').value`),'保留这一条未发送的问题','恢复保留未发送草稿');
  assert.ok(proxyRequests>=2,'已选择的代理遇到首次断线后恢复正文');
  assert.equal(await session.defaultSession.resolveProxy(url),originalRoute,'本地工作台会话沿用原网络设置');
  assert.equal(await session.fromPartition('persist:teacher-reading').resolveProxy('http://127.0.0.1:'+origin.address().port),'DIRECT','阅读器访问本机地址保持直连');
  await until(async()=>{state=await api('state');return state.study.progress.some(p=>state.resources.find(r=>r.id===p.resource_id)?.url===url&&p.location==='Proxy recovered chapter');},'成功正文保存进度');
  assert.equal(state.evidence.length,before.evidence.length,'阅读不产生能力证据');
  const config=JSON.parse(readFileSync(join(app.getPath('userData'),'desktop.json'),'utf8'));
  assert.equal(config.readerUseProxy,true,'代理选择持久化');
  assert.equal(BrowserWindow.getAllWindows().length,1);
  await ui(`document.querySelector('#reader-proxy').click()`);
  await until(()=>ui(`document.querySelector('#reader-network-error').textContent.includes('页面加载失败')`),'切回系统网络后重新直连');
  assert.ok(directRequests>1);
  assert.equal(JSON.parse(readFileSync(join(app.getPath('userData'),'desktop.json'),'utf8')).readerUseProxy,false);
  assert.equal(await session.fromPartition('persist:teacher-reading').resolveProxy(url),originalRoute);
  let live=null;
  if(process.env.TEACHER_READER_LIVE_URL){
   assert.ok(process.env.TEACHER_READER_LIVE_PROXY,'真实网页检查必须明确提供代理');
   // The fixture deterministically fails without the proxy. The public site's
   // availability over the system network can vary from one run to another.
   await ui(`document.querySelector('#reader-proxy').click()`);
   await until(async()=>{const value=await command('snapshot',{tabId:tab});return value?.content?.includes('READER_PROXY_FIXTURE_SUCCESS');},'重新启用代理');
   await api('agents/dsh-network',{proxy_url:process.env.TEACHER_READER_LIVE_PROXY});
   await ui(`document.querySelector('#address').value=${JSON.stringify(process.env.TEACHER_READER_LIVE_URL)};document.querySelector('#address-form').requestSubmit()`);
   live=await until(async()=>{const value=await command('snapshot');return value?.url?.split('#')[0]===process.env.TEACHER_READER_LIVE_URL&&value.content?.trim().length>0?value:null;},'通过阅读器代理获取真实网页正文').catch(async e=>{
    console.error('LIVE_READER_ROUTE',await session.fromPartition('persist:teacher-reading').resolveProxy(process.env.TEACHER_READER_LIVE_URL));
    console.error('LIVE_READER_STATE',await ui(`({address:document.querySelector('#address').value,error:document.querySelector('#reader-network-error').textContent,position:document.querySelector('#position').textContent})`));
    console.error('LIVE_READER_CONTENT',await command('snapshot').then(v=>({url:v?.url,title:v?.title,characters:v?.content?.length,first:v?.content?.slice(0,100)})).catch(err=>err.message));throw e;
   });
   const route=await session.fromPartition('persist:teacher-reading').resolveProxy(live.url);
   assert.ok(route.includes(new URL(process.env.TEACHER_READER_LIVE_PROXY).host),'真实网址必须使用所配置的本机代理');
  }
  const output=process.env.TEACHER_SMOKE_OUTPUT;mkdirSync(output,{recursive:true});
  if(live)writeFileSync(join(output,'reader-network-live.json'),JSON.stringify(live,null,2));
  await command('overlay',{visible:true});
  try{writeFileSync(join(output,'reader-network.png'),(await main.webContents.capturePage()).toPNG());}finally{await command('overlay',{visible:false});}
  const result={defaultDirect:true,explicitProxyAuthorization:true,failedSnapshotRejected:true,sameTab:true,draftPreserved:true,progressOnlyOnSuccess:true,persistedProxy:true,restoredSystemNetwork:true,localControlsHidden:true,defaultSessionUnchanged:true,directRequests,proxyRequests,live:live?{url:live.url,title:live.title,characters:live.content.length}:null};
  writeFileSync(join(output,'reader-network-result.json'),JSON.stringify(result,null,2));
  console.log('READER_NETWORK_SMOKE_OK '+JSON.stringify(result));
 }finally{for(const socket of sockets)socket.destroy();await Promise.all([origin,proxy].map(server=>new Promise(resolve=>server.close(resolve))));}
};
