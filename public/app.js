import {createChatAttachments} from './chat-attachments.js';
import {createChoiceController} from './message-choices.js';
import {conversationLabel,sessionLearningBanner,planningScopeBanner} from './session-learning.js';
import {planningFlowCard,planningFlowAction,planningFlowReminder,planningFlow} from './planning-flow.js';
import {readingPosition,restoreReadingPosition,icon,enhanceComposer,enhanceMessages,renderKeepingInput,resizeComposer,messageAttachments} from './chat-ui.js';
import {bindDshModelPicker,conversationRole} from './dsh-model-picker.js';
import {bindReplyStream} from './reply-stream.js';
import {watchUpdates} from './live-events.js';
import {messageContent} from './message-content.js';
import {recoveryDialog} from './recovery.js';
import {remediationScheduleDialog} from './remediation.js';
import {assessmentReport,followupScheduleDialog,remediationContent} from './followups.js';
import {agentAction} from './agents.js';
import {roadmapView,layoutRoadmap} from './roadmap.js';
import {showDetail} from './details.js';
import {todayView,routeSchedule,studyDialog} from './tasks.js';
import {modelsView,modelAction,executionBanner} from './models.js';
import {addResource,recentReadingView,resourceGoalControl,resourceGoalDialog} from './resources.js';
import {goalJourney,journeyView,journeySummary,scheduleDialog} from './journey.js';
import {calendarView,calendarAction} from './calendar.js';
import {discoveryView,discussionId,discussionMessages,discoveryAction,discoveryInput} from './discovery.js';
import {planHistoryView} from './prior-learning.js';
import {rollingPlanView,rollingPlanAction} from './rolling-plan.js';
import {openBookView,bindOpenBook,openBookAction,submitOpenBookSearch,updateOpenBookInput,syncOpenBookAssessments,openBookNoteSource,getOpenBookDraft,saveOpenBookDraft,discardOpenBookDraft} from './open-book.js';
import {learningView,reviewView,assessmentBanner,learningAction} from './learning.js';
import {weeklyStudyView,weekStart} from './weekly-study.js';
import {weekPlanDialog} from './week-plan.js';
import {bindWorkspaceLayout} from './layout-resize.js';
const $=s=>document.querySelector(s);
let readerOrigin=null;
const rollingExpanded=new Map();
document.addEventListener('toggle',event=>{const node=event.target;if(node.matches?.('[data-rolling-goal]'))rollingExpanded.set(node.dataset.rollingGoal,node.open);},true);
const narrowNavigation=window.matchMedia('(max-width:760px)');
function collapsedPreference(key,fallback){
 try{const saved=localStorage.getItem(key);return saved==='1'||saved==='0'?saved==='1':fallback;}catch{return fallback;}
}
let navigationCollapsed=collapsedPreference('teacher.navigation.collapsed',narrowNavigation.matches);
let conversationListCollapsed=collapsedPreference('teacher.conversations.collapsed',window.matchMedia('(max-width:1100px)').matches);
function applySidebarLayout(){
 const sidebar=$('#workspace-nav');
 const navToggles=[...document.querySelectorAll('[data-action="toggle-navigation"]')];
 const expand=$('#nav-expand'),collapse=$('#nav-toggle');
 if(expand)expand.hidden=!navigationCollapsed;
 $('.shell')?.classList.toggle('nav-collapsed',navigationCollapsed);
 if(sidebar){
  if(navigationCollapsed&&sidebar.contains(document.activeElement))expand?.focus({preventScroll:true});
  sidebar.hidden=navigationCollapsed;
 }
 for(const toggle of navToggles)toggle.setAttribute('aria-expanded',String(!navigationCollapsed));
 if(collapse)collapse.hidden=navigationCollapsed;
 const chatlist=$('#conversation-list'),chatToggle=$('#chatlist-toggle');
 $('.chatlayout')?.classList.toggle('chatlist-collapsed',conversationListCollapsed);
 if(chatlist){
  if(conversationListCollapsed&&chatlist.contains(document.activeElement))chatToggle?.focus({preventScroll:true});
  chatlist.hidden=conversationListCollapsed;
 }
 if(chatToggle){chatToggle.setAttribute('aria-expanded',String(!conversationListCollapsed));chatToggle.textContent=conversationListCollapsed?'展开会话列表':'收起会话列表';}
}
function toggleSidebar(kind){
 const list=view==='chat'?$('.messages'):view==='home'?$('.discovery-messages'):null;
 const position=readingPosition(list),top=list?.getBoundingClientRect().top;
 const anchor=position===null?null:[...list.children].find(node=>node.getBoundingClientRect().bottom>top+1);
 const offset=anchor?anchor.getBoundingClientRect().top-top:0;
 if(kind==='navigation')navigationCollapsed=!navigationCollapsed;
 else conversationListCollapsed=!conversationListCollapsed;
 const key=kind==='navigation'?'teacher.navigation.collapsed':'teacher.conversations.collapsed';
 try{localStorage.setItem(key,(kind==='navigation'?navigationCollapsed:conversationListCollapsed)?'1':'0');}catch{}
 applySidebarLayout();
 const input=view==='chat'?$('#message-input'):view==='home'?$('#discovery-input'):null;
 if(input)resizeComposer(input);
 if(anchor?.isConnected)list.scrollTop+=anchor.getBoundingClientRect().top-list.getBoundingClientRect().top-offset;
 else restoreReadingPosition(list,position);
 syncReaderBounds();
}
narrowNavigation.addEventListener('change',event=>{if(event.matches)document.querySelectorAll('.nav-group').forEach(el=>{el.open=el.classList.contains('contains-active');});});
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={INITIALIZING:'准备中',READY_FOR_CONFIRMATION:'待确认路线',ACTIVE:'学习中',PAUSED:'已暂停',PLANNED:'待学习',ASSESSING:'考察中',COMPLETED:'已完成',QUEUED:'等待处理',RUNNING:'处理中',CANCELLED:'已取消',PENDING:'待你确认',ACCEPTED:'已采用',REJECTED:'未采用',SUPERSEDED:'已有新方案',REMOVED_FROM_PLAN:'已移出计划'};
const badge=s=>`<span class="badge ${escape(s)}">${labels[s]||escape(s)}</span>`;
const date=s=>new Date(s).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const navs=[['home','◫','学习概览'],['chat','◌','Teacher 对话'],['journey','▸','目标进度'],['plan','≡','学习路线'],['learning','◎','评估'],['review','↻','复习'],['weekly','▦','周复习'],['reader','▣','阅读器'],['resources','▤','资料库'],['notes','▧','我的笔记'],['profile','◇','学习画像'],['models','⇄','模型与分工'],['settings','⚙','提示词与连接']];
const navGroups=[{title:'学习管理',icon:'≡',views:['journey','plan','learning','review','weekly','profile']},{title:'资料与笔记',icon:'▤',views:['resources','reader','notes']},{title:'AI 与设置',icon:'⚙',views:['models','settings']}];
const navButton=([v,i,t])=>`<button data-view="${v}"><span class="navicon" aria-hidden="true">${icon(({home:'home',chat:'chat',journey:'route',plan:'route',learning:'compass',review:'clock',weekly:'clock',reader:'book',resources:'folder',notes:'note',profile:'user',models:'settings',settings:'settings'})[v])}</span>${t}</button>`;
function navigation(){return navs.filter(n=>['home','chat'].includes(n[0])).map(navButton).join('')+navGroups.map((g,i)=>`<details class="nav-group" data-nav-group="${i}" ${i===0?'open':''}><summary><span class="navicon" aria-hidden="true">${icon(['route','folder','settings'][i])}</span>${g.title}</summary><div class="nav-children">${g.views.map(v=>navButton(navs.find(n=>n[0]===v))).join('')}</div></details>`).join('');}
const routeQuery=new URLSearchParams(location.search);
let state=null,view=navs.some(n=>n[0]===routeQuery.get('view'))?routeQuery.get('view'):'home',goalId=routeQuery.get('goal_id'),chatId=routeQuery.get('conversation_id'),chatMessages=[],filter='',includeArchived=false,promptDirty=false,promptDraft='',busy=false,weeklyData=null,weeklyStart=null,weeklySort='priority';
let readerReady=false,readerRequests=[];
const drafts=new Map(),requestIds=new Map();
const discoveryDraftKey='__new-discovery__';
const attachments=createChatAttachments({api,onChange:()=>{if(state)render();},onError:message=>toast(message)});
const choices=createChoiceController({api,onChange:key=>choices.patch($('#main'),key),onError:message=>toast(message),onSuccess:()=>refresh()});
function messageChoices(message){
 const conversation=state.conversations.find(c=>c.id===message.conversation_id);
 const assessment=state.learning?.assessments.find(a=>a.conversation_id===message.conversation_id);
 if(!['PLANNING','SESSION_LEARNING'].includes(conversation?.kind)&&!assessment)return '';
 const readOnly=state.session_chats?.find(c=>c.conversation_id===message.conversation_id)?.read_only;
 return choices.view(message,{disabled:busy||!!readOnly||!!assessment&&assessment.status!=='WAITING_ANSWER'});
}
function bindChatAttachments(){
 const home=view==='home',form=document.querySelector(home?'#discovery-composer':'#composer');if(!form)return;
 const id=home?(discussionId(state)||discoveryDraftKey):chatId;
 const assessment=!home&&state.learning?.assessments.some(row=>row.conversation_id===id);
 const disabled=busy||!!form.querySelector('textarea')?.disabled||assessment||!id;
 form.dataset.attachmentCount=assessment?'0':String(attachments.count(id));
 let holder=form.querySelector('[data-attachment-holder]');if(!holder){holder=document.createElement('div');holder.dataset.attachmentHolder='';form.append(holder);}
 holder.innerHTML=assessment?'<small class="help">正式考察仅接受文字答案；资料检索请使用考察提供的入口。</small>':attachments.view(id,{disabled});
 attachments.bind(form,id,{dropTarget:form.closest(home?'.discovery-chat':'.chatmain'),disabled});
}
let homeAgendaTab='today';
let homeConversation=new URLSearchParams(location.search).get('home_chat')==='discovery'?'discovery':'profile';
try{if(localStorage.getItem('teacher.home.agenda')==='overview')homeAgendaTab='overview';}catch{}
const conversationGroups=new Map();
let groupedConversation=null;
function selectHomeAgenda(tab){
 if(!['today','overview'].includes(tab))return;
 homeAgendaTab=tab;
 try{localStorage.setItem('teacher.home.agenda',tab);}catch{}
 for(const button of document.querySelectorAll('[data-home-agenda]')){
  const selected=button.dataset.homeAgenda===tab;
  button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
 }
 for(const panel of document.querySelectorAll('[data-home-agenda-panel]'))panel.hidden=panel.dataset.homeAgendaPanel!==tab;
}
function assessmentStateLabel(id){const status=state.learning.assessments.find(a=>a.conversation_id===id)?.status;return ({PAUSED:' · 已暂停',ENDED_EARLY:' · 已提前结束',COMPLETED:' · 已结束'})[status]||'';}
function conversationList(chats){
 const selected=chats.find(chat=>chat.id===chatId),selectedGroup=selected&&conversationLabel(selected);
 if(groupedConversation!==chatId){
  if(selectedGroup)conversationGroups.set(goalId+'|'+selectedGroup,true);
  groupedConversation=chatId;
 }
 return ['目标与规划','任务学习','正式考察'].map((label,index)=>{
  const group=chats.filter(chat=>conversationLabel(chat)===label);
  if(!group.length)return '';
  const key=goalId+'|'+label,open=conversationGroups.get(key)??label===selectedGroup;
  return `<details class="conversation-group" data-chat-group="${escape(key)}" ${open?'open':''}>
   <summary id="conversation-group-${escape(goalId)}-${index}"><span>${label}</span><small>${group.length}</small></summary>
   ${group.map(chat=>`<button class="chatitem ${chat.id===chatId?'selected':''}" data-chat="${escape(chat.id)}" ${chat.id===chatId?'aria-current="true"':''}><span>${escape(chat.title)}</span><small>${conversationLabel(chat)}${assessmentStateLabel(chat.id)} · ${date(chat.created_at)}</small></button>`).join('')}
  </details>`;
 }).join('');
}
document.addEventListener('toggle',event=>{
 const group=event.target;
 if(group instanceof HTMLDetailsElement&&group.matches('[data-chat-group]'))conversationGroups.set(group.dataset.chatGroup,group.open);
},true);
document.addEventListener('keydown',event=>{
 const current=event.target.closest?.('[data-home-agenda]');
 if(!current||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 const tabs=[...document.querySelectorAll('[data-home-agenda]')],index=tabs.indexOf(current);
 const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
 event.preventDefault();tabs[next].focus();tabs[next].click();
});
const messageCache=new Map();let refreshTask=null,refreshAgain=false,forceRender=false,lastSnapshot='';
async function api(path,data){const r=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw new Error(value.error||'请求失败');return value;}
let toastTimer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
const currentGoal=()=>state.goals.find(x=>x.id===goalId);
const goalSelect=()=>`<div class="goalbar"><select aria-label="当前学习目标" id="goal-select">${state.goals.map(g=>`<option value="${g.id}" ${g.id===goalId?'selected':''}>${escape(g.title)}</option>`).join('')}</select>${currentGoal()?badge(currentGoal().status):''}${currentGoal()?`<button data-action="study-edit" data-type="goal" data-id="${goalId}">修改目标</button>`:''}</div>`;
const head=(title,description,action='')=>`<div class="heading"><div><h1>${title}</h1><p class="muted">${description}</p></div>${action}</div>`;
const empty=(title,description,button='')=>`<div class="empty"><div class="symbol">◈</div><h2>${title}</h2><p>${description}</p>${button}</div>`;
const newGoalButton='<button class="primary" data-action="new-goal">＋ 新建学习目标</button>';
function shell(){
 $('#app').innerHTML=`<div class="shell"><aside class="sidebar" id="workspace-nav"><div class="brand"><span class="brandmark">${icon('book')}</span><div>AI Teacher<small>个人学习工作台</small></div></div><div class="navlabel">我的学习空间</div><div class="sidebar-tools"><button type="button" id="nav-toggle" data-action="toggle-navigation" aria-controls="workspace-nav" aria-expanded="true">收起导航</button></div><nav class="nav" aria-label="主导航">${navigation()}<a class="nav-agent-link" href="/agents.html">${icon('compass')}<span>AI 设置助手</span></a></nav><div class="sidebottom"><span class="localtag">本机学习空间</span><br>你的资料与记录保存在本机<br><span>按功能选择 API 或宿主</span><span class="workspace-version">V${escape(state.version)}</span></div></aside><div class="workspace"><header class="topbar"><div class="topbar-start"><button type="button" id="nav-expand" data-action="toggle-navigation" aria-controls="workspace-nav" aria-expanded="false" hidden>展开导航</button><button type="button" id="reader-return" data-action="reader-return" class="small" hidden></button><div class="crumb">个人学习 / <strong id="crumb"></strong></div></div><button class="hoststatus" data-view="settings" id="hoststatus"></button></header><main class="main" id="main"></main><section id="embedded-reader" hidden></section></div></div>`;
 applySidebarLayout();bindWorkspaceLayout(document);render();
}
function render(){
 syncOpenBookAssessments(state.learning?.assessments||[]);
 const main=$('#main');if(!main)return;
 if(view==='chat')chatMessages=messageCache.get(chatId)||[];
 const routeOpen=main.querySelector('.route-task-list')?.open,previousGraph=main.querySelector('.roadmap-scroll');
 const graphScroll={left:previousGraph?.scrollLeft??0,top:previousGraph?.scrollTop??0};
 if(view==='home'&&document.activeElement?.matches('[data-draft-field]'))return;
 const listSelector=view==='home'?'.discovery-messages':view==='chat'?'.messages':null;
 const editorKey=view==='home'?(homeConversation==='profile'?'home-profile':'home:'+discussionId(state)):view==='chat'?'chat:'+chatId:view==='plan'?'plan:'+goalId:null;
 const position=listSelector&&main.dataset.editorKey===editorKey?readingPosition(main.querySelector(listSelector)):null;
 const activeInput=document.activeElement;const focusId=activeInput?.id;const selection=activeInput?.selectionStart,selectionEnd=activeInput?.selectionEnd,inputScroll=activeInput?.scrollTop;
 const group=navGroups.find(g=>g.views.includes(view));$('#crumb').textContent=(group?group.title+' / ':'')+navs.find(n=>n[0]===view)[2];
 document.querySelectorAll('[data-nav-group]').forEach(el=>{const active=navGroups[Number(el.dataset.navGroup)].views.includes(view);if(active&&!el.classList.contains('contains-active'))el.open=true;if(narrowNavigation.matches&&!active)el.open=false;el.classList.toggle('contains-active',active);});
 $('#hoststatus').dataset.view=state.agents?.enabled?'models':'settings';
 const masterRoute=state.agents?.routes.find(r=>r.role==='master');
 $('#hoststatus').textContent=state.agents?.enabled?('主 Agent · '+(masterRoute?.mode==='API'?(state.models.enabled?'API 已启用':'API 已暂停'):masterRoute?.mode==='MCP'?(masterRoute.harness==='CODEX'?'Codex 自动处理':masterRoute.harness==='CLAUDE'?'Claude Code 自动处理':masterRoute.harness==='DSH'?'DSH 自动处理':'手动 MCP'):'配置引导待连接')):state.hostAutomation?.settings.enabled?'Codex 自动唤醒已启用':state.models?.enabled?'API 执行器已启用':state.host.last_seen?'宿主最近访问 · '+date(state.host.last_seen):'尚未连接宿主';
 $('#hoststatus').title=$('#hoststatus').textContent;
 $('#hoststatus').textContent=$('#hoststatus').textContent.replace('主 Agent · ','AI 设置 · ');
 document.querySelectorAll('[data-view]').forEach(n=>{n.classList.toggle('active',n.dataset.view===view);if(n.dataset.view===view)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});
 $('#reader-return').hidden=view!=='reader'||!readerOrigin;if(readerOrigin)$('#reader-return').textContent='← '+readerOrigin.label;
 main.hidden=view==='reader';$('#embedded-reader').hidden=view!=='reader';syncReaderBounds();if(view==='reader'){mountReader();return;}
 const openBookInput=activeInput?.closest('[data-open-book-panel]');
 const openBookSelector=openBookInput&&activeInput.matches('input,textarea')?`[data-open-book-panel="${openBookInput.dataset.openBookPanel}"] ${activeInput.matches('[data-open-book-draft]')?'[data-open-book-draft]':activeInput.matches('[data-open-book-title]')?'[data-open-book-title]':'input[name=query]'}`:null;
 const keepEditor=main.dataset.editorKey===editorKey?(view==='home'?(homeConversation==='profile'?'#home-profile-frame':'#discovery-input'):view==='chat'?(openBookSelector||'#message-input'):view==='plan'&&activeInput?.id==='rolling-limit'?'#rolling-limit':null):null;
 renderKeepingInput(main,({home:home,chat:chatView,journey:()=>head('目标进度','从资料到每日学习，沿着明确的下一步继续。')+(state.goals.length?goalSelect():'')+journeyView(state,goalId),plan:plan,resources:resources,notes:notes,profile:profile,settings:settings,models:()=>head('模型与分工','为不同的学习任务配置不同模型。')+modelsView(state),review:()=>head('复习','按日期安排复习，回看复习记录。')+(state.goals.length?goalSelect():'')+reviewView(state,goalId),weekly:()=>head('复习周视图','按自然周查看安排、作答证据和已记录缺口。')+weeklyStudyView(weeklyData,weeklySort),learning:()=>head('评估','确认能力要求，通过考察判断掌握程度。')+(state.goals.length?goalSelect():'')+learningView(state,goalId)})[view](),keepEditor);
 main.dataset.editorKey=editorKey||'';
 applySidebarLayout();
 bindWorkspaceLayout(document);
 if(view==='plan'){layoutRoadmap(main);const list=main.querySelector('.route-task-list');if(list&&routeOpen)list.open=true;main.querySelector('.roadmap-scroll')?.scrollTo(graphScroll);}
 main.classList.toggle('home-main',view==='home');main.classList.toggle('conversation-main',view==='chat'&&!!state.goals.length);document.body.dataset.view=view;
 if(view==='chat'&&state.conversations.find(c=>c.id===chatId)?.kind==='PLANNING'){const origin=state.discussions?.find(d=>d.goal_id===goalId);if(origin)main.querySelector('.chat-title-actions')?.insertAdjacentHTML('afterbegin',`<button type="button" class="small ghost" data-action="discovery-history" data-id="${origin.conversation_id}" title="查看已保留的目标草案与讨论摘要">目标探索记录</button>`);}
 if(view==='chat'){document.querySelector('.chattitle')?.insertAdjacentHTML('afterend',executionBanner(state,chatId));const completed=state.learning.assessments.find(a=>a.conversation_id===chatId&&['COMPLETED','ENDED_EARLY'].includes(a.status));if(completed)document.querySelector('.messages')?.insertAdjacentHTML('beforebegin',assessmentReport(state,completed.id,{compact:true}));const a=state.learning?.assessments.find(x=>x.conversation_id===chatId);if(a){document.querySelector('.chattitle')?.insertAdjacentHTML('afterend',assessmentBanner(state,chatId));const input=document.getElementById('message-input');if(input&&a.status!=='WAITING_ANSWER'){const form=input.form;if(['COMPLETED','ENDED_EARLY','PAUSED'].includes(a.status)){form.hidden=true;form.insertAdjacentHTML('afterend','<div class="assessment-chat-footer">'+(a.status==='PAUSED'?'已暂停，可从顶部继续考察。':'本次考察已结束。')+'</div>');}input.disabled=true;input.placeholder='等待 Teacher 提出下一题…';form.querySelector('button[type=submit]')?.setAttribute('disabled','');}}}
 if(view==='chat'){
  main.querySelector('.chattitle')?.insertAdjacentHTML('afterend',sessionLearningBanner(state,chatId)+planningScopeBanner(state,chatId));
  const learningChat=state.session_chats?.find(row=>row.conversation_id===chatId);
  if(learningChat?.read_only){
    const input=main.querySelector('#message-input');input.disabled=true;input.placeholder=learningChat.unavailable_reason||'此学习记录当前只读';
    main.querySelector('#composer button[type=submit]')?.setAttribute('disabled','');
  }
  const a=state.learning?.assessments.find(x=>x.conversation_id===chatId);if(a)bindOpenBook(main,a);
}
 if(focusId&&document.activeElement!==activeInput){const el=document.getElementById(focusId);if(el){el.focus({preventScroll:true});if(typeof selection==='number'&&el.setSelectionRange)el.setSelectionRange(selection,selectionEnd??selection);if(typeof inputScroll==='number')el.scrollTop=inputScroll;}}
 if(view==='chat'&&!main.querySelector('#composer')?.hidden)bindDshModelPicker(main.querySelector('#composer'),state,chatId,conversationRole(state,chatId));
 if(view==='home')bindDshModelPicker(main.querySelector('#discovery-composer'),state,discussionId(state));
 if(view==='chat'){enhanceComposer(main.querySelector('#composer'));enhanceMessages(main.querySelector('.messages'));bindReplyStream(main.querySelector('.messages'),chatId,chatMessages);}
 if(view==='home'){enhanceComposer(main.querySelector('#discovery-composer'));enhanceMessages(main.querySelector('.discovery-messages'));bindReplyStream(main.querySelector('.discovery-messages'),discussionId(state));}
 bindChatAttachments();
 if(view==='chat')choices.bind(main);
 if(listSelector)restoreReadingPosition(main.querySelector(listSelector),position);
}
function home(){
 const tabs=[['today','今天'],['overview','目标与日历']];
 return head('今天，学一点新东西','继续手头的学习，或和 Teacher 聊聊一个新方向。')+
  `<div class="home-layout"><section class="home-chat-area" aria-label="首页对话">
   <div class="row home-chat-switch">${[['profile','让 AI 了解我'],['discovery','探索学习目标']].map(([id,label])=>`<button type="button" class="small" data-action="home-conversation" data-id="${id}" aria-pressed="${homeConversation===id}">${label}</button>`).join('')}</div>
   ${homeConversation==='profile'?'<iframe id="home-profile-frame" src="/personal.html?embedded=1" title="让 AI 了解我"></iframe>':discoveryView(state,{busy})}
   </section>
   <aside class="home-agenda" aria-label="学习安排与提醒">
    ${planningFlowReminder(state)}
    <div class="home-agenda-tabs" role="tablist" aria-label="学习安排视图">${tabs.map(([id,label])=>`<button type="button" role="tab" id="home-tab-${id}" data-action="home-agenda" data-home-agenda="${id}" aria-selected="${homeAgendaTab===id}" aria-controls="home-agenda-${id}" tabindex="${homeAgendaTab===id?0:-1}">${label}</button>`).join('')}</div>
    <section class="home-agenda-panel" data-home-agenda-panel="today" id="home-agenda-today" role="tabpanel" aria-labelledby="home-tab-today" ${homeAgendaTab==='today'?'':'hidden'}>
     ${todayView(state)}${recentReadingView(state)}
    </section>
    <section class="home-agenda-panel" data-home-agenda-panel="overview" id="home-agenda-overview" role="tabpanel" aria-labelledby="home-tab-overview" ${homeAgendaTab==='overview'?'':'hidden'}>
     ${journeySummary(state)}${calendarView(state)}
    </section>
   </aside>
  </div><details class="home-goals"><summary>我的学习目标 · ${state.goals.length}</summary><div class="row">${state.goals.map(g=>`<button data-action="open-goal" data-id="${g.id}">${escape(g.title)}</button>`).join('')}${newGoalButton}</div></details>`;
}
function chatView(){if(!state.goals.length)return head('Teacher 对话','每个学习活动拥有独立对话。')+`<div class="panel">${empty('先创建一个学习目标','对话将关联到这个目标，学习记录会持续保留。',newGoalButton)}</div>`;
 const chats=state.conversations.filter(c=>c.goal_id===goalId),c=state.conversations.find(x=>x.id===chatId);const flow=planningFlow(state,goalId),adjusting=flow?.status==='ACTIVE'&&flow.conversation_id===chatId&&c?.kind==='PLANNING'&&['REVIEW_CAPABILITIES','REVIEW_ROADMAP','NEEDS_REVISION'].includes(flow.stage);const waiting=state.jobs.filter(j=>j.conversation_id===chatId&&['QUEUED','RUNNING'].includes(j.status));return head('Teacher 对话','在这里交流，由所选模型或宿主回复。')+goalSelect()+`<div class="chatlayout"><aside class="chatlist" id="conversation-list"><div class="sectionlabel">当前目标的对话</div>${conversationList(chats)}<button class="ghost small" data-action="new-chat">＋ 新建对话</button></aside><section class="chatmain"><div class="chattitle"><h2 title="${escape(c?.title||'选择一个对话')}">${escape(c?.title||'选择一个对话')}</h2><span class="muted">${escape(currentGoal()?.title||'')}</span><div class="chat-title-actions"><button type="button" class="small ghost" id="chatlist-toggle" data-action="toggle-conversations" aria-controls="conversation-list" aria-expanded="true">收起会话列表</button></div></div>${waiting.length?`<div class="connectionhint">${waiting.some(j=>j.status==='RUNNING')?'正在处理消息，回复后会自动显示。':waiting.some(j=>state.models?.tasks.some(t=>t.job_id===j.id&&t.mode==='API'))?'消息已保存，按所选模型的执行状态处理。':state.hostAutomation?.settings.enabled?'消息已保存，正在自动唤醒 Codex。':'消息已保存，请查看“模型与分工”中此功能的执行设置。'}</div>`:''}${openBookView(state.learning?.assessments.find(x=>x.conversation_id===chatId))}<div class="messages" role="log" tabindex="0" aria-label="Teacher 对话记录" aria-live="polite">${chatMessages.length?chatMessages.filter(m=>!(m.role==='user'&&['planning-flow','assessment-system'].includes(m.host))).map(m=>`<article class="message ${m.role}" data-message-id="${escape(m.id)}" data-reply-to="${escape(m.reply_to||'')}"><div class="avatar">${m.role==='user'?'我':'T'}</div><div class="bubble"><div class="messageheader"><strong>${m.role==='user'?'你':'Teacher'}</strong><time>${date(m.created_at)}</time>${m.host?`<span>${escape(m.host)}</span>`:''}</div><div class="messagetext">${messageContent(m)}</div>${messageChoices(m)}${messageAttachments(m)}${m.role==='user'?messageStatus(m):''}</div></article>`).join(''):(c?.kind==='SESSION_LEARNING'?empty('从当前学习任务开始','可以问不懂的地方、讨论例子，或让 Teacher 根据你的进度安排练习。'):empty('从你的目标聊起','可以说说你的基础、想解决的问题，或者提供一份想学习的材料。'))}${planningFlowCard(state,goalId,chatId)}</div><form id="composer" class="composer"><textarea id="message-input" aria-label="发送给 Teacher 的消息" placeholder="${c?.kind==='SESSION_LEARNING'?'围绕当前任务提问，或告诉 Teacher 你学到了哪里…':adjusting?'直接告诉 Teacher，希望怎样调整当前方案…':'说说你的目标，或回答 Teacher 的问题…'}" maxlength="20000" ${c&&!busy?'':'disabled'}>${escape(drafts.get(chatId)||'')}</textarea><div class="composerbar"><small>Enter 发送 · Shift + Enter 换行<br>消息与回复保存在本机</small><button class="primary" type="submit" ${busy||!c?'disabled':''}>${busy?'正在保存…':'发送消息 ↑'}</button></div></form></section></div>`;}
function messageStatus(m){const j=state.jobs.find(x=>x.message_id===m.id);return j?`<div class="messagefooter">${labels[j.status]||j.status}${['QUEUED','RUNNING'].includes(j.status)?` <button class="ghost small" data-action="cancel-job" data-id="${j.id}">取消处理</button>`:''}</div>`:'';}
function plan(){if(!state.goals.length)return head('学习路线','确认方向，再迈出下一步。')+`<div class="panel">${empty('还没有学习路线','创建目标后，与 Teacher 讨论并生成路线。',newGoalButton)}</div>`;const proposals=state.proposals.filter(p=>p.goal_id===goalId),sessions=state.sessions.filter(s=>s.goal_id===goalId&&s.status!=='REMOVED_FROM_PLAN');return head('学习路线','宿主提出计划，你来确认学习的方向。')+goalSelect()+`<div class="row">${['ACTIVE','PAUSED'].includes(currentGoal()?.status)?`<button data-action="toggle-goal">${currentGoal().status==='ACTIVE'?'暂停目标':'恢复目标'}</button>`:''}</div>`+proposals.filter(p=>p.status==='PENDING').map(p=>`<section class="panel proposal"><div class="panelhead"><h2>${escape(p.title)}</h2>${badge(p.status)}</div><p class="help preline">${escape(p.summary)}</p>${planHistoryView(state,p.id)}${p.items.map((s,i)=>`<div class="planitem"><span class="number">${String(i+1).padStart(2,'0')}</span><div><h3>${escape(s.title)}</h3><p>${s.phase?escape(s.phase)+" / "+escape(s.topic)+" · ":""}${escape(s.objective)}</p>${s.dependencies?.length?`<p class="help">先修主题：${s.dependencies.map(escape).join("、")}</p>`:""}</div></div>`).join('')}<div class="row"><button class="primary" data-action="accept" data-id="${p.id}">确认并采用这份路线</button><button data-action="reject" data-id="${p.id}">暂不采用</button></div><p class="help">采用后，尚未开始的旧安排会移出计划；考察中的安排与历史记录保留。</p></section>`).join('')+(currentGoal()?.status==='ACTIVE'?`<div class="row"><button data-action="journey-schedule" data-id="${goalId}">批量安排到日历</button><button data-action="journey-open" data-id="${goalId}">查看目标下一步</button></div>`:'')+planHistoryView(state,proposals.find(p=>p.status==='ACCEPTED')?.id)+rollingPlanView(state,goalId,{expanded:rollingExpanded.get(goalId)||false})+roadmapView(state,goalId)+`<details class="route-task-list"><summary>任务明细 · ${sessions.length} 个学习安排</summary><section class="panel"><div class="panelhead"><h2>当前学习安排</h2><span class="muted">${sessions.length} 个</span></div>${sessions.length?sessions.map((s,i)=>`<div class="planitem interactive-card" tabindex="0" role="group" aria-label="查看任务详情：${escape(s.title)}" data-card="session" data-id="${s.id}"><span class="number">${String(i+1).padStart(2,'0')}</span><div class="content"><div class="row between"><h3>${escape(s.title)}</h3>${badge(s.status)}</div><p>${state.learning?.session_details.find(x=>x.session_id===s.id)?escape(state.learning.session_details.find(x=>x.session_id===s.id).phase)+' / '+escape(state.learning.session_details.find(x=>x.session_id===s.id).topic)+' · ':''}${escape(s.objective)}</p>${routeSchedule(state,s)}<button class="small" data-action="study-edit" data-type="session" data-id="${s.id}">调整任务</button>${s.status==='PLANNED'?`<button class="small" data-action="assess" data-id="${s.id}" ${currentGoal().status!=='ACTIVE'?'disabled':''}>我学完了，开始考察 ↗</button>`:s.conversation_id?`<button class="small" data-chat="${s.conversation_id}">${s.status==='ASSESSING'?'继续考察':'查看考察记录'}</button>`:''}</div></div>`).join(''):empty('路线还在准备中','在 Teacher 对话中说明目标，宿主提交的路线会出现在这里。','<button data-view="chat">前往对话 ↗</button>')}</section></details><details class="history"><summary>路线方案历史 · ${proposals.filter(p=>p.status!=='PENDING').length} 份</summary>${proposals.filter(p=>p.status!=='PENDING').map(p=>`<div class="panel"><h3>${escape(p.title)} ${badge(p.status)}</h3><p>${escape(p.summary)}</p><ol>${p.items.map(s=>`<li>${escape(s.title)} — ${escape(s.objective)}</li>`).join('')}</ol></div>`).join('')}</details>`;}
function resources(){const rows=state.resources.filter(r=>(`${r.title} ${r.url} ${state.resource_files?.find(f=>f.resource_id===r.id)?.name||''}`).toLowerCase().includes(filter.toLowerCase()));return head('资料库','所有资料统一收藏，可按需用于学习目标。','<div class="row"><button data-action="reader-open">打开阅读器</button><button class="primary" data-action="new-resource">＋ 添加资料</button></div>')+`<div class="toolbar"><input id="filter" aria-label="搜索资料" placeholder="搜索标题、文件名或链接…" value="${escape(filter)}"></div><div class="items">${rows.length?rows.map(r=>{const file=state.resource_files?.find(f=>f.resource_id===r.id),links=(state.goal_resources||[]).filter(link=>link.resource_id===r.id);return `<article class="panel interactive-card" tabindex="0" role="group" aria-label="打开资料：${escape(r.title)}" data-card="resource" data-id="${r.id}"><div class="row between"><span class="badge">${links.length?`${links.length} 个正式目标`:r.goal_id?({PRIMARY:'主材料',SUPPLEMENTARY:'补充材料',REFERENCE:'参考资料'}[r.role]):'未关联'}</span><span class="muted">${links.map(link=>`${escape(state.goals.find(g=>g.id===link.goal_id)?.title||'目标')} · ${escape(({PRIMARY:'主材',SUPPLEMENTARY:'补充',REFERENCE:'参考'})[link.role]||link.role)} · ${escape(link.scope||'待确认范围')}`).join('；')||escape(state.goals.find(g=>g.id===r.goal_id)?.title||'')}</span></div><h3 class="preline">${escape(r.title)}</h3>${file?`<p class="help">${escape(file.name)} · ${(file.size/1024/1024).toFixed(2)} MB</p><a href="/api/resource-file?id=${encodeURIComponent(r.id)}" download="${escape(file.name)}">下载原文件 ↓</a>`:''}<div class="resourceurl">${escape(r.url)}</div><button data-action="reader-open" data-id="${r.id}">打开资料</button><button class="small ghost" data-action="detail-resource" data-id="${r.id}">资料详情</button>${resourceGoalControl(r,state)}</article>`;}).join(''):`<div class="panel full">${empty('添加你的第一份学习资料','从本地选择文件，或保存网页链接。','<button data-action="new-resource">添加第一份资料</button>')}</div>`}</div>`;}
function notes(){const rows=state.notes.filter(n=>(includeArchived||!n.archived)&&(`${n.title} ${n.content}`).toLowerCase().includes(filter.toLowerCase()));return head('我的笔记','记录你的理解。笔记始终由你维护，不直接作为能力证据。','<button class="primary" data-action="new-note">＋ 写笔记</button>')+`<div class="toolbar"><input id="filter" aria-label="搜索笔记" placeholder="搜索标题或正文…" value="${escape(filter)}"><label><input id="include-archived" type="checkbox" ${includeArchived?'checked':''}>包含已归档</label></div><div class="items">${rows.length?rows.map(n=>`<article class="panel note-card interactive-card" tabindex="0" role="group" aria-label="查看笔记详情：${escape(n.title)}" data-card="note" data-id="${n.id}"><div class="panelhead"><span class="muted">${date(n.updated_at)}</span>${n.archived?'<span class="badge">已归档 · Teacher 不可读</span>':''}</div><h3>${escape(n.title)}</h3>${openBookNoteSource(state,n.id)}<p class="notecontent">${escape(n.content)}</p><div class="row"><button class="small" data-action="edit-note" data-id="${n.id}">编辑笔记</button><button class="small ghost" data-action="archive-note" data-id="${n.id}">${n.archived?'取消归档':'归档'}</button></div></article>`).join(''):`<div class="panel full">${empty('留住一次理解','用自己的话记录重点、问题或想法。','<button data-action="new-note">写下第一篇笔记</button>')}</div>`}</div>`;}
function profile(){const p=state.profiles.find(p=>p.goal_id===goalId),e=state.evidence.filter(e=>e.goal_id===goalId);return studyBanner()+head('学习画像','用真实回答支撑判断，让每一次变化都有依据。','<a href="/personal.html">打开长期知识画像（领域 / 主题 / 知识点）→</a>')+(state.goals.length?goalSelect():'')+`<div class="columns"><section class="panel"><h2>当前能力判断</h2><p class="help">当前按目标保存汇总画像。能力要求与具体达成判断请在“评估与复习”查看。</p>${p?`<p class="profiletext">${escape(p.content)}</p><button data-action="study-edit" data-type="profile" data-id="${p.goal_id}">修正目标画像</button><p class="muted">更新于 ${date(p.updated_at)}</p>`:empty('还没有足够的证据','完成一次学习考察后，由 Teacher 提交有依据的能力判断。')}</section><section class="panel"><h2>证据记录 <span class="muted">${e.length}</span></h2>${e.length?e.map(x=>`<div class="guideitem"><div><div class="row"><span class="badge">${x.mode==='OPEN_BOOK'?'开卷':'闭卷'}</span><span class="muted">${date(x.created_at)}</span></div><p class="preline">${escape(x.summary)}</p><button class="small ghost" data-chat="${x.conversation_id}">查看原始对话 ↗</button></div></div>`).join(''):empty('保留原始上下文','考察结论会关联到实际回答，不生成虚构进度或掌握分数。')}</section></div>`;}
function settings(){const p=state.prompts[0];return head('提示词与连接','平台保存状态，由宿主或所配置的 API 模型完成回复。')+`<div class="columns"><section class="panel"><div class="panelhead"><h2>Teacher 提示词</h2><span class="badge">版本 ${p.version}</span></div><p class="help">修改后在宿主下一次读取上下文时生效。历史版本会保留。</p><textarea id="prompt-editor" class="prompteditor" aria-label="Teacher 核心提示词" maxlength="50000">${escape(promptDirty?promptDraft:p.content)}</textarea><div class="row"><button class="primary" data-action="save-prompt">保存提示词</button><span class="muted">${promptDirty?'有未保存的修改':'已保存到本机'}</span></div></section><div><section class="panel"><h2>连接 AI 宿主</h2><p class="help">首次使用：先保持本服务运行，在 Codex 添加项目中的 MCP 插件，重启一个对话后使用。配置步骤见项目 README。</p><div class="code">服务地址：http://127.0.0.1:4317\nMCP：/mcp（需要 Agent 密钥）\n本地插件：plugins/ai-teacher</div><p class="help">在宿主中发送下面这段话：</p><div class="code" id="host-prompt">使用 AI Teacher 工具，领取 Web 中的待处理消息。先读取 Teacher 上下文，再回复。请通过 teacher_reply 把所有用户可见回复写回 Web。当前没有消息时结束，不要编造回复。</div><button class="small" data-action="copy-prompt">复制启动提示词</button><p class="help">在“模型与分工”为功能选择 Codex、Claude Code 或 DSH 自动处理后，无需复制上述提示词。选择手动 MCP 时需自行启动宿主。按整条回复同步，不镜像宿主其他聊天或内部推理。</p></section><section class="panel"><h2>本地数据与接口</h2><p class="help">学习记录保存在项目 data 目录的 SQLite 数据库中。可在“模型与分工”配置 API 连接；未配置的模块仍由宿主处理。</p><div class="row"><a href="/api/export" download>导出学习数据 ↓</a><a href="/api/openapi.json" target="_blank">HTTP API 说明 ↗</a></div><p class="help">当前使用范围：可信本机、单用户。尚未提供公网账户系统。</p></section></div></div>`;}
async function refresh({passive=false}={}){
 forceRender ||= !passive;
 if(refreshTask){refreshAgain=true;return refreshTask;}
 refreshTask=(async()=>{do{
  refreshAgain=false;state=await api('state');
  const targetHomeConversation=homeConversation;
  const exploring=view==='home'&&targetHomeConversation==='discovery';
  if(exploring&&!state.discussions.length){await api('discussions',{request_id:crypto.randomUUID()});state=await api('state');}
  if(!goalId||!state.goals.some(g=>g.id===goalId))goalId=state.goals[0]?.id||null;
  if(view==='weekly'){const now=new Date();if(!weeklyStart){const wd=(now.getDay()+6)%7;now.setDate(now.getDate()-wd);weeklyStart=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}weeklyData=await api('weekly-study?start_date='+encodeURIComponent(weeklyStart)+'&tz_offset='+new Date().getTimezoneOffset());}
  if(!chatId||!state.conversations.some(c=>c.id===chatId&&c.goal_id===goalId))chatId=state.conversations.find(c=>c.goal_id===goalId)?.id||null;
  const targetView=view,cid=exploring?discussionId(state):view==='chat'?chatId:null;
  const messages=cid?await api('messages?conversation_id='+encodeURIComponent(cid)):[];
  if(cid){messageCache.delete(cid);messageCache.set(cid,messages);while(messageCache.size>20)messageCache.delete(messageCache.keys().next().value);}
  if(view!==targetView||(view==='chat'&&chatId!==cid)||(view==='home'&&(targetHomeConversation!==homeConversation||(exploring&&discussionId(state)!==cid)))){refreshAgain=true;continue;}
  if(exploring)discussionMessages(messages);
  const snapshot=JSON.stringify([state,view,homeConversation,cid,messages]);
  if(forceRender||snapshot!==lastSnapshot){lastSnapshot=snapshot;forceRender=false;render();}
 }while(refreshAgain);})().finally(()=>{refreshTask=null;});
 return refreshTask;
}
function dialog(title,fields,onSubmit){const d=$('#editor');delete d.dataset.detail;delete d.dataset.detailType;delete d.dataset.detailId;delete d.dataset.studyEntry;d.innerHTML=`<div class="dialoghead"><h2>${title}</h2><button class="ghost" data-action="close-dialog" aria-label="关闭">✕</button></div><form id="dialog-form">${fields}<p class="formerror" role="alert"></p><div class="actions"><button type="button" data-action="close-dialog">取消</button><button class="primary" type="submit">保存</button></div></form>`;d.showModal();$('#dialog-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const result=await onSubmit(Object.fromEntries(new FormData(e.target)));if(result===false)return;d.close();await refresh();}catch(error){$('.formerror').textContent=error.message;}finally{button.disabled=false;}};}
const goalOptions=()=>`<label for="fgoal">关联目标</label><select id="fgoal" name="goal_id"><option value="">不关联</option>${state.goals.map(g=>`<option value="${g.id}" ${g.id===goalId?'selected':''}>${escape(g.title)}</option>`).join('')}</select>`;
function discoveryEnv(){return {state,api,dialog,toast,refresh,attachments,discoveryDraftKey,isBusy:()=>busy,setBusy:value=>{busy=value;render();},home:()=>{view='home';},currentDiscussion:id=>state.discussions.find(d=>d.conversation_id===id),updateDiscussion:d=>{const index=state.discussions.findIndex(x=>x.conversation_id===d.conversation_id);if(index>=0)state.discussions[index]={...state.discussions[index],...d};},openChat:async id=>{state=await api('state');chatId=id;goalId=state.conversations.find(c=>c.id===id)?.goal_id;view='chat';await refresh();}};}
document.addEventListener('focusout',e=>{if(e.target.matches('[data-draft-field],#discovery-input'))setTimeout(()=>render(),100);});
function currentCapabilitySet(targetId){return state.learning?.capability_sets.filter(set=>set.goal_id===targetId&&set.status==='ACCEPTED').at(-1)||null;}
function eligibleNoteVerificationTarget(targetId){const target=state.goals.find(goal=>goal.id===targetId);return !!target&&target.status==='ACTIVE'&&!state.learning?.learning_settings.some(setting=>setting.goal_id===targetId&&setting.archived)&&!!currentCapabilitySet(targetId);}
async function noteVerificationRequestId(note,setId){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(note.title+'\0'+note.content)),hex=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,58);return 'nv:'+hex+':'+setId;}
function noteEditor(note){
 const eligible=note?!note.archived&&eligibleNoteVerificationTarget(note.goal_id):state.goals.some(goal=>eligibleNoteVerificationTarget(goal.id));
 let persisted=note?{id:note.id,title:note.title,content:note.content,goal_id:note.goal_id}:null;
 let verificationConversation=null;
 const fields='<label for="ftitle">标题</label><input id="ftitle" name="title" required maxlength="200" value="'+escape(note?.title||'')+'"><label for="fcontent">正文</label><textarea id="fcontent" name="content" rows="8" required maxlength="50000">'+escape(note?.content||'')+'</textarea>'+(note?'':goalOptions())+(eligible?'<label class="checkrow"><input type="checkbox" name="request_note_verification" value="true">保存后请 Teacher 判断是否邀请验证</label><p class="help">这只会排队一个判断请求；Teacher 不能据此开始考察或写入证据。</p>':'');
 dialog(note?'编辑笔记':'写一篇笔记',fields,async values=>{
  const targetId=note?.goal_id||values.goal_id||null,ask=values.request_note_verification==='true';
  const target=targetId&&state.goals.find(goal=>goal.id===targetId),set=targetId&&currentCapabilitySet(targetId);
  if(ask&&(!target||target.status!=='ACTIVE'||!set||state.learning?.learning_settings.some(setting=>setting.goal_id===targetId&&setting.archived)))throw new Error('请先选择一个进行中且已确认能力要求的目标');
  const next={id:persisted?.id,title:values.title.trim(),content:values.content.trim(),goal_id:targetId};
  if(!persisted||persisted.title!==next.title||persisted.content!==next.content||persisted.goal_id!==next.goal_id){
   const saved=await api('notes',{...(next.id?{id:next.id}:{}),title:next.title,content:next.content,...(!next.id?{goal_id:next.goal_id}:{})});
   persisted={...next,id:saved.id};toast('笔记已保存');
  }
  if(!ask)return;
  let conversation=verificationConversation||state.conversations.find(item=>item.goal_id===targetId&&item.kind==='PLANNING');
  try{
   if(!conversation)conversation=await api('conversations',{goal_id:targetId,title:'能力评估与学习规划'});
   verificationConversation=conversation;
   const request_id=await noteVerificationRequestId(persisted,set.id);
   await api('messages',{conversation_id:conversation.id,task_kind:'chat',learning_intent:'NOTE_VERIFICATION',subject_id:persisted.id,content:'请只依据当前目标中我写的笔记，对笔记 '+persisted.id+' 做一次语义判断：它是否记录了我对某项能力掌握程度的实质变化？不要用关键词匹配、不要从笔记本身推断掌握，也不要开始考察或创建证据。若值得让我重新验证，请调用 teacher_suggest_note_verification，关联当前版本能力要求并说明理由；否则直接说明不需要邀请。',request_id});
  }catch(error){toast('笔记已保存，但验证邀请未能排队');throw new Error('笔记已保存；验证邀请未能排队：'+error.message+'。可取消勾选后完成保存，或重试。');}
  goalId=targetId;chatId=conversation.id;view='chat';toast('笔记已保存，Teacher 已收到“是否邀请验证”的判断请求');
 });
}
async function action(name,node){const nid=node.dataset.id;
 if(name==='home-agenda'){selectHomeAgenda(node.dataset.homeAgenda);return;}
 if(name==='home-conversation'){homeConversation=nid==='discovery'?'discovery':'profile';await refresh();return;}
 if(name==='toggle-navigation'||name==='toggle-conversations'){toggleSidebar(name==='toggle-navigation'?'navigation':'conversations');return;}
 if(name==='session-route'){goalId=nid;view='plan';await refresh();return;}
 if(name.startsWith('planning-')){await planningFlowAction(name.slice(9),node,{api,getState:()=>state,refresh,toast,openChat:async(id,options={})=>{if(options.from&&chatId!==options.from)return;chatId=id;goalId=state.conversations.find(c=>c.id===id)?.goal_id||goalId;view='chat';await refresh();},openView:async(next)=>{view=next;await refresh();},revise:()=>{const input=$('#message-input');if(input){input.focus({preventScroll:true});input.scrollIntoView({block:'nearest'});}}});return;}

 if(name==='weekly-plan'){await weekPlanDialog(node.dataset.start,{api,dialog,toast});return;}
 if(name==='note-verification-ask'){
  const note=state.notes.find(x=>x.id===nid),target=state.goals.find(g=>g.id===note?.goal_id);if(!note||!target||target.status!=='ACTIVE')throw Error('请从进行中的目标笔记发起验证建议');goalId=target.id;
  let c=state.conversations.find(x=>x.goal_id===target.id&&x.kind==='PLANNING');if(!c)c=await api('conversations',{goal_id:target.id,title:'能力评估与学习规划'});
  await api('messages',{conversation_id:c.id,task_kind:'chat',learning_intent:'NOTE_VERIFICATION',subject_id:note.id,content:`请只依据当前目标中我写的笔记，对笔记 ${note.id} 做一次语义判断：它是否记录了我对某项能力掌握程度的实质变化？不要用关键词匹配、不要从笔记本身推断掌握，也不要开始考察或创建证据。若值得让我重新验证，请调用 teacher_suggest_note_verification，关联当前版本能力要求并说明理由；否则直接说明不需要邀请。`,request_id:crypto.randomUUID()});chatId=c.id;view='chat';await refresh();return;
 }
 if(name==='note-verification-start'){const result=await api('notes/verification/start',{invite_id:nid,request_id:crypto.randomUUID()});chatId=result.conversation_id;goalId=state.learning.note_verification_invites.find(x=>x.id===nid)?.goal_id||goalId;view='chat';await refresh();return;}
 if(name==='note-verification-defer'){const result=await api('notes/verification/defer',{invite_id:nid,days:7});toast(`已暂缓，到 ${result.deferred_until} 再提醒`);return;}
 if(name==='note-verification-decline'){await api('notes/verification/decline',{invite_id:nid});toast('已忽略本版本的验证邀请');return;}
 if(name==='material-map-start'){goalId=nid;let conversation=state.conversations.find(c=>c.goal_id===nid&&c.kind==='PLANNING');if(!conversation)conversation=await api('conversations',{goal_id:nid,title:'资料覆盖核对'});await api('messages',{conversation_id:conversation.id,task_kind:'roadmap',content:'请逐份阅读当前目标的主材料和补充材料正文，按当前有效能力要求记录各正文的覆盖、部分覆盖、未覆盖或不明确之处；参考资料只可作为背景，不能计入覆盖或据此说资料充分。发现会影响要求判断的重要冲突时，标明受影响要求、描述双方说法并关联双方正文版本。用 teacher_record_material_map 保存核对结果。当前只做资料对照，不要生成或修改学习路线。',request_id:crypto.randomUUID()});chatId=conversation.id;view='chat';await refresh();return;}
 if(name==='material-conflict-adopt'||name==='material-conflict-dismiss'){const goal=node.dataset.goal||goalId,decision=name==='material-conflict-adopt'?'ADOPTED':'NO_CONFLICT',source_content_id=node.dataset.content,request_id=crypto.randomUUID(),label=decision==='ADOPTED'?'采用所选正文并保留冲突记录':'裁定经核对不构成冲突';dialog(label,`<p class="help">${decision==='ADOPTED'?'选择的正文将作为当前学习采用依据。':'必须说明为什么两份正文不构成冲突。'}之后仍可重新裁决，历史记录会保留。</p><label for="material-decision-note">裁决理由</label><textarea id="material-decision-note" name="note" maxlength="2000" required placeholder="说明适用范围、版本差异或采用依据"></textarea>`,async values=>{await api('material-map/resolve',{goal_id:goal,conflict_id:nid,decision,source_content_id,note:values.note,request_id});toast('资料冲突裁决已保存');});return;}
 if(name.startsWith('rolling-')){await rollingPlanAction(name,node,{state,api,dialog,toast});await refresh();return;}
 if(name.startsWith('openbook-')){await openBookAction(name,node,{state,api,toast});await refresh();return;}
 if(['assessment-pause','assessment-resume','assessment-continue','assessment-comment','assessment-comment-retry'].includes(name)){
  const assessment=state.learning.assessments.find(item=>item.id===nid);if(!assessment)return;
  if(name==='assessment-comment-retry'){
   const jobId=state.learning.assessment_comments?.find(item=>item.assessment_id===nid)?.job_id;
   const task=state.models.tasks.find(item=>item.job_id===jobId);
   if(!jobId||!task)return;
   await api(task.agent_role?'agents/retry':'models/retry',task.agent_role?{job_id:jobId}:{job_id:jobId,mode:task.mode,profile_id:task.profile_id});
  }else{
   const result=await api('assessments/'+name.slice(11),{id:nid,request_id:crypto.randomUUID()});
   if(result.conversation_id){goalId=assessment.goal_id;chatId=result.conversation_id;view='chat';}
  }
  if($('#editor').open)$('#editor').close();
  await refresh();return;
 }
 if(name==='v2-early'){
  const assessment=state.learning?.assessments.find(item=>item.id===nid),draft=assessment?.mode==='OPEN_BOOK'?getOpenBookDraft(nid):null;
  if(assessment&&draft?.content.trim()){
   dialog('提前结束开卷考察','<p class="help">还有一份未保存的临时草稿。请选择如何处理。搜索和资料阅读会在考察结束后关闭。</p><fieldset><legend>草稿处理</legend><label class="checkrow"><input type="radio" name="draft_action" value="SAVE" checked>保存为笔记并结束</label><label class="checkrow"><input type="radio" name="draft_action" value="DISCARD">丢弃草稿并结束</label></fieldset>',async value=>{if(value.draft_action==='SAVE')await saveOpenBookDraft(nid,assessment,{state,api,toast});else discardOpenBookDraft(nid);await api('assessments/end',{id:nid});toast('考察已提前结束，记录保留');});
   $('#dialog-form button[type="submit"]').textContent='确认并结束';$('#dialog-form .actions button[type="button"]').textContent='返回考察';return;
  }
 }
 if(name==='weekly-shift'){weeklyStart=weekStart(node.dataset.start,Number(node.dataset.step));await refresh();return;}
 if(name==='weekly-sort'){weeklySort=node.dataset.sort;render();return;}
 if(name==='weekly-settings'){const current=weeklyData?.settings||{intensity:'STANDARD',auto_enabled:0};dialog('复习强度与自动安排',`<label for="adaptive-intensity">整体复习强度</label><select id="adaptive-intensity" name="intensity"><option value="LIGHT" ${current.intensity==='LIGHT'?'selected':''}>轻量</option><option value="STANDARD" ${current.intensity==='STANDARD'?'selected':''}>标准</option><option value="INTENSIVE" ${current.intensity==='INTENSIVE'?'selected':''}>密集</option></select><label class="checkrow"><input type="checkbox" name="auto_enabled" value="true" ${current.auto_enabled?'checked':''}>考察完成后自动加入下一次复习</label><p class="help">强度按证据关系设置建议间隔，不预测遗忘。勾选后仅新完成的有效考察会自动排入待复习；现有取消、改期和待办不会被覆盖。</p>`,async data=>{await api('adaptive-review/settings',{intensity:data.intensity,auto_enabled:data.auto_enabled==='true',request_id:crypto.randomUUID()});toast('复习设置已保存');weeklyData=null;});return;}
 if(name==='weekly-accept'){const request_id=crypto.randomUUID();await api('adaptive-review/accept',{goal_id:node.dataset.goal,source_assessment_id:node.dataset.source,requirement_id:node.dataset.requirement,due_date:node.dataset.date,request_id});toast('已加入复习安排');await refresh();return;}
 if(name==='resource-goal'){const existing=state.resources.find(r=>r.id===nid)?.goal_id;if(existing)return action('journey-open',{dataset:{id:existing}});resourceGoalDialog(nid,{state,dialog,api,toast,openGoal:id=>{goalId=id;view='journey';}});return;}
 if(name==='journey-start-review'){const review=state.learning.reviews.find(r=>r.id===nid);if(!review)return;goalId=review.goal_id;return action('v2-start-review',node);}
 if(name.startsWith('followup-')){
  if(name==='followup-schedule'){const a=state.learning.assessments.find(a=>a.id===nid);if(!a)return;goalId=a.goal_id;followupScheduleDialog(state,nid,node.dataset.requirement,{api,dialog,toast});return;}
  if(name==='followup-review'){const r=state.learning.reviews.find(r=>r.id===nid);if(!r)return;goalId=r.goal_id;view='review';await refresh();document.querySelector('[data-card="review"][data-id="'+nid+'"]')?.scrollIntoView({block:'center'});return;}
  if(name==='followup-gap'||name==='followup-reinforce'){const gap=state.learning.gaps.find(g=>g.id===nid);if(!gap)return;goalId=gap.goal_id;if(name==='followup-reinforce')return action('v2-reinforce',node);dialog('回看资料与强化学习',remediationContent(state,nid),async()=>{});$('#editor').dataset.detail='true';$('#dialog-form button[type=submit]').hidden=true;$('#dialog-form>.actions button').textContent='关闭';return;}
 }
 if(name==='journey-next')return advanceJourney(nid);
 if(name.startsWith('journey-')){
  goalId=nid;
  if(name==='journey-schedule'){scheduleDialog(nid,{api,dialog,toast});return;}
  if(name==='journey-chat'){chatId=state.conversations.find(c=>c.goal_id===nid&&c.kind==='PLANNING')?.id||null;view='chat';}
  else view=({'journey-open':'journey','journey-plan':'plan','journey-learning':'learning','journey-review':'review'})[name]||'journey';
  await refresh();return;
 }
 if(name==='calendar-recovery'){await recoveryDialog({api,dialog,toast});return;}
 if(name==='remediation-schedule'){const gap=state.learning.gaps.find(g=>g.id===nid);if(!gap)return;goalId=gap.goal_id;remediationScheduleDialog(state,nid,{api,dialog,toast});return;}
 if(name==='remediation-read'){await openEmbeddedReader(nid);return;}
 if(name==='remediation-reinforce'||name==='remediation-source'){
  const progress=$('#task-progress');if(progress&&!progress.disabled)await api('calendar/progress',{id:progress.dataset.entry,progress:Number(progress.value),notes:$('#task-notes').value});
  $('#editor').close();await refresh();
  if(name==='remediation-reinforce'){goalId=state.learning.gaps.find(g=>g.id===nid)?.goal_id;return action('v2-reinforce',node);}
  goalId=state.learning.assessments.find(a=>a.id===nid)?.goal_id;return action('v2-results',node);
 }
 if(name==='task-review'){
  const session=state.sessions.find(s=>s.id===nid);if(!session)return;goalId=session.goal_id;
  const progress=$('#task-progress');if(progress)await api('calendar/progress',{id:progress.dataset.entry,progress:Number(progress.value),notes:$('#task-notes').value});
  $('#editor').close();return action('v2-schedule',node);
 }
 if(name==='reader-open'){await openEmbeddedReader(nid);return;}
 if(name==='study-edit'){
  const type=node.dataset.type,table={goal:'goals',session:'sessions',requirement:'requirements',profile:'profiles'}[type];
  const rows=type==='requirement'?state.learning.requirements:state[table],r=rows.find(x=>(x.id||x.goal_id)===nid);if(!r)return;
  const fields={goal:{title:'目标名称',domain:'领域',scope:'范围'},session:{title:'任务名称',objective:'学习内容'},requirement:{description:'能力要求'},profile:{content:'目标能力画像'}}[type];
  dialog('调整学习内容',Object.entries(fields).map(([k,label])=>`<label>${label}</label><textarea name="${k}" required maxlength="10000">${escape(r[k])}</textarea>`).join(''),async values=>{await api('study/edit',{type,id:nid,fields:values});toast('已保存，AI 会合并判断这轮修改是否需要了解原因');});return;
 }

 if(name.startsWith('detail-')){showDetail(state,name.slice(7),nid,dialog);return;}
 const env={state,goalId,api,dialog,toast,refresh,openChat:async c=>{chatId=c;goalId=state.conversations.find(x=>x.id===c)?.goal_id||goalId;view='chat';await refresh();}};
 if(name.startsWith('agent-'))return agentAction(name.slice(6),node,env);
 if(name.startsWith('model-'))return modelAction(name.slice(6),node,env);
 if(['task-chat','task-assess','task-assessment'].includes(name)){const s=state.sessions.find(s=>s.id===nid);if(!s)return;goalId=s.goal_id;const progress=$('#editor').open&&$('#task-progress');if(progress){await api('calendar/progress',{id:progress.dataset.entry,progress:Number(progress.value),notes:$('#task-notes').value});}$('#editor').close();if(name==='task-assess')return action('assess',node);if(name==='task-assessment'){chatId=s.conversation_id;view='chat';}else{const result=await api('sessions/learning',{session_id:s.id,request_id:crypto.randomUUID()});chatId=result.conversation_id;view='chat';}await refresh();return;}
 if(name.startsWith('calendar-'))return calendarAction(name.slice(9),node,env);
 if(name==='open-learning'){goalId=nid;view='review';await refresh();return;}
 if(name.startsWith('discovery-'))return discoveryAction(name.slice(10),node,discoveryEnv());
 if(name.startsWith('v2-'))return learningAction(name.slice(3),node,env);
 if(name==='assess'&&state.learning?.session_details.some(x=>x.session_id===nid))return learningAction('session',node,env);
 if(name==='close-dialog'){$('#editor').close();return;}
 if(name==='new-goal'){dialog('新建学习目标','<label for="ftitle">我想学会</label><input id="ftitle" name="title" placeholder="例如：理解并优化 LLM 推理中的 KV Cache" required maxlength="150"><label for="fdomain">所属领域</label><input id="fdomain" name="domain" placeholder="例如：AI Infra" required maxlength="100"><label for="fscope">希望达到的能力</label><textarea id="fscope" name="scope" rows="4" placeholder="可以先写一个大致方向，稍后与 Teacher 细化。" maxlength="5000"></textarea>',async a=>{const r=await api('goals',a);goalId=r.goal.id;chatId=r.conversation.id;view='chat';toast('目标已创建，可以开始讨论了');});return;}
 if(name==='new-chat'){dialog('新建独立对话','<label for="ftitle">对话主题</label><input id="ftitle" name="title" required maxlength="150" placeholder="例如：讨论材料与学习范围">',async a=>{const c=await api('conversations',{...a,goal_id:goalId});chatId=c.id;});return;}
 if(name==='reader-return'){await returnFromReader();return;}
 if(name==='new-resource'){addResource({state,dialog,api,toast,openReader:window.teacherDesktop?openEmbeddedReader:null});return;}
 if(name==='new-note'||name==='edit-note'){noteEditor(state.notes.find(x=>x.id===nid));return;}
 if(name==='assess'){dialog('开始学习考察','<p class="help">这会建立独立的考察对话。宿主连接后，每次提出一个问题。</p><label for="fmode">考察模式</label><select id="fmode" name="mode"><option value="CLOSED_BOOK">闭卷 · 独立回忆与推理</option><option value="OPEN_BOOK">开卷 · 允许查阅材料</option></select>',async a=>{const r=await api('sessions/assess',{id:nid,mode:a.mode});chatId=r.conversation_id;view='chat';});return;}
 if(name==='open-goal'||name==='open-plan'){goalId=nid;chatId=null;view=name==='open-goal'?'chat':'plan';await refresh();return;}
 if(name==='archive-note'){const n=state.notes.find(x=>x.id===nid);await api('notes/archive',{id:nid,archived:!n.archived});toast(n.archived?'笔记已恢复':'已归档，Teacher 上下文不再包含此笔记');}
 if(name==='accept'||name==='reject'){await api('proposals/decide',{id:nid,accept:name==='accept'});toast(name==='accept'?'已采用学习路线':'已保留为未采用方案');}
 if(name==='toggle-goal')await api('goals/status',{id:goalId,status:currentGoal().status==='ACTIVE'?'PAUSED':'ACTIVE'});
 if(name==='cancel-job'){await api('jobs/cancel',{id:nid});toast('已取消本条消息的处理，消息记录保留');}
 if(name==='save-prompt'){await api('prompts',{content:$('#prompt-editor').value});promptDirty=false;toast('提示词已保存，宿主下次读取时生效');}
 if(name==='copy-prompt'){await navigator.clipboard.writeText($('#host-prompt').textContent);toast('启动提示词已复制');return;}
 await refresh();
}
document.addEventListener('click',async e=>{const n=e.target.closest('button');if(!n){const card=e.target.closest('[data-card]');if(card&&!e.target.closest('a,input,textarea,select,summary')&&!(e.target.closest('details')&&card.contains(e.target.closest('details')))&&!window.getSelection()?.toString()){if(card.dataset.card==='resource'&&window.teacherDesktop){openEmbeddedReader(card.dataset.id).catch(err=>toast(err.message));return;}if(card.dataset.card==='assessment')action('v2-results',card).catch(err=>toast(err.message));else showDetail(state,card.dataset.card,card.dataset.id,dialog);}return;}try{if(n.dataset.action||n.dataset.chat||n.dataset.view)e.preventDefault();if(n.dataset.action==='reader-open'||n.dataset.view==='reader'){await openEmbeddedReader(n.dataset.id);return;}if(n.closest('#editor')&&$('#editor').dataset.detail==='true')$('#editor').close();if(n.dataset.view){view=n.dataset.view;filter='';render();if(view!=='reader')await refresh();}else if(n.dataset.chat){chatId=n.dataset.chat;goalId=state.conversations.find(c=>c.id===chatId)?.goal_id||goalId;view='chat';await refresh();}else if(n.dataset.action)await action(n.dataset.action,n);}catch(error){toast(error.message);}});
document.addEventListener('click',e=>{const starter=e.target.closest('[data-discovery-prompt]');if(starter){const input=$('#discovery-input');if(input){input.value=starter.dataset.discoveryPrompt;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}}});
document.addEventListener('input',e=>{if(e.target.matches('[data-draft-field],#discovery-input')){discoveryInput(e,discoveryEnv());return;}if(e.target.id==='message-input'){drafts.set(chatId,e.target.value);}if(e.target.id==='prompt-editor'){promptDraft=e.target.value;promptDirty=true;}if(e.target.id==='filter'){filter=e.target.value;render();}});
document.addEventListener('input',updateOpenBookInput);

document.addEventListener('change',updateOpenBookInput);
document.addEventListener('change',async e=>{try{if(e.target.id==='discussion-select'){await discoveryAction('select',e.target,discoveryEnv());return;}if(e.target.id==='goal-select'){goalId=e.target.value;chatId=null;await refresh();}if(e.target.id==='include-archived'){includeArchived=e.target.checked;render();}}catch(error){toast(error.message);}});
document.addEventListener('keydown',e=>{if(e.target.matches('[data-card]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.click();return;}});
document.addEventListener('submit',async e=>{if(e.target.id==='discovery-composer'){e.preventDefault();await discoveryAction('send',e.target,discoveryEnv());return;}if(e.target.id!=='composer')return;e.preventDefault();const input=$('#message-input');if(busy||input?.disabled)return;const c=chatId,submitted=input.value,text=submitted.trim(),assessment=state.learning?.assessments.some(x=>x.conversation_id===c),tokens=assessment?[]:attachments.snapshot(c);if(!text&&!tokens.length)return;restoreReadingPosition($('.messages'));const taskKind='chat';busy=true;render();try{const prepared=assessment?{resource_ids:[],tokens:[]}:await attachments.prepare(c,tokens);if(!text&&!prepared.resource_ids.length)return;const content=text||'请阅读并讨论这些附件。',payload=JSON.stringify([content,taskKind,tokens,prepared.resource_ids]);const prior=requestIds.get(c),key=prior?.payload===payload?prior.key:crypto.randomUUID();requestIds.set(c,{key,payload});await api('messages',{conversation_id:c,content,request_id:key,...(!assessment?{task_kind:taskKind,attachment_resource_ids:prepared.resource_ids}:{})});if(drafts.get(c)===submitted){drafts.delete(c);if(chatId===c&&$('#message-input')?.value===submitted)$('#message-input').value='';}requestIds.delete(c);attachments.clearSent(c,prepared.tokens);await refresh();}catch(error){toast(error.message);}finally{busy=false;render();}});
document.addEventListener('submit',async e=>{try{if(await submitOpenBookSearch(e,{api}))await refresh();}catch(error){toast(error.message);}});
try{await refresh();shell();if(location.hash==='#dsh-sessions')document.getElementById('dsh-sessions')?.scrollIntoView({block:'start'});watchUpdates(()=>refresh({passive:true}),{active:()=>!document.hidden&&view!=='reader'&&!$('#editor').open,onError:()=>{$('#hoststatus').textContent='本地服务连接中断，正在重连';}});$('#editor').addEventListener('close',()=>refresh({passive:true}).catch(error=>toast(error.message)));
 const context=document.modelContext;if(context?.registerTool){const lifecycle=new AbortController();context.registerTool({name:'teacher_workspace_summary',description:'Read the visible learning workspace counts. Does not expose notes or messages.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({goals:state.goals.length,evidence:state.evidence.length,view})},{signal:lifecycle.signal});window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}
}catch(error){$('#app').textContent='无法连接本地学习服务：'+error.message;}

function studyBanner(){if(!state?.study)return '';if(!state.agents?.enabled&&state.study.settings.onboarding==='NEW')return `<section class="panel"><strong>先连接你的主 Agent</strong><p>先了解系统，再由它引导你为各功能配置 API 或 MCP。</p><button data-view="models">配置主 Agent →</button></section>`;const intro=!['DONE','EXISTING'].includes(state.study.settings.onboarding),pending=state.study.suggestions.length,changes=state.study.changes.filter(b=>b.status==='WAITING_REASON').length;return intro||pending||changes?`<section class="panel"><strong>${intro?'用 2～3 分钟，让 AI 认识你':pending?'有待确认的画像建议':'AI 想了解你最近的调整'}</strong><p>你可以继续对话修正画像，也可以稍后处理。</p><a href="/personal.html">${intro?'开始 / 继续首次引导':'查看并继续交流'} →</a></section>`:'';}


function syncReaderBounds(){
 const frame=$('#reader-frame'),host=$('#embedded-reader');
 if(!window.teacherDesktop)return;
 const visible=view==='reader'&&!!frame&&!host.hidden,r=frame?.getBoundingClientRect();
 const doc=frame?.contentDocument,side=doc?.querySelector('#reader-side');
 const sideWidth=side&&!side.hidden?side.getBoundingClientRect().width:0;
 const headerHeight=doc?.querySelector('#reader-header')?.getBoundingClientRect().bottom||0;
 window.teacherDesktop.command('viewport',{
  x:Math.max(0,r?.left||0),y:Math.max(0,(r?.top||0)+headerHeight),
  width:Math.max(0,(r?.width||0)-sideWidth),height:Math.max(0,(r?.height||0)-headerHeight),visible
 }).catch(()=>{});
 frame?.contentWindow?.postMessage({readerVisibility:visible},location.origin);
}
function mountReader(){const host=$('#embedded-reader');if(!window.teacherDesktop){host.innerHTML='<div class="panel">请在桌面软件中使用内置阅读器。</div>';return;}if(!$('#reader-frame')){host.innerHTML='<iframe id="reader-frame" title="内嵌资料阅读器" src="/reader.html"></iframe>';new ResizeObserver(syncReaderBounds).observe(host);}syncReaderBounds();flushReaderRequests();}
function flushReaderRequests(){if(!readerReady)return;const frame=$('#reader-frame');for(const id of readerRequests.splice(0))frame.contentWindow.postMessage({openResource:id},location.origin);}
function captureReaderOrigin(){
 const editor=$('#editor'),chat=state.conversations.find(c=>c.id===chatId);
 const origin={view,goalId,chatId,filter,scrollY:window.scrollY,position:readingPosition($('.messages')),
  label:view==='chat'?(chat?.kind==='SESSION_LEARNING'?'返回任务学习':chat?.kind==='PLANNING'?'返回目标与规划':'返回对话'):view==='plan'?'返回学习路线':view==='home'?'返回学习概览':view==='resources'?'返回资料库':'返回'+(navs.find(n=>n[0]===view)?.[2]||'工作台')};
 if(editor.open&&editor.dataset.detailType){origin.detail={type:editor.dataset.detailType,id:editor.dataset.detailId};origin.label=origin.detail.type==='session'?'返回任务详情':'返回资料详情';}
 if(editor.open&&$('#task-progress')){origin.study={id:$('#task-progress').dataset.entry,progress:$('#task-progress').value,notes:$('#task-notes')?.value};origin.label='返回学习记录';}
 return origin;
}
async function returnFromReader(){
 const origin=readerOrigin;if(!origin)return;
 view=origin.view;goalId=origin.goalId;chatId=origin.chatId;filter=origin.filter;
 try{await refresh();}catch(error){view='reader';render();throw error;}readerOrigin=null;
 if(view==='chat')restoreReadingPosition($('.messages'),origin.position);
 window.scrollTo({top:origin.scrollY,behavior:'instant'});
 if(origin.detail)showDetail(state,origin.detail.type,origin.detail.id,dialog);
 if(origin.study){studyDialog(state,origin.study.id,{api,dialog,toast});if($('#editor').open){if($('#task-progress'))$('#task-progress').value=origin.study.progress;if($('#task-notes'))$('#task-notes').value=origin.study.notes;}}
}
async function openEmbeddedReader(id){if(!window.teacherDesktop){toast('请在桌面软件中使用内置阅读器');return;}const progress=$('#editor').open&&$('#task-progress');if(progress)await api('calendar/progress',{id:progress.dataset.entry,progress:Number(progress.value),notes:$('#task-notes').value});if(view!=='reader')readerOrigin=captureReaderOrigin();if($('#editor').open)$('#editor').close();if(id)readerRequests.push(id);view='reader';window.scrollTo(0,0);render();}
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==$('#reader-frame')?.contentWindow)return;if(e.data?.readerLayout)syncReaderBounds();if(e.data?.readerReady){readerReady=true;syncReaderBounds();flushReaderRequests();}if(e.data?.readerConfigure){view='models';render();}if(e.data?.readerGoal){view='resources';refresh().then(()=>action('resource-goal',{dataset:{id:e.data.readerGoal}})).catch(err=>toast(err.message));}});
window.addEventListener('resize',syncReaderBounds);window.addEventListener('scroll',syncReaderBounds,{passive:true});
window.teacherDesktop?.onOpenReader(({resourceId})=>openEmbeddedReader(resourceId).catch(e=>toast(e.message)));

const journeyRequests=new Set();
async function advanceJourney(id){
 if(journeyRequests.has(id))return;journeyRequests.add(id);
 try{
  state=await api('state');goalId=id;const j=goalJourney(state,id);if(!j)return;
  const node=value=>({dataset:{id:value}});
  if(['later','blocked','deferred'].includes(j.stage))return await action('journey-plan',node(id));
  if(j.stage==='paused'){await api('goals/status',{id,status:'ACTIVE'});await refresh();return;}
  if(j.stage==='material')return await action(j.content?'v2-analyze':'v2-material',node(j.material.id));
  if(j.stage==='confirm-cap')return await action('journey-learning',node(id));
  if(j.stage==='confirm-roadmap')return await action('journey-plan',node(id));
  if(j.stage==='diagnostic')return await action('v2-begin',node(id));
  if(j.stage==='schedule')return await action('journey-schedule',node(id));
  if(j.stage==='daily'||j.stage==='remediation')return await action('calendar-study',node(j.entry.id));
  if(j.stage==='practice')return await action('v2-session',node(j.session.id));
  if(j.stage==='review')return await action('journey-start-review',node(j.review.id));
  if(j.stage==='gap')return await action('followup-gap',node(j.gap.id));
  if(['assessment','waiting'].includes(j.stage)){chatId=j.assessment?.conversation_id||j.job.conversation_id;view='chat';await refresh();return;}
  if(['capabilities','roadmap'].includes(j.stage)){
   let c=state.conversations.find(c=>c.goal_id===id&&c.kind==='PLANNING');if(!c)c=await api('conversations',{goal_id:id,title:'目标与学习计划'});
   if(!state.planning_sources?.[c.id]){chatId=c.id;view='chat';await refresh();toast('请先讨论目标、范围或要解决的问题');return;}
   await api('messages',{conversation_id:c.id,task_kind:j.stage,content:j.stage==='capabilities'?'请根据目标与已分析资料提出核心和辅助能力要求，使用 teacher_propose_capabilities 保存待确认提案。':'请根据已确认能力要求、当前版本的初始诊断与资料分析，用 teacher_plan_learning 提出分阶段学习路线，包含资料引用和明确的主题先修关系。',request_id:crypto.randomUUID()});chatId=c.id;view='chat';await refresh();return;
  }
  return await action(j.stage==='ended'&&j.goal.status==='COMPLETED'?'journey-review':'journey-learning',node(id));
 }catch(e){toast(e.message);}finally{journeyRequests.delete(id);}
}

window.addEventListener('dsh-model-changed',()=>refresh().catch(error=>toast(error.message)));
