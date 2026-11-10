import {resizeComposer} from './chat-ui.js';

export const paneDefaults={navigation:216,conversations:190,composer:84,agentRail:216,agentComposer:64,discoveryComposer:88,personalComposer:85,readerSidebar:390,readerComposer:112};
const configurations={
 navigation:{key:'teacher.navigation.width',property:'--workspace-nav-width',min:168,max:360,axis:'x',direction:1,target:handle=>handle.closest('.shell')},
 conversations:{key:'teacher.conversations.width',property:'--conversation-list-width',min:180,max:420,axis:'x',direction:1,target:handle=>handle.closest('.chatlayout')},
 composer:{key:'teacher.composer.height',property:'--composer-editor-height',min:84,max:360,axis:'y',direction:-1,target:handle=>handle.parentElement},
 agentRail:{key:'teacher.agent.rail.width',property:'--agent-rail-width',min:168,max:360,axis:'x',direction:1,target:handle=>handle.closest('.agent-page')},
 agentComposer:{key:'teacher.agent.composer.height',property:'--composer-editor-height',min:64,max:360,axis:'y',direction:-1,target:handle=>handle.parentElement},
 discoveryComposer:{key:'teacher.discovery.composer.height',property:'--composer-editor-height',min:88,max:360,axis:'y',direction:-1,target:handle=>handle.parentElement},
 personalComposer:{key:'teacher.personal.composer.height',property:'--composer-editor-height',min:85,max:360,axis:'y',direction:-1,target:handle=>handle.parentElement},
 readerSidebar:{key:'ai-teacher.reader.sidebar.width',property:'--reader-sidebar-width',min:280,max:720,axis:'x',direction:-1,target:()=>document.documentElement},
 readerComposer:{key:'ai-teacher.reader.composer.height',property:'--composer-editor-height',min:112,max:360,axis:'y',direction:-1,target:handle=>handle.parentElement},
};
const labels={navigation:'调整主导航宽度',conversations:'调整会话列表宽度',composer:'调整对话输入区高度',agentRail:'调整主 Agent 导航宽度',agentComposer:'调整主 Agent 输入区高度',discoveryComposer:'调整目标讨论输入区高度',personalComposer:'调整画像对话输入区高度',readerSidebar:'调整阅读答疑侧栏宽度',readerComposer:'调整阅读答疑输入区高度'};
const controlledIds={navigation:'workspace-nav',conversations:'conversation-list',composer:'message-input',agentRail:'agent-navigation',agentComposer:'content',discoveryComposer:'discovery-input',personalComposer:'message',readerSidebar:'reader-side',readerComposer:'question'};
const sizes=new Map();
const findHandle=kind=>document.querySelector(`[data-resize-pane="${kind}"]`);
const controlled=handle=>document.getElementById(handle.getAttribute('aria-controls'));
function saved(kind){if(sizes.has(kind))return sizes.get(kind);const c=configurations[kind];try{const value=Number(localStorage.getItem(c.key));return Number.isFinite(value)&&value>0?Math.round(Math.max(c.min,Math.min(c.max,value))):null;}catch{return null;}}
function persist(kind){try{const key=configurations[kind].key,value=sizes.get(kind);if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,String(value));}catch{}}
function bounded(handle,value){
 const kind=handle.dataset.resizePane,c=configurations[kind];
 let maximum=c.max;
 if(kind==='readerSidebar')maximum=Math.min(maximum,innerWidth*.75);
 if(kind==='conversations')maximum=Math.min(maximum,c.target(handle).clientWidth-320);
 if(c.axis==='y')maximum=Math.min(maximum,innerHeight*.55);
 return Math.round(Math.max(c.min,Math.min(Math.floor(maximum),value)));
}
function sync(handle,value,vertical){handle.setAttribute('aria-valuenow',String(Math.round(value)));handle.setAttribute('aria-valuetext',`${Math.round(value)} 像素`);handle.setAttribute('aria-orientation',vertical?'horizontal':'vertical');}
function apply(kind){
 const c=configurations[kind],handle=findHandle(kind);if(!handle)return;
 const value=saved(kind),root=c.target(handle);if(!root)return;
 if(value===null)root.style.removeProperty(c.property);else root.style.setProperty(c.property,value+'px');
 if(c.axis==='y'){root.style.setProperty('--composer-editor-auto',value===null?'1':'0');resizeComposer(controlled(handle));}
 const rect=controlled(handle)?.getBoundingClientRect();
 sync(handle,(c.axis==='y'?rect?.height:rect?.width)||value||paneDefaults[kind],c.axis==='y');
}
function makeHandle(kind){
 const c=configurations[kind],handle=document.createElement('div');handle.className=`layout-resize-handle layout-resize-${kind}`;handle.dataset.resizePane=kind;handle.tabIndex=0;
 handle.setAttribute('role','separator');handle.setAttribute('aria-label',labels[kind]);handle.title='拖动调整，或使用方向键；双击恢复默认大小';
 handle.setAttribute('aria-controls',controlledIds[kind]);
 handle.setAttribute('aria-valuemin',String(c.min));handle.setAttribute('aria-valuemax',String(c.max));
 return handle;
}
function mount(kind,parent){
 if(!parent||parent.querySelector(`:scope > [data-resize-pane="${kind}"]`))return;
 parent.prepend(makeHandle(kind));
}
export function bindComposerResize(form,kind='composer'){if(form){mount(kind,form);apply(kind);}}
export function bindWorkspaceLayout(root=document){
 const shell=root.querySelector('.shell');if(!shell)return;
 mount('navigation',shell);
 const chat=shell.querySelector('.chatlayout');if(chat){mount('conversations',chat);bindComposerResize(chat.querySelector('#composer'));}
 bindComposerResize(shell.querySelector('#discovery-composer'),'discoveryComposer');
 apply('navigation');apply('conversations');
}
export function bindAgentLayout(root=document){
 const page=root.querySelector('.agent-page');if(!page)return;
 mount('agentRail',page);bindComposerResize(page.querySelector('#agent-chat'),'agentComposer');apply('agentRail');
}
export function bindReaderLayout(root=document){
 const side=root.querySelector('#reader-side');if(!side)return;
 mount('readerSidebar',side);bindComposerResize(root.querySelector('#ask-form'),'readerComposer');apply('readerSidebar');
}
function preserveTranscript(change){
 const list=document.querySelector('.chatmain .messages'),top=list?.getBoundingClientRect().top;
 const following=!list||list.scrollHeight-list.clientHeight-list.scrollTop<80,anchor=!following&&[...list.children].find(node=>node.getBoundingClientRect().bottom>top+1),offset=anchor?anchor.getBoundingClientRect().top-top:0;
 change();
 if(!list)return;if(following)list.scrollTop=list.scrollHeight;else if(anchor?.isConnected)list.scrollTop+=anchor.getBoundingClientRect().top-list.getBoundingClientRect().top-offset;
}
function setSize(handle,value){
 const kind=handle.dataset.resizePane,c=configurations[kind];
 sizes.set(kind,value===null?null:bounded(handle,value));
 preserveTranscript(()=>{
  apply(kind);
  if(c.axis==='x'){
   const input=c.target(handle).querySelector('.conversation-composer textarea');
   if(input?.getClientRects().length)resizeComposer(input);
  }
 });
 document.dispatchEvent(new CustomEvent('pane-resized',{detail:{kind}}));
}
function bindResizers(document){
 let drag=null;
 const dimension=handle=>{
  const rect=controlled(handle).getBoundingClientRect();
  return configurations[handle.dataset.resizePane].axis==='y'?rect.height:rect.width;
 };
 const finish=event=>{
  if(!drag||event.pointerId!==drag.id)return;
  if(drag.changed)persist(drag.kind);
  drag=null;document.body.classList.remove('layout-resizing');
 };
 document.addEventListener('pointerdown',event=>{
  const handle=event.target.closest?.('[data-resize-pane]');if(!handle||event.button!==0||drag)return;
  const kind=handle.dataset.resizePane,c=configurations[kind];
  drag={id:event.pointerId,kind,target:c.target(handle),start:c.axis==='y'?event.clientY:event.clientX,size:dimension(handle),changed:false};
  // Conversation refreshes can replace a handle while retaining its pane.
  document.body.setPointerCapture(event.pointerId);document.body.classList.add('layout-resizing');event.preventDefault();
 });
 document.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  const c=configurations[drag.kind],handle=findHandle(drag.kind);
  if(!handle||c.target(handle)!==drag.target){finish(event);return;}
  const coordinate=c.axis==='y'?event.clientY:event.clientX;
  if(coordinate===drag.start&&!drag.changed)return;
  setSize(handle,drag.size+c.direction*(coordinate-drag.start));drag.changed=true;
 });
 document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
 document.addEventListener('lostpointercapture',finish);
 document.addEventListener('keydown',event=>{
  const handle=event.target.closest?.('[data-resize-pane]');if(!handle)return;
  const kind=handle.dataset.resizePane,c=configurations[kind];
  const positive=c.axis==='x'?'ArrowRight':'ArrowDown',negative=c.axis==='x'?'ArrowLeft':'ArrowUp';
  const forward=c.direction===1?positive:negative,backward=c.direction===1?negative:positive;
  if(![forward,backward].includes(event.key))return;
  event.preventDefault();setSize(handle,dimension(handle)+(event.key===forward?1:-1)*(event.shiftKey?32:8));persist(kind);
 });
 document.addEventListener('dblclick',event=>{
  const handle=event.target.closest?.('[data-resize-pane]');if(!handle)return;
  setSize(handle,null);persist(handle.dataset.resizePane);
 });
}
if(globalThis.document)bindResizers(document);
