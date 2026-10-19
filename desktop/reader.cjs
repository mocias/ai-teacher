const {WebContentsView,ipcMain,Menu}=require('electron');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
exports.installReader=({base,main})=>{
 const win=main;let tabs=[],active=null,shown=false,overlay=false,bounds={x:0,y:0,width:0,height:0};
 const validUrl=value=>{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('仅支持 HTTP 或 HTTPS 网址');return u.href;};
 const trusted=e=>e.sender===main.webContents||e.sender===win?.webContents;
 const current=()=>tabs.find(t=>t.id===active);
 function layout(){if(win.isDestroyed())return;const [w,h]=win.getContentSize(),zoom=win.webContents.getZoomFactor();const x=Math.max(0,Math.round(bounds.x*zoom)),y=Math.max(0,Math.round(bounds.y*zoom)),width=Math.max(0,Math.min(w-x,Math.round(bounds.width*zoom))),height=Math.max(0,Math.min(h-y,Math.round(bounds.height*zoom)));for(const t of tabs){const visible=shown&&!overlay&&width>0&&height>0&&t.id===active;t.view.setVisible(visible);if(visible)t.view.setBounds({x,y,width,height});}}
 function emit(){if(win&&!win.isDestroyed())win.webContents.send('reader:state',{active,tabs:tabs.map(({view,...t})=>t)});}
 function update(t,value){if(!tabs.includes(t))return;Object.assign(t,value);if(t.id===active)emit();}
 function makeTab(args={}){
  const existing=tabs.find(t=>args.resourceId?t.resourceId===args.resourceId:args.url&&!t.local&&t.url.split('#')[0]===args.url.split('#')[0]);if(existing){active=existing.id;layout();emit();return existing.id;}
  const local=!!args.resourceId,view=new WebContentsView({webPreferences:{backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,sandbox:true,partition:local?undefined:'persist:teacher-reading',preload:join(__dirname,'page-preload.cjs')}});
  const t={id:randomUUID(),resourceId:args.resourceId||null,title:args.title||'新标签页',url:args.url||'',location:args.location||'',local,view,error:''};tabs.push(t);active=t.id;win.contentView.addChildView(view);
  view.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  const guard=(e,url)=>{try{if(local){if(new URL(url).origin!==base)e.preventDefault();}else validUrl(url);}catch{e.preventDefault();}};
  view.webContents.on('will-navigate',guard);view.webContents.on('will-redirect',guard);
  view.webContents.on('did-navigate',(_e,url)=>{if(!local)update(t,{url,location:'',error:''});});
  view.webContents.on('did-navigate-in-page',(_e,url,isMain)=>{if(!local&&isMain)update(t,{url});});
  view.webContents.on('page-title-updated',(_e,title)=>update(t,{title}));
  view.webContents.on('did-fail-load',(_e,code,desc,_url,isMain)=>{if(isMain&&code!==-3)update(t,{error:'页面加载失败：'+desc});});
  // Restore only on opening a saved resource, never on later user navigation.
  if(!local&&args.location)view.webContents.once('did-finish-load',()=>{
   view.webContents.executeJavaScript(`(()=>{const location=${JSON.stringify(String(args.location).slice(0,1000))};const heading=[...document.querySelectorAll('h1,h2,h3')].find(h=>h.textContent.trim().slice(0,300)===location);heading?.scrollIntoView();})()`).catch(()=>{});
  });
  view.webContents.setWindowOpenHandler(({url})=>{try{makeTab({url:validUrl(url)});}catch{}return {action:'deny'};});
  view.webContents.on('context-menu',(_e,p)=>{if(!p.selectionText)return;Menu.buildFromTemplate([{label:'向 AI 提问',click:()=>win.webContents.send('reader:selection',{tabId:t.id,text:p.selectionText.slice(0,10000)})},{role:'copy',label:'复制'}]).popup({window:win});});
  const url=local?base+'/document.html?id='+encodeURIComponent(args.resourceId):validUrl(args.url||'https://example.com');
  view.webContents.loadURL(url).catch(e=>update(t,{error:e.message}));layout();emit();return t.id;
 }
 async function open(resourceId){main.webContents.send('reader:open-request',{resourceId});}
 main.on('resize',layout);
 main.webContents.on('did-navigate',()=>{shown=false;layout();});
 main.on('closed',()=>{for(const t of tabs)if(!t.view.webContents.isDestroyed())t.view.webContents.close();tabs=[];});
 ipcMain.handle('reader:open',(e,id)=>{if(!trusted(e))throw Error('无权打开阅读器');return open(typeof id==='string'?id:undefined);});
 ipcMain.on('reader:location',(e,v)=>{const t=tabs.find(t=>t.view.webContents===e.sender);if(!t||e.senderFrame!==e.sender.mainFrame)return;update(t,{url:t.local?'':e.sender.getURL(),title:String(v.title||'').slice(0,500),location:String(v.location||'').slice(0,1000)});});
 ipcMain.handle('reader:command',async(e,action,args)=>{
  if(e.sender!==win?.webContents)throw Error('此操作仅供阅读窗口使用');const t=current();
  if(action==='viewport'){if(!['x','y','width','height'].every(k=>Number.isFinite(args[k])&&args[k]>=0))throw Error('阅读区域无效');bounds=args;shown=args.visible===true;layout();return;}
  if(action==='new')return makeTab(args);
  if(action==='workspace'){shown=false;layout();main.loadURL(base+'/personal.html');return;}
  if(action==='overlay'){overlay=!!args.visible;layout();return;}
  if(action==='state'){emit();return;}
  if(action==='switch'){if(!tabs.some(x=>x.id===args.id))throw Error('标签页不存在');active=args.id;layout();emit();return;}
  if(action==='close'){const i=tabs.findIndex(x=>x.id===args.id);if(i<0)return;const removed=tabs.splice(i,1)[0];win.contentView.removeChildView(removed.view);removed.view.webContents.close();if(active===args.id)active=tabs[Math.min(i,tabs.length-1)]?.id||null;layout();emit();return;}
  if(!t&&action==='snapshot')return null;if(!t)throw Error('请先打开资料');
  if(args.tabId&&args.tabId!==t.id)throw Error('当前标签页已变化，请重试');
  if(action==='navigate'){return makeTab({url:validUrl(args.url)});}
  if(action==='back'){if(t.view.webContents.navigationHistory.canGoBack())t.view.webContents.navigationHistory.goBack();return;}
  if(action==='forward'){if(t.view.webContents.navigationHistory.canGoForward())t.view.webContents.navigationHistory.goForward();return;}
  if(action==='reload'){t.view.webContents.reload();return;}
  if(action==='snapshot'){
   const result=await t.view.webContents.executeJavaScript(t.local?`window.readerDocument?.snapshot()`:`({url:location.href,title:document.title,selection:String(getSelection()).slice(0,10000),content:(()=>{const root=document.querySelector('main,article')||document.body,hs=[...root.querySelectorAll('h1,h2,h3')],h=hs.filter(x=>x.getBoundingClientRect().top<=180).at(-1)||hs[0];if(!h)return root.innerText.slice(0,45000);const next=hs.slice(hs.indexOf(h)+1).find(x=>x.tagName<=h.tagName),r=new Range();r.setStartBefore(h);if(next)r.setEndBefore(next);else r.setEndAfter(root.lastChild||h);return r.toString().slice(0,45000);})()})`);
   if(current()?.id!==t.id)throw Error('当前标签页已变化，请重试');return {tabId:t.id,location:t.location,...result};
  }
  if(action==='selection')return t.view.webContents.executeJavaScript('String(getSelection()).slice(0,10000)');
  if(action==='documentLocation'){if(!t.local)return;const result=await t.view.webContents.executeJavaScript('window.readerDocument?.position()');if(result)update(t,result);return result;}
  if(action==='mark'){
   const quote=String(args.quote||'').slice(0,10000),kind=args.kind==='underline'?'underline':'highlight';
   // CSS Highlight API changes only presentation, never the page's editable DOM.
   return t.view.webContents.executeJavaScript(`(()=>{const q=${JSON.stringify(quote)},kind=${JSON.stringify(kind)};if(!q||!window.Highlight)return;const root=document.querySelector('#document-body')||document.querySelector('main,article')||document.body;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n,full='',nodes=[];while(n=walker.nextNode()){if(n.parentElement?.closest('script,style'))continue;nodes.push({node:n,start:full.length});full+=n.textContent;}let r;const selected=getSelection();if(selected?.rangeCount&&String(selected)===q)r=selected.getRangeAt(0).cloneRange();else{const i=full.indexOf(q);if(i>=0){const first=nodes.findLast(x=>x.start<=i),last=nodes.findLast(x=>x.start<i+q.length);r=new Range();r.setStart(first.node,i-first.start);r.setEnd(last.node,i+q.length-last.start);}}if(r){const key='teacher-'+kind,h=CSS.highlights.get(key)||new Highlight();h.add(r);CSS.highlights.set(key,h);}if(!document.querySelector('#teacher-mark-style')){const s=document.createElement('style');s.id='teacher-mark-style';s.textContent='::highlight(teacher-highlight){background:#ffe58c;color:#222}::highlight(teacher-underline){text-decoration:underline #c77b00 2px}';document.head.append(s);}})()`);
  }
 });
 return {open};
};
