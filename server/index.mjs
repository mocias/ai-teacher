import {agentCatalog,agentInvoke} from './agent-mcp.mjs';
import {version} from './version.mjs';
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
 const userSession=randomBytes(32).toString('hex');let closed=false;
 const listeners=new Set();let lastHostSeen=null;const notify=()=>{for(const r of listeners)r.write('data: changed\n\n');};
 const executor=modelExecutor(store,{...executorOptions,notify});
 const hostDriver=codexHost(store,{...hostOptions,dataDir,baseUrl:()=>`http://127.0.0.1:${server.address().port}`,notify});
 const harnessDriver=harnessHost(store,{...harnessOptions,dataDir,baseUrl:()=>`http://127.0.0.1:${server.address().port}`,notify});
 const json=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 const authorized=req=>{const got=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,'')),expected=Buffer.from(token);return got.length===expected.length&&timingSafeEqual(got,expected);};
 async function body(req,limit=700000){let chunks=[],n=0;for await(const chunk of req){n+=chunk.length;if(n>limit)throw new AppError('请求过大',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new AppError('JSON 格式无效');}}
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
    if(path==='/api/agents/tool'){const result=await agentInvoke(store,role,input.name,input.arguments||{});notify();json(res,200,result);return;}
    const mcp=new McpServer({name:'ai-teacher-'+role,version});
    for(const t of agentCatalog(role))mcp.registerTool(t.name,{description:t.description,inputSchema:t.schema.shape},async a=>{try{const result=await agentInvoke(store,role,t.name,a);notify();return {content:[{type:'text',text:JSON.stringify(result)}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await mcp.connect(transport);res.on('close',()=>{transport.close();mcp.close();});await transport.handleRequest(req,res,input);return;
   }
   if(path==='/mcp'){
    if(!authorized(req))throw new AppError('Agent 身份验证失败',401);
    if(req.method!=='POST'){json(res,405,{error:'Use POST'});return;}
    lastHostSeen=new Date().toISOString();
    const mcp=new McpServer({name:'ai-teacher',version});
    for(const [name,t] of Object.entries(tools))mcp.registerTool(name,{description:t.description,inputSchema:t.schema.shape},async a=>{try{const result=await invoke(store,name,a);notify();return {content:[{type:'text',text:JSON.stringify(result)}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    await mcp.connect(transport);res.on('close',()=>{transport.close();mcp.close();});await transport.handleRequest(req,res,await body(req));return;
   }
   if(path==='/api/agent/tool'&&req.method==='POST'){
    if(!authorized(req))throw new AppError('Agent 身份验证失败',401);
    const input=await body(req);lastHostSeen=new Date().toISOString();const result=await invoke(store,input.name,input.arguments||{});notify();json(res,200,result);return;
   }
   if(path.startsWith('/api/')&&path!=='/api/health'&&path!=='/api/openapi.json'&&!(req.headers.cookie||'').split(';').some(x=>x.trim()==='teacher_session='+userSession))throw new AppError('请刷新页面以连接本地工作台',401);
   if(path==='/api/events'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');listeners.add(res);req.on('close',()=>listeners.delete(res));return;}
   if(req.method==='GET'&&path==='/api/state'){store.recover();store.models.sync();json(res,200,{...store.overview(),resource_files:store.db.prepare('SELECT resource_id,name,length(content) AS size FROM resource_files').all(),host:{last_seen:lastHostSeen},local:true});return;}
   if(req.method==='GET'&&path==='/api/reader-file'){const f=await readerFile(store,url.searchParams.get('id'));res.setHeader('Content-Type',f.type);res.setHeader('Cache-Control','no-store');res.end(f.bytes);return;}
   if(req.method==='GET'&&path==='/api/reading-annotations'){json(res,200,store.study.annotations(url.searchParams.get('id')));return;}
   if(req.method==='GET'&&path==='/api/resource-file'){const file=store.db.prepare('SELECT name,content FROM resource_files WHERE resource_id=?').get(url.searchParams.get('id'));if(!file)throw new AppError('文件不存在',404);res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)));res.setHeader('Cache-Control','no-store');res.end(Buffer.from(file.content));return;}
   if(req.method==='GET'&&path==='/api/health'){json(res,200,{ok:true,service:'ai-teacher',version,features:['study-reader','harness-routing','learning-loop','review-followups','remediation-plans'],data_id:dataId});return;}
   if(req.method==='GET'&&path==='/api/messages'){json(res,200,store.messages(url.searchParams.get('conversation_id')));return;}
   if(req.method==='GET'&&path==='/api/assessment-rounds'){json(res,200,store.learning.rounds({id:url.searchParams.get('id')}));return;}
   if(req.method==='GET'&&path==='/api/material-content'){json(res,200,store.learning.readMaterial({content_id:url.searchParams.get('id')}));return;}
   if(req.method==='GET'&&path==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="ai-teacher-export.json"');const {models,hostAutomation,agents,...state}=store.overview();json(res,200,{...state,messages:state.conversations.flatMap(c=>store.messages(c.id))});return;}
   if(req.method==='GET'&&path==='/api/openapi.json'){json(res,200,JSON.parse(readFileSync(new URL('../docs/openapi.json',import.meta.url),'utf8')));return;}
   if(req.method==='POST'&&path.startsWith('/api/')){
    if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError('需要 application/json',415);
    // Agent credentials never authorize user-only confirmation or note-edit routes.
    if(req.headers.authorization)throw new AppError('Agent 不可调用用户维护接口',403);
    const a=await body(req,path==='/api/resources'?28000000:700000);let result;const tracked=['/api/notes','/api/notes/archive','/api/calendar','/api/calendar/cancel','/api/calendar/move','/api/discussions/draft','/api/study/edit'].includes(path);const before=tracked?store.study.auditSnapshot():null;
    switch(path){
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
     case '/api/messages':store.models.validateTask(a.conversation_id,a.task_kind,a.content_id);result=store.send(a.conversation_id,a.content,a.request_id);{const j=store.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(result.message_id);if(j)store.models.tag(j.id,a.task_kind,a.content_id);}break;
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
     case '/api/prompts':result=store.savePrompt(a.content);break;
     case '/api/proposals/decide':if(typeof a.accept!=='boolean')throw new AppError('确认值无效');result=store.learning.decide(a);break;
     case '/api/capabilities/decide':if(typeof a.accept!=='boolean')throw new AppError('确认值无效');result=store.learning.confirmCapabilities(a);break;
     case '/api/material-content':result=store.learning.material(a);break;
     case '/api/assessments':result=store.learning.begin(a);break;
     case '/api/assessments/end':result=store.learning.endEarly(a);break;
     case '/api/gaps/route':result=store.learning.routeGap(a);break;
     case '/api/reviews':result=store.learning.schedule(a);break;
     case '/api/reviews/start':result=store.learning.startReview(a);break;
     case '/api/reviews/date':result=store.learning.reschedule(a);break;
     case '/api/reviews/followup':result=store.followups.schedule(a);break;
     case '/api/reviews/cancel':result=store.followups.cancel(a);break;
     case '/api/goals/end':result=store.learning.endGoal(a);break;
     case '/api/goals/archive':if(typeof a.archived!=='boolean')throw new AppError('归档值无效');result=store.learning.archive(a);break;
     case '/api/goals/status':result=store.setGoalStatus(a.id,a.status);break;
     case '/api/sessions/assess':result=store.startSession(a.id,a.mode);break;
     case '/api/jobs/cancel':result=store.cancel(a.id);break;
     default:throw new AppError('接口不存在',404);
    }if(before)store.study.audit(before);notify();json(res,200,result);return;
   }
   if(req.method==='GET'&&/^\/vendor\/(cmaps|standard_fonts|wasm)\/[A-Za-z0-9_.-]+$/.test(path)){res.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':'application/octet-stream');res.end(readFileSync(new URL('../node_modules/pdfjs-dist/'+path.slice(8),import.meta.url)));return;}
   const vendors={'/vendor/pdf.mjs':'pdfjs-dist/build/pdf.mjs','/vendor/pdf.worker.mjs':'pdfjs-dist/build/pdf.worker.mjs','/vendor/marked.js':'marked/lib/marked.esm.js','/vendor/purify.js':'dompurify/dist/purify.es.mjs'};
   if(req.method==='GET'&&vendors[path]){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(readFileSync(new URL('../node_modules/'+vendors[path],import.meta.url)));return;}
   const files={'/remediation.js':'remediation.js','/followups.js':'followups.js','/journey.js':'journey.js','/agents.js':'agents.js','/agents.html':'agents.html','/agent-chat.js':'agent-chat.js','/reader.html':'reader.html','/reader.js':'reader.js','/reader.css':'reader.css','/document.html':'document.html','/document.js':'document.js','/personal.html':'personal.html','/personal.js':'personal.js','/':'index.html','/app.js':'app.js','/resources.js':'resources.js','/discovery.js':'discovery.js','/calendar.js':'calendar.js','/tasks.js':'tasks.js','/roadmap.js':'roadmap.js','/details.js':'details.js','/learning.js':'learning.js','/models.js':'models.js','/host.js':'host.js','/style.css':'style.css'};
   if(req.method!=='GET'||!files[path])throw new AppError('页面不存在',404);
   if(['/', '/reader.html','/personal.html','/agents.html'].includes(path))res.setHeader('Set-Cookie',`teacher_session=${userSession}; HttpOnly; SameSite=Strict; Path=/`);
   res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(files[path])]);res.end(readFileSync(new URL('../public/'+files[path],import.meta.url)));
  }catch(e){if(!res.headersSent)json(res,e.status||400,{error:e.name==='ZodError'?'工具参数不符合要求':e.message});else res.end();}
 });
 const studyTimer=setInterval(()=>{try{store.study.tick();}catch{}},5000);studyTimer.unref();
 const heartbeat=setInterval(()=>{store.recover();for(const r of listeners)r.write(': heartbeat\n\n');},15000);heartbeat.unref();
 server.on('close',()=>{clearInterval(studyTimer);clearInterval(heartbeat);Promise.all([executor.stop(),hostDriver.stop(),harnessDriver.stop()]).then(()=>{store.db.close();finishClose();});});
 server.listen(port,'127.0.0.1',()=>console.log(`AI Teacher: http://127.0.0.1:${server.address().port}`));
 return {server,store,token,executor,hostDriver,harnessDriver,close:()=>{if(closed)return closedPromise;closed=true;for(const r of listeners)r.end();server.closeAllConnections();server.close();return closedPromise;}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer();
