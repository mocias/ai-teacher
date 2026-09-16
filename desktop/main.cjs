const {app,BrowserWindow,Menu,dialog,shell}=require('electron');
const {spawn}=require('node:child_process');
const {join,resolve}=require('node:path');
const {createHash}=require('node:crypto');
const {existsSync,readFileSync,writeFileSync,mkdirSync}=require('node:fs');
let window,child,owned=false,quitting=false,base;
const root=join(__dirname,'..');
const smoke=process.argv.includes('--smoke-test');
app.setName('AI Teacher');
if(smoke&&process.env.TEACHER_SMOKE_PROFILE)app.setPath('userData',process.env.TEACHER_SMOKE_PROFILE);
if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>{window?.show();window?.focus();});
app.whenReady().then(start).catch(e=>{if(smoke)console.error(e);else dialog.showErrorBox('AI Teacher 启动失败',e.message);app.exit(1);});
}
async function start(){
 const configFile=join(app.getPath('userData'),'desktop.json');
 mkdirSync(app.getPath('userData'),{recursive:true});
 let config={};if(existsSync(configFile))config=JSON.parse(readFileSync(configFile,'utf8'));
 const dataArg=process.argv.find(a=>a.startsWith('--data-dir='))?.slice(11);
 if(dataArg){if(!existsSync(join(dataArg,'teacher.sqlite')))throw Error('指定的数据目录没有 teacher.sqlite');config.dataDir=dataArg;}
 const dataDir=process.env.TEACHER_DATA_DIR||config.dataDir||(!app.isPackaged?join(root,'data'):join(app.getPath('userData'),'data'));
 const save=()=>writeFileSync(configFile,JSON.stringify(config,null,2));
 if(dataArg&&!smoke)save();
 // Reuse only a verified service for this exact data directory.
 if(!smoke){
  let response;try{response=await fetch('http://127.0.0.1:4317/api/health',{signal:AbortSignal.timeout(1000)});}catch{}
  if(response){let health;try{health=await response.json();}catch{}
   const identity=createHash('sha256').update(process.platform==='win32'?resolve(dataDir).toLowerCase():resolve(dataDir)).digest('hex');
   if(health?.service!=='ai-teacher'||health.data_id!==identity)throw Error('端口 4317 已有其他服务或旧版工作台。请先关闭该服务，再打开桌面应用。');
   base='http://127.0.0.1:4317';
  }
 }
 if(!base){
  const node=app.isPackaged?join(root,'runtime','node.exe'):process.env.TEACHER_NODE||'node';
  child=spawn(node,[join(__dirname,'service.mjs')],{cwd:root,windowsHide:true,env:{...process.env,TEACHER_DATA_DIR:dataDir,TEACHER_DESKTOP_SMOKE:smoke?'1':'0'},stdio:['ignore','pipe','pipe','ipc']});owned=true;
  child.stderr.on('data',()=>{});
  child.stdout.on('data',()=>{});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('本地服务启动超时')),20000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`本地服务退出 (${code})`));});child.on('message',m=>{if(m.type==='ready'){base=m.url;clearTimeout(timer);resolve();}});});
  child.on('exit',()=>{if(!quitting){dialog.showErrorBox('服务已停止','请退出并重新打开 AI Teacher。学习数据保存在本机。');app.quit();}});
 }
 window=new BrowserWindow({width:config.width||1380,height:config.height||900,minWidth:960,minHeight:640,title:'AI Teacher · 学习工作台',backgroundColor:'#f7f8fa',show:!smoke,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
 window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==base){event.preventDefault();if(/^https?:\/\//.test(url))shell.openExternal(url);}});
 window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'AI Teacher',submenu:[{label:'桌面设置…',click:async()=>{const {response}=await dialog.showMessageBox(window,{type:'info',title:'桌面设置',message:'AI Teacher · 本地学习工作台',detail:`数据目录：${dataDir}\n服务：${base}\n关闭窗口将退出应用${owned?'并停止本次启动的服务':'；已有 Web 服务继续运行'}。\n模型连接和 Codex 设置位于工作台的“模型与分工”。`,buttons:['完成','打开数据目录','选择已有数据目录（重启生效）']});if(response===1)await shell.openPath(dataDir);if(response===2){const picked=await dialog.showOpenDialog(window,{title:'选择包含 teacher.sqlite 的已有数据目录',properties:['openDirectory']});if(!picked.canceled){const dir=picked.filePaths[0];if(!existsSync(join(dir,'teacher.sqlite'))){await dialog.showMessageBox(window,{message:'所选目录没有 teacher.sqlite，请选择已有学习数据目录。'});return;}config.dataDir=dir;save();await dialog.showMessageBox(window,{message:'已保存，请退出后重新打开应用。',detail:'应用直接使用所选目录，不会移动或复制学习数据。'});}}}},{type:'separator'},{role:'quit',label:'退出'}]},
  {label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
  {label:'视图',submenu:[{role:'reload',label:'刷新'},{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]}
 ]));
 window.on('close',()=>{if(!smoke){const [width,height]=window.getSize();Object.assign(config,{width,height});save();}});
 await window.loadURL(base);
 if(smoke){
  const result=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const tick=setInterval(()=>{if(document.querySelector('#app button')){clearInterval(tick);resolve();}else if(Date.now()-start>10000){clearInterval(tick);reject(Error('UI did not render'));}},100)}).then(()=>fetch('/api/state')).then(r=>{if(!r.ok)throw Error('state '+r.status);return r.json()}).then(s=>({title:document.title,hasApp:!!document.querySelector('#app button'),goals:s.goals?.length,body:document.body.innerText.slice(0,150)}))`);
  if(process.env.TEACHER_SMOKE_OUTPUT){const output=process.env.TEACHER_SMOKE_OUTPUT;mkdirSync(output,{recursive:true});writeFileSync(join(output,'desktop.png'),(await window.webContents.capturePage()).toPNG());writeFileSync(join(output,'result.json'),JSON.stringify({...result,base,servicePid:child?.pid,packaged:app.isPackaged,menus:Menu.getApplicationMenu().items.map(i=>i.label)},null,2));}
  console.log('DESKTOP_SMOKE_OK '+JSON.stringify(result));app.quit();
 }
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(owned&&child?.connected&&!quitting){event.preventDefault();quitting=true;child.send({type:'stop'});const timeout=setTimeout(()=>{child.kill();app.exit();},6000);child.once('exit',()=>{clearTimeout(timeout);app.exit();});}else quitting=true;});
