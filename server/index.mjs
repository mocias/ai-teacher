import {createDshModelDirectory} from './dsh-model-directory.mjs';
import {dshNetwork} from './dsh-network.mjs';
import {staticAssets} from './static-assets.mjs';
import {agentCatalog,agentInvoke} from './agent-mcp.mjs';
import {version} from './version.mjs';
import {priorLearning} from './prior-learning.mjs';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {readerFile} from './reader-files.mjs';
import {codexHost} from './codex-host.mjs';
import {harnessHost} from './harness-host.mjs';
import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createStore,AppError} from './store.mjs';
import {modelExecutor} from './model-executor.mjs';
import {tools,invoke} from './tools.mjs';

export function startServer({executorOptions={},hostOptions={},harnessOptions={},port=Number(process.env.PORT||4317),dataDir=process.env.TEACHER_DATA_DIR||fileURLToPath(new URL('../data',import.meta.url))}={}){
 const dataId=createHash('sha256').update(process.platform==='win32'?resolve(dataDir).toLowerCase():resolve(dataDir)).digest('hex');
 let finishClose;const closedPromise=new Promise(resolve=>{finishClose=resolve;});
 mkdirSync(dataDir,{recursive:true});const keyFile=resolve(dataDir,'agent-token');if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32).toString('hex'),{mode:0o600});const token=readFileSync(keyFile,'utf8').trim();
 const store=createStore(resolve(dataDir,'teacher.sqlite'));
 const network=dshNetwork(dataDir);
 const dshDirectory=createDshModelDirectory({home:harnessOptions.dshSourceHome,runtimeHome:resolve(dataDir,'dsh-model-catalog'),detect:harnessOptions.detectDsh,onUpdate:value=>publishModelCatalog(value),networkEnv:()=>network.env(),...harnessOptions.modelDirectoryOptions});
 store.agents.dshModels.setCatalogReader(()=>dshDirectory.snapshot());
 const refreshDshForTool=async(name,args={})=>{if(name==='teacher_get_agent_configuration'){const value=dshDirectory.list();if(value.discovery==='pending')await dshDirectory.refresh();}else if(['teacher_propose_agent_configuration','teacher_set_agent_configuration'].includes(name)){const ids=(args.routes||args.plan?.routes||[]).filter(r=>r.harness==='DSH').map(r=>r.model||'');if(ids.length)await dshDirectory.ensureModels(ids);}};
 const userSession=randomBytes(32).toString('hex');let closed=false;
 const changes=()=>store.db.prepare('SELECT total_changes() AS n').get().n;
 const listeners=new Set();let lastHostSeen=null;const notify=()=>{for(const r of listeners){if(r.writableLength>1_000_000){r.destroy();continue;}r.write('data: changed\n\n');}};
 const publishReply=value=>{const event='event: reply-stream\ndata: '+JSON.stringify(value)+'\n\n';for(const r of listeners){if(r.writableLength>1_000_000){r.destroy();continue;}r.write(event);}};
 const publishProgress=value=>{const event='event: run-progress\ndata: '+JSON.stringify(value)+'\n\n';for(const r of listeners){if(r.writableLength>1_000_000){r.destroy();continue;}r.write(event);}};
 const publishModelCatalog=value=>{const event='event: dsh-model-catalog\ndata: '+JSON.stringify(value)+'\n\n';for(const r of listeners){if(r.writableLength>1_000_000){r.destroy();continue;}r.write(event);}};
 const executor=modelExecutor(store,{beforeTool:refreshDshForTool,...executorOptions,notify});
 const hostDriver=codexHost(store,{...hostOptions,dataDir,baseUrl:()=>`http://127.0.0.1:${server.address().port}`,notify});
 const harnessDriver=harnessHost(store,{readDshModel:route=>dshDirectory.resolve(route),dshEnv:()=>network.env(),...harnessOptions,dataDir,baseUrl:()=>`http://127.0.0.1:${server.address().port}`,notify,publishReply,publishProgress});
 const json=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 const authorized=req=>{const got=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,'')),expected=Buffer.from(token);return got.length===expected.length&&timingSafeEqual(got,expected);};
 async function body(req,limit=700000){let chunks=[],n=0;for await(const chunk of req){n+=chunk.length;if(n>limit)throw new AppError('请求过大',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new AppError('JSON 格式无效');}}
 const serveAsset=staticAssets();
 const server=http.createServer(async(req,res)=>{
  try{
   const host=req.headers.host||'';if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host))throw new AppError('只允许本机访问',403);
   const origin=req.headers.origin;if(origin&&origin!==`http://${host}`)throw new AppError('不允许跨站访问',403);
   if(req.headers['sec-fetch-site']==='cross-site'&&(req.url.startsWith('/api/')||req.url.startsWith('/mcp')))throw new AppError('不允许跨站访问',403);
   const url=new URL(req.url,`http://${host}`),path=url.pathname;
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; font-src 'self' blob:; frame-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'");
   if(['/api/harness/catalog','/api/harness/tool'].includes(path)){
    if(req.method!=='POST'||!harnessDriver.authenticate((req.headers.authorization||'').replace(/^Bearer /,'')))throw new AppError('此任务的宿主凭据已失效',401);
    const input=await body(req),credential=(req.headers.authorization||'').replace(/^Bearer /,'');
    if(path==='/api/harness/tool')await refreshDshForTool(input.name,input.arguments);
    json(res,200,path==='/api/harness/catalog'?harnessDriver.catalog(credential):harnessDriver.invoke(credential,input));return;
   }
   if(path.startsWith('/api/host/')&&['/api/host/catalog','/api/host/tool'].includes(path)){
    if(req.method!=='POST'||!hostDriver.authenticate((req.headers.authorization||'').replace(/^Bearer /,'')))throw new AppError('此任务的宿主凭据已失效',401);
    const a=await body(req);json(res,200,path==='/api/host/catalog'?hostDriver.catalog():hostDriver.invoke(a));return;
   }
   if(path.startsWith('/mcp/agents/')||['/api/agents/catalog','/api/agents/tool'].includes(path)){
    if(req.method!=='POST')throw new AppError('Use POST',405);
    const input=await body(req),role=path.startsWith('/mcp/agents/')?path.slice('/mcp/agents/'.length):input.role;
    if(!store.agents.authenticate(role,(req.headers.authorization||'').replace(/^Bearer /,'')))throw new AppError('Agent 凭据无效或入口不匹配',401);
    if(path==='/api/agents/catalog'){json(res,200,{tools:agentCatalog(role).map(t=>({name:t.name,description:t.description,inputSchema:zodToJsonSchema(t.schema,{$refStrategy:'none'})}))});return;}
    if(path==='/api/agents/tool'){await refreshDshForTool(input.name,input.arguments);const result=await agentInvoke(store,role,input.name,input.arguments||{});notify();json(res,200,result);return;}
    const mcp=new McpServer({name:'ai-teacher-'+role,version});
    for(const t of agentCatalog(role))mcp.registerTool(t.name,{description:t.description,inputSchema:t.schema.shape},async a=>{try{await refreshDshForTool(t.name,a);const result=await agentInvoke(store,role,t.name,a);notify();return {content:[{type:'text',text:JSON.stringify(result)}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await mcp.connect(transport);res.on('close',()=>{transport.close();mcp.close();});await transport.handleRequest(req,res,input);return;
   }
   if(path==='/mcp'){
    if(!authorized(req))throw new AppError('Agent 身份验证失败',401);
    if(req.method!=='POST'){json(res,405,{error:'Use POST'});return;}
    lastHostSeen=new Date().toISOString();
    const mcp=new McpServer({name:'ai-teacher',version});
    for(const [name,t] of Object.entries(tools))mcp.registerTool(name,{description:t.description,inputSchema:t.schema.shape},async a=>{try{await refreshDshForTool(name,a);const result=await invoke(store,name,a);notify();return {content:[{type:'text',text:JSON.stringify(result)}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    await mcp.connect(transport);res.on('close',()=>{transport.close();mcp.close();});await transport.handleRequest(req,res,await body(req));return;
   }
   if(path==='/api/agent/tool'&&req.method==='POST'){
    if(!authorized(req))throw new AppError('Agent 身份验证失败',401);
    const input=await body(req);lastHostSeen=new Date().toISOString();await refreshDshForTool(input.name,input.arguments);const result=await invoke(store,input.name,input.arguments||{});notify();json(res,200,result);return;
   }
   if(path.startsWith('/api/')&&path!=='/api/health'&&path!=='/api/openapi.json'&&!(req.headers.cookie||'').split(';').some(x=>x.trim()==='teacher_session='+userSession))throw new AppError('请刷新页面以连接本地工作台',401);
   if(path==='/api/events'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');listeners.add(res);const modelCatalog=dshDirectory.snapshot();if(modelCatalog.discovery==='runtime')res.write('event: dsh-model-catalog\ndata: '+JSON.stringify(modelCatalog)+'\n\n');for(const value of harnessDriver.runProgress())res.write('event: run-progress\ndata: '+JSON.stringify(value)+'\n\n');for(const value of harnessDriver.replyStreams())res.write('event: reply-stream\ndata: '+JSON.stringify(value)+'\n\n');req.on('close',()=>listeners.delete(res));return;}
   if(req.method==='GET'&&path==='/api/agents/dsh-models'){json(res,200,url.searchParams.get('refresh')==='1'?await dshDirectory.refresh({force:true}):dshDirectory.list());return;}
   if(req.method==='GET'&&path==='/api/agents/dsh-network'){json(res,200,network.get());return;}
   if(req.method==='GET'&&path==='/api/run-progress'){json(res,200,harnessDriver.runProgress());return;}
   if(req.method==='GET'&&path==='/api/reply-streams'){json(res,200,harnessDriver.replyStreams());return;}
   if(req.method==='GET'&&path==='/api/state'){backgroundUpdate(()=>{store.recover();store.models.sync();});json(res,200,{...store.overview(),resource_files:store.db.prepare('SELECT resource_id,name,length(content) AS size FROM resource_files').all(),host:{last_seen:lastHostSeen,dsh_residents:harnessDriver.residentState()},local:true});return;}
   if(req.method==='GET'&&path==='/api/knowledge-profile'){json(res,200,store.knowledgeProfile.state(null,{full:url.searchParams.get('full')==='1'}));return;}
   if(req.method==='GET'&&path==='/api/weekly-study'){json(res,200,store.adaptive.week({start_date:url.searchParams.get('start_date')||undefined,tz_offset:Number(url.searchParams.get('tz_offset')||0)}));return;}
   if(req.method==='GET'&&path==='/api/week-plan/settings'){json(res,200,store.weekPlan.settings());return;}
   if(req.method==='GET'&&path==='/api/reader-file'){const f=await readerFile(store,url.searchParams.get('id'));res.setHeader('Content-Type',f.type);res.setHeader('Cache-Control','no-store');res.end(f.bytes);return;}
   if(req.method==='GET'&&path==='/api/reading-annotations'){json(res,200,store.study.annotations(url.searchParams.get('id')));return;}
   if(req.method==='GET'&&path==='/api/resource-file'){const file=store.db.prepare('SELECT name,content FROM resource_files WHERE resource_id=?').get(url.searchParams.get('id'));if(!file)throw new AppError('文件不存在',404);res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)));res.setHeader('Cache-Control','no-store');res.end(Buffer.from(file.content));return;}
   if(req.method==='GET'&&path==='/api/health'){json(res,200,{ok:true,service:'ai-teacher',version,features:['study-reader','harness-routing','learning-loop','review-followups','remediation-plans','calendar-recovery','dsh-harness','dsh-discovery','dsh-desktop-model','dsh-sessions','dsh-shared-workspace','chat-markdown-ui','dsh-reply-streaming','workspace-performance','dsh-model-picker','chat-studio-ui','dsh-runtime-models','direct-agent-config','fast-model-catalog','execution-feedback','dsh-web-tools','prior-learning','canonical-v1-learning','stable-editor-input','reliable-task-recovery','quiet-model-catalog','chat-scroll-position','guided-planning-flow','reader-network-recovery','conversation-revisions','task-learning-conversations','collapsible-reader-sidebar','independent-reader-annotations','flexible-workspace-layout','ui-information-layout','chat-file-attachments','contextual-reader-return','clickable-question-choices','choice-teaching-guidance','neutral-question-guidance','resident-dsh-host','automatic-web-search','public-assessment-explanation','assessment-lifecycle','home-profile-conversation'],data_id:dataId});return;}
   if(req.method==='GET'&&path==='/api/messages'){json(res,200,store.messages(url.searchParams.get('conversation_id')));return;}
   if(req.method==='GET'&&path==='/api/prior-learning'){
    const goalId=url.searchParams.get('goal_id');
    if(!store.db.prepare('SELECT 1 FROM goals WHERE id=?').get(goalId))throw new AppError('目标不存在',404);
    json(res,200,priorLearning(store.db,goalId));return;
   }
   if(req.method==='GET'&&path==='/api/assessment-rounds'){json(res,200,store.learning.rounds({id:url.searchParams.get('id')}));return;}
   if(req.method==='GET'&&path==='/api/material-content'){json(res,200,store.learning.readMaterial({content_id:url.searchParams.get('id'),goal_id:url.searchParams.get('goal_id')||undefined}));return;}
   if(req.method==='GET'&&path==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="ai-teacher-export.json"');const {models,hostAutomation,agents,...state}=store.overview();json(res,200,{...state,messages:state.conversations.flatMap(c=>store.messages(c.id))});return;}
   if(req.method==='GET'&&path==='/api/openapi.json'){json(res,200,JSON.parse(readFileSync(new URL('../docs/openapi.json',import.meta.url),'utf8')));return;}
   if(req.method==='POST'&&path.startsWith('/api/')){
    if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError('需要 application/json',415);
    // Agent credentials never authorize user-only confirmation or note-edit routes.
    if(req.headers.authorization)throw new AppError('Agent 不可调用用户维护接口',403);
    const a=await body(req,path==='/api/resources'?28000000:700000);let result;const tracked=['/api/notes','/api/notes/archive','/api/open-book/save-draft','/api/calendar','/api/calendar/cancel','/api/calendar/move','/api/discussions/draft','/api/study/edit'].includes(path);const before=tracked?store.study.auditSnapshot():null;
    switch(path){
     case '/api/planning-flow/start':result=store.planningFlow.start(a);break;
     case '/api/planning-flow/control':result=store.planningFlow.control(a);break;
     case '/api/planning-flow/diagnostic':result=store.planningFlow.beginDiagnostic(a);break;
     case '/api/planning-flow/revise':result=store.planningFlow.revise(a);break;
     case '/api/planning-flow/decide':result=store.planningFlow.decide(a);break;
     case '/api/planning-flow/rework':result=store.planningFlow.rework(a);break;
     case '/api/planning-flow/retry':result=store.planningFlow.retry(a);break;
     case '/api/agents/dsh-model':if(a.model)await dshDirectory.ensureModels([a.model]);store.agents.dshModels.validate(a.model);store.models.sync();result=store.agents.dshModels.save(a.conversation_id,a.model);break;
     case '/api/agents/configuration/undo':result=store.agents.undoConfiguration(a);break;
     case '/api/agents/dsh-network':result=network.set(a.proxy_url);break;
     case '/api/agents/detect-dsh':result=await harnessDriver.detectDsh({refresh:a.refresh===true});break;
     case '/api/agents/dsh-session/check':result=await harnessDriver.checkSession(a);break;
     case '/api/agents/dsh-session/reset':result=await harnessDriver.resetSession(a);break;
     case '/api/agents/configure':result=store.agents.configure(a);break;
     case '/api/agents/token':{result=store.agents.token(a.role);result.stdio={mcpServers:{['ai-teacher-'+a.role]:{command:process.execPath,args:[fileURLToPath(new URL('../scripts/agent-mcp.mjs',import.meta.url))],env:{TEACHER_URL:`http://127.0.0.1:${server.address().port}`,TEACHER_AGENT_ROLE:a.role,TEACHER_TOKEN:result.token}}}};break;}
     case '/api/agents/decide':result=store.agents.decide(a);break;
     case '/api/agents/conversation':result=store.agents.conversation();break;
     case '/api/agents/retry':result=store.agents.retry(a);break;

     case '/api/study/open':result=store.study.open(a);break;
     case '/api/study/progress':result=store.study.progress(a);break;
     case '/api/study/annotate':result=store.study.annotate(a);break;
     case '/api/study/link':result=store.study.link(a);break;
     case '/api/study/ask':result=store.study.ask(a);break;
     case '/api/study/onboarding':result=store.study.onboarding(a);break;
     case '/api/study/confirm':result=store.study.confirm(a);break;
     case '/api/study/skip':result=store.study.skip(a);break;
     case '/api/study/edit':{
      const specs={goal:['goals',['title','domain','scope']],session:['sessions',['title','objective']],requirement:['requirements',['description']],profile:['profiles',['content']]};
      const spec=specs[a.type];if(!spec)throw new AppError('修改类型无效');const [table,fields]=spec,key=a.type==='profile'?'goal_id':'id';
      if(!store.db.prepare('SELECT * FROM '+table+' WHERE '+key+'=?').get(a.id))throw new AppError('记录不存在');
      const entries=Object.entries(a.fields||{});if(!entries.length||entries.some(([k,v])=>!fields.includes(k)||typeof v!=='string'||!v.trim()||v.length>10000))throw new AppError('修改字段无效');
      const old=store.db.prepare('SELECT * FROM '+table+' WHERE '+key+'=?').get(a.id),gid=a.type==='goal'?old.id:old.goal_id;
      const goal=store.db.prepare('SELECT * FROM goals WHERE id=?').get(gid);if(['COMPLETED','ABANDONED'].includes(goal?.status))throw new AppError('已结束目标的内容已冻结');
      if(a.type==='session'&&old.status!=='PLANNED')throw new AppError('只能修改尚未开始的任务');
      if(a.type==='requirement'){
       const set=store.db.prepare("SELECT * FROM capability_sets WHERE id=? AND status='ACCEPTED'").get(old.set_id);if(!set)throw new AppError('只能修改当前能力要求');
       const items=store.db.prepare('SELECT * FROM readiness_items WHERE set_id=? ORDER BY rowid').all(set.id).map(i=>({title:i.title,kind:i.kind,requirements:store.db.prepare('SELECT r.*,n.name AS node FROM requirements r JOIN knowledge_nodes n ON n.id=r.node_id WHERE r.readiness_id=? ORDER BY r.rowid').all(i.id).map(r=>({node:r.node,description:r.id===a.id?a.fields.description:r.description}))}));
       const proposed=store.learning.proposeCapabilities({goal_id:gid,items,request_id:randomBytes(16).toString('hex')});store.learning.confirmCapabilities({id:proposed.proposal_id,accept:true});
       store.study.record([{type:'requirements',id:a.id,before:{description:old.description},after:{description:a.fields.description}}]);
      }else store.db.prepare('UPDATE '+table+' SET '+entries.map(([k])=>k+'=?').join(',')+' WHERE '+key+'=?').run(...entries.map(([,v])=>v.trim()),a.id);result={ok:true};break;
     }

     case '/api/calendar':result=store.calendar.save(a);break;
     case '/api/remediation/schedule':result=store.remediation.schedule(a);break;
     case '/api/calendar/recovery-options':result=store.recovery.options(a);break;
     case '/api/calendar/recovery-preview':result=store.recovery.preview(a);break;
     case '/api/calendar/recovery-commit':result=store.recovery.commit(a);break;
     case '/api/calendar/preview':result=store.calendar.preview(a);break;
     case '/api/calendar/batch':result=store.calendar.batch(a);break;
     case '/api/calendar/done':result=store.calendar.done(a);break;
     case '/api/calendar/progress':result=store.calendar.progress(a);break;
     case '/api/calendar/cancel':result=store.calendar.cancel(a);break;
     case '/api/calendar/move':result=store.calendar.move(a);break;
     case '/api/discussions':result=store.discovery.create(a);break;
     case '/api/discussions/draft':result=store.discovery.save(a);break;
     case '/api/discussions/suggestion':result=store.discovery.decide(a);break;
     case '/api/discussions/input':result=store.discovery.saveInput(a);break;
     case '/api/discussions/confirm':result=store.discovery.confirm(a);break;
     case '/api/goals':result=store.createGoal(a);break;
     case '/api/conversations':result=store.newConversation(a.goal_id,a.title);break;
     case '/api/sessions/learning':result=store.sessionLearning.open(a);break;
     case '/api/messages':store.models.validateTask(a.conversation_id,a.task_kind,a.content_id);if(a.learning_intent && (a.task_kind!=='chat'||typeof a.subject_id!=='string'))throw new AppError('请指定目标对话操作及来源');result=store.send(a.conversation_id,a.content,a.request_id,a.learning_intent?{intent:a.learning_intent,subject_id:a.subject_id}:undefined,a.attachment_resource_ids,a.choice_answer);{const j=store.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(result.message_id);if(j)store.models.tag(j.id,a.task_kind,a.content_id);}break;
     case '/api/host/settings':result=store.hostConfig.save(a);if(!result.enabled)hostDriver.abort();break;
     case '/api/host/check':result=await hostDriver.check();break;
     case '/api/models/profile':result=store.models.save(a);break;
     case '/api/models/routes':result=store.models.routes(a);break;
     case '/api/models/enabled':result=store.models.enabled(a.enabled);if(!a.enabled)executor.abort();break;
     case '/api/models/test':result=await executor.test(a.id);break;
     case '/api/models/retry':result=store.models.reroute(a);break;
     case '/api/resources':result=store.resource(a);break;
     case '/api/resources/goal':result=store.attachResource(a);break;
     case '/api/notes':result=store.saveNote(a);break;
     case '/api/notes/archive':result=store.archiveNote(a.id,a.archived);break;
     case '/api/notes/verification/start':result=store.practice.start(a);break;
     case '/api/notes/verification/defer':result=store.practice.defer(a);break;
     case '/api/notes/verification/decline':result=store.practice.decline(a);break;
     case '/api/prompts':result=store.savePrompt(a.content);break;
     case '/api/proposals/decide':if(typeof a.accept!=='boolean')throw new AppError('确认值无效');result=store.learning.decide(a);break;
     case '/api/capabilities/decide':if(typeof a.accept!=='boolean')throw new AppError('确认值无效');result=store.learning.confirmCapabilities(a);break;
     case '/api/material-content':result=store.learning.material(a);break;
     case '/api/open-book/search':result=store.openBook.search(a);break;
     case '/api/open-book/read':result=store.openBook.read(a);break;
     case '/api/open-book/save-draft':result=store.openBook.saveDraft(a);break;
     case '/api/material-map/resolve':result=store.learning.materialMap.resolve(a);break;
     case '/api/knowledge-profile/topics':result=store.knowledgeProfile.createTopic(a);break;
     case '/api/knowledge-profile/node-topic':result=store.knowledgeProfile.assignNode(a);break;
     case '/api/knowledge-profile/decide':result=store.knowledgeProfile.decide(a);break;
     case '/api/knowledge-profile/topic-decide':result=store.knowledgeProfile.decideTopicReorganization(a);break;
     case '/api/assessments':result=store.learning.begin(a);break;
     case '/api/assessments/end':result=store.learning.endEarly(a);break;
     case '/api/assessments/pause':result=store.learning.pause(a);break;
     case '/api/assessments/resume':result=store.learning.resume(a);break;
     case '/api/assessments/comment':result=store.learning.comment(a);break;
     case '/api/assessments/continue':result=store.learning.continueEnded(a);break;
     case '/api/gaps/route':result=store.learning.routeGap(a);break;
     case '/api/reviews':result=store.learning.schedule(a);break;
     case '/api/reviews/start':result=store.learning.startReview(a);break;
     case '/api/reviews/date':result=store.learning.reschedule(a);break;
     case '/api/reviews/followup':result=store.followups.schedule(a);break;
     case '/api/reviews/cancel':result=store.followups.cancel(a);break;
     case '/api/adaptive-review/settings':result=store.adaptive.setIntensity(a);break;
     case '/api/adaptive-review/accept':result=store.adaptive.accept(a);break;
     case '/api/week-plan/settings':result=store.weekPlan.saveSettings(a);break;
     case '/api/week-plan/preview':result=store.weekPlan.preview(a);break;
     case '/api/week-plan/commit':result=store.weekPlan.commit(a);break;
     case '/api/goals/end':result=store.learning.endGoal(a);break;
     case '/api/goals/archive':if(typeof a.archived!=='boolean')throw new AppError('归档值无效');result=store.learning.archive(a);break;
     case '/api/goals/status':result=store.setGoalStatus(a.id,a.status);break;
     case '/api/rolling-plan/settings':result=store.rollingPlan.configure(a);break;
     case '/api/rolling-plan/defer':result=store.rollingPlan.defer(a);break;
     case '/api/rolling-plan/restore':result=store.rollingPlan.restore(a);break;
     case '/api/rolling-plan/remove':result=store.rollingPlan.removeSession(a);break;
     case '/api/rolling-plan/exclude-topic':result=store.rollingPlan.excludeTopic(a);break;
     case '/api/rolling-plan/restore-topic':result=store.rollingPlan.restoreTopic(a);break;
     case '/api/sessions/assess':result=store.startSession(a.id,a.mode);break;
     case '/api/jobs/cancel':result=store.cancel(a.id);break;
     default:throw new AppError('接口不存在',404);
    }if(before)store.study.audit(before);notify();json(res,200,result);return;
   }
   if(req.method==='GET'&&/^\/vendor\/(cmaps|standard_fonts|wasm)\/[A-Za-z0-9_.-]+$/.test(path)){await serveAsset(req,res,new URL('../node_modules/pdfjs-dist/'+path.slice(8),import.meta.url),path.endsWith('.wasm')?'application/wasm':'application/octet-stream');return;}
   const vendors={'/vendor/pdf.mjs':'pdfjs-dist/build/pdf.mjs','/vendor/pdf.worker.mjs':'pdfjs-dist/build/pdf.worker.mjs','/vendor/marked.js':'marked/lib/marked.esm.js','/vendor/purify.js':'dompurify/dist/purify.es.mjs'};
   if(req.method==='GET'&&vendors[path]){await serveAsset(req,res,new URL('../node_modules/'+vendors[path],import.meta.url),'text/javascript; charset=utf-8');return;}
   const files={'/layout-resize.js':'layout-resize.js','/message-choices.js':'message-choices.js','/chat-attachments.js':'chat-attachments.js','/session-learning.js':'session-learning.js','/planning-flow.js':'planning-flow.js','/prior-learning.js':'prior-learning.js','/weekly-study.js':'weekly-study.js','/week-plan.js':'week-plan.js','/run-progress.js':'run-progress.js','/chat-ui.js':'chat-ui.js','/conversation.css':'conversation.css','/dsh-model-picker.css':'dsh-model-picker.css','/dsh-model-picker.js':'dsh-model-picker.js','/workspace.css':'workspace.css','/live-events.js':'live-events.js','/reply-stream.js':'reply-stream.js','/message-content.js':'message-content.js','/message-content.css':'message-content.css','/recovery.js':'recovery.js','/remediation.js':'remediation.js','/followups.js':'followups.js','/knowledge-profile.js':'knowledge-profile.js','/material-map.js':'material-map.js','/journey.js':'journey.js','/agents.js':'agents.js','/agents.html':'agents.html','/agent-chat.js':'agent-chat.js','/reader.html':'reader.html','/reader.js':'reader.js','/reader.css':'reader.css','/document.html':'document.html','/document.js':'document.js','/personal.html':'personal.html','/personal.js':'personal.js','/':'index.html','/app.js':'app.js','/resources.js':'resources.js','/discovery.js':'discovery.js','/calendar.js':'calendar.js','/tasks.js':'tasks.js','/roadmap.js':'roadmap.js','/rolling-plan.js':'rolling-plan.js','/open-book.js':'open-book.js','/details.js':'details.js','/learning.js':'learning.js','/models.js':'models.js','/host.js':'host.js','/style.css':'style.css'};
   if(req.method!=='GET'||!files[path])throw new AppError('页面不存在',404);
   if(['/', '/reader.html','/personal.html','/agents.html'].includes(path))res.setHeader('Set-Cookie',`teacher_session=${userSession}; HttpOnly; SameSite=Strict; Path=/`);
   await serveAsset(req,res,new URL('../public/'+files[path],import.meta.url),({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(files[path])]);
  }catch(e){if(!res.headersSent)json(res,e.status||400,{error:e.name==='ZodError'?'工具参数不符合要求':e.message});else res.end();}
 });
 // Only publish changes made by this maintenance operation. Lease renewals and
 // host heartbeats elsewhere must not cause a full workspace refresh.
 const backgroundUpdate=operation=>{const before=changes();const result=operation();if(changes()!==before)notify();return result;};
 const studyTimer=setInterval(()=>{try{backgroundUpdate(()=>{store.study.tick();store.planningFlow.reconcile();});}catch{}},5000);studyTimer.unref();
 const heartbeat=setInterval(()=>{backgroundUpdate(()=>store.recover());for(const r of listeners)r.write(': heartbeat\n\n');},15000);heartbeat.unref();
 server.on('close',()=>{clearInterval(studyTimer);clearInterval(heartbeat);Promise.all([dshDirectory.close(),executor.stop(),hostDriver.stop(),harnessDriver.stop()]).then(()=>{store.db.close();finishClose();});});
 server.listen(port,'127.0.0.1',()=>console.log(`AI Teacher: http://127.0.0.1:${server.address().port}`));
 return {server,store,token,executor,hostDriver,harnessDriver,close:()=>{if(closed)return closedPromise;closed=true;for(const r of listeners)r.end();server.closeAllConnections();server.close();return closedPromise;}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer();
