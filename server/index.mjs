import {codexHost} from './codex-host.mjs';
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

export function startServer({executorOptions={},hostOptions={},port=Number(process.env.PORT||4317),dataDir=process.env.TEACHER_DATA_DIR||fileURLToPath(new URL('../data',import.meta.url))}={}){
 const dataId=createHash('sha256').update(process.platform==='win32'?resolve(dataDir).toLowerCase():resolve(dataDir)).digest('hex');
 let finishClose;const closedPromise=new Promise(resolve=>{finishClose=resolve;});
 mkdirSync(dataDir,{recursive:true});const keyFile=resolve(dataDir,'agent-token');if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32).toString('hex'),{mode:0o600});const token=readFileSync(keyFile,'utf8').trim();
 const store=createStore(resolve(dataDir,'teacher.sqlite'));
 const userSession=randomBytes(32).toString('hex');let closed=false;
 const listeners=new Set();let lastHostSeen=null;const notify=()=>{for(const r of listeners)r.write('data: changed\n\n');};
 const executor=modelExecutor(store,{...executorOptions,notify});
 const hostDriver=codexHost(store,{...hostOptions,dataDir,baseUrl:()=>`http://127.0.0.1:${server.address().port}`,notify});
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
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'");
   if(path.startsWith('/api/host/')&&['/api/host/catalog','/api/host/tool'].includes(path)){
    if(req.method!=='POST'||!hostDriver.authenticate((req.headers.authorization||'').replace(/^Bearer /,'')))throw new AppError('此任务的宿主凭据已失效',401);
    const a=await body(req);json(res,200,path==='/api/host/catalog'?hostDriver.catalog():hostDriver.invoke(a));return;
   }
   if(path==='/mcp'){
    if(!authorized(req))throw new AppError('Agent 身份验证失败',401);
    if(req.method!=='POST'){json(res,405,{error:'Use POST'});return;}
    lastHostSeen=new Date().toISOString();
    const mcp=new McpServer({name:'ai-teacher',version:'0.4.0'});
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
   if(req.method==='GET'&&path==='/api/resource-file'){const file=store.db.prepare('SELECT name,content FROM resource_files WHERE resource_id=?').get(url.searchParams.get('id'));if(!file)throw new AppError('文件不存在',404);res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)));res.setHeader('Cache-Control','no-store');res.end(Buffer.from(file.content));return;}
   if(req.method==='GET'&&path==='/api/health'){json(res,200,{ok:true,service:'ai-teacher',version:'0.4.0',data_id:dataId});return;}
   if(req.method==='GET'&&path==='/api/messages'){json(res,200,store.messages(url.searchParams.get('conversation_id')));return;}
   if(req.method==='GET'&&path==='/api/assessment-rounds'){json(res,200,store.learning.rounds({id:url.searchParams.get('id')}));return;}
   if(req.method==='GET'&&path==='/api/material-content'){json(res,200,store.learning.readMaterial({content_id:url.searchParams.get('id')}));return;}
   if(req.method==='GET'&&path==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="ai-teacher-export.json"');const {models,hostAutomation,...state}=store.overview();json(res,200,{...state,messages:state.conversations.flatMap(c=>store.messages(c.id))});return;}
   if(req.method==='GET'&&path==='/api/openapi.json'){json(res,200,JSON.parse(readFileSync(new URL('../docs/openapi.json',import.meta.url),'utf8')));return;}
   if(req.method==='POST'&&path.startsWith('/api/')){
    if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError('需要 application/json',415);
    // Agent credentials never authorize user-only confirmation or note-edit routes.
    if(req.headers.authorization)throw new AppError('Agent 不可调用用户维护接口',403);
    const a=await body(req,path==='/api/resources'?28000000:700000);let result;
    switch(path){
     case '/api/calendar':result=store.calendar.save(a);break;
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
     case '/api/goals/end':result=store.learning.endGoal(a);break;
     case '/api/goals/archive':if(typeof a.archived!=='boolean')throw new AppError('归档值无效');result=store.learning.archive(a);break;
     case '/api/goals/status':result=store.setGoalStatus(a.id,a.status);break;
     case '/api/sessions/assess':result=store.startSession(a.id,a.mode);break;
     case '/api/jobs/cancel':result=store.cancel(a.id);break;
     default:throw new AppError('接口不存在',404);
    }notify();json(res,200,result);return;
   }
   const files={'/':'index.html','/app.js':'app.js','/resources.js':'resources.js','/discovery.js':'discovery.js','/calendar.js':'calendar.js','/tasks.js':'tasks.js','/learning.js':'learning.js','/models.js':'models.js','/host.js':'host.js','/style.css':'style.css'};
   if(req.method!=='GET'||!files[path])throw new AppError('页面不存在',404);
   if(path==='/')res.setHeader('Set-Cookie',`teacher_session=${userSession}; HttpOnly; SameSite=Strict; Path=/`);
   res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(files[path])]);res.end(readFileSync(new URL('../public/'+files[path],import.meta.url)));
  }catch(e){if(!res.headersSent)json(res,e.status||400,{error:e.name==='ZodError'?'工具参数不符合要求':e.message});else res.end();}
 });
 const heartbeat=setInterval(()=>{store.recover();for(const r of listeners)r.write(': heartbeat\n\n');},15000);heartbeat.unref();
 server.on('close',()=>{clearInterval(heartbeat);Promise.all([executor.stop(),hostDriver.stop()]).then(()=>{store.db.close();finishClose();});});
 server.listen(port,'127.0.0.1',()=>console.log(`AI Teacher: http://127.0.0.1:${server.address().port}`));
 return {server,store,token,executor,hostDriver,close:()=>{if(closed)return closedPromise;closed=true;for(const r of listeners)r.end();server.closeAllConnections();server.close();return closedPromise;}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer();
