import {writeFileSync,mkdirSync} from 'node:fs';
import {tools} from '../server/tools.mjs';
import {zodToJsonSchema} from 'zod-to-json-schema';
mkdirSync(new URL('../docs/',import.meta.url),{recursive:true});
const string={type:'string'},bool={type:'boolean'};
const entries=[
 ['host/settings','配置 Codex 自动唤醒',{enabled:bool,executable:string,model:string,effort:{enum:['low','medium','high','xhigh']},timeout_seconds:{type:'integer',minimum:30,maximum:1800}},[]],
 ['host/check','检查本机 Codex 登录状态',{},[]],
 ['models/profile','保存 OpenAI 兼容模型连接；Key 只写不回显',{id:string,name:string,base_url:string,model:string,key:{type:'string',writeOnly:true},clear_key:bool,options:{type:'object',properties:{temperature:{type:'number',minimum:0,maximum:2},max_tokens:{type:'integer',minimum:1,maximum:100000},timeout_seconds:{type:'integer',minimum:5,maximum:180},token_parameter:{enum:['max_tokens','max_completion_tokens']}}}},['name','base_url','model']],
 ['models/routes','为模块指定模型；profile_id=null 使用宿主',{routes:{type:'array',items:{type:'object',properties:{module:{enum:['chat','material','capabilities','roadmap','assessment','review','final']},profile_id:{type:['string','null']}},required:['module']}}},['routes']],
 ['models/enabled','启用或暂停 API 自动执行器',{enabled:bool},['enabled']],
 ['models/test','发出简短 API 连接测试（消耗供应商额度）',{id:string},['id']],
 ['models/retry','显式重试或重新分配等待中的任务',{job_id:string,mode:{enum:['HOST','API']},profile_id:string},['job_id','mode']],
 ['capabilities/decide','确认或拒绝能力要求提案',{id:string,accept:bool},['id','accept']],
 ['material-content','保存不可变的资料正文与范围',{resource_id:string,scope:string,content:string},['resource_id','scope','content']],
 ['assessments','发起结构化考察',{goal_id:string,kind:{enum:['INITIAL_DIAGNOSTIC','MATERIAL_SUPPLEMENT','INCREMENTAL_DIAGNOSTIC','QUICK_CHECK','LEARN','REVIEW_DIAGNOSTIC','REVIEW','REINFORCEMENT','ASSESSMENT_REVIEW','NOTE_VERIFICATION','FREE_TEST','FINAL']},mode:{enum:['OPEN_BOOK','CLOSED_BOOK']},scope:string,requirement_ids:{type:'array',items:string},resource_ids:{type:'array',items:string},session_id:string,parent_id:string,gap_id:string,request_id:string},['goal_id','kind','mode','request_id']],
 ['assessments/end','用户提前结束考察，保留问答，不完成目标',{id:string},['id']],
 ['gaps/route','用户选择缺口处理方向',{id:string,status:{enum:['IGNORED','ROUTED_TO_REVIEW','ROUTED_TO_LEARN']}},['id','status']],
 ['reviews','安排复习',{goal_id:string,requirement_id:string,gap_id:string,due_date:{type:'string',format:'date'},reason:string,request_id:string},['goal_id','requirement_id','due_date','reason','request_id']],
 ['reviews/start','开始或恢复复习考察',{id:string,mode:{enum:['OPEN_BOOK','CLOSED_BOOK']},request_id:string},['id','request_id']],
 ['reviews/date','修改待复习日期',{id:string,due_date:{type:'string',format:'date'}},['id','due_date']],
 ['goals/end','完成或终止目标，保存冻结快照',{id:string,status:{enum:['COMPLETED','ABANDONED']},reason:string},['id','status']],
 ['goals/archive','归档或恢复已结束目标的可见性',{id:string,archived:bool},['id','archived']],
 ['goals','创建目标',{title:string,domain:string,scope:string},['title','domain']],
 ['conversations','创建目标内的规划对话',{goal_id:string,title:string},['goal_id','title']],
 ['messages','保存用户消息并排队',{conversation_id:string,content:string,request_id:string,task_kind:{enum:['chat','material','capabilities','roadmap','assessment','review','final']},content_id:string},['conversation_id','content','request_id']],
 ['resources','用户指定学习资料',{goal_id:string,title:string,url:{type:'string',format:'uri'},role:{enum:['PRIMARY','SUPPLEMENTARY','REFERENCE']},saved:bool},['title','role']],
 ['notes','新建或编辑用户笔记',{id:string,goal_id:string,title:string,content:string},['title','content']],
 ['notes/archive','归档或恢复笔记',{id:string,archived:bool},['id','archived']],
 ['prompts','更新 Teacher 提示词并保留旧版本',{content:string},['content']],
 ['proposals/decide','用户确认或拒绝路线',{id:string,accept:bool},['id','accept']],
 ['goals/status','暂停或恢复目标',{id:string,status:{enum:['PAUSED','ACTIVE']}},['id','status']],
 ['sessions/assess','开始或恢复考察',{id:string,mode:{enum:['OPEN_BOOK','CLOSED_BOOK']}},['id']],
 ['jobs/cancel','取消待处理或处理中消息任务',{id:string},['id']]
];
const responses={'200':{description:'操作结果'},'400':{description:'参数无效'},'401':{description:'身份凭据缺失'},'403':{description:'调用身份不允许'},'409':{description:'状态冲突'}};
const paths={};for(const [path,summary,properties,required]of entries)paths['/api/'+path]={post:{summary,security:[{UserSession:[]}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties,required}}}},responses}};
for(const [path,summary]of [['state','读取 Web 工作台状态（包含用户自己可见的归档笔记）'],['export','导出主要学习数据，不含密钥；不是完整数据库备份'],['health','本地服务健康检查'],['events','SSE 数据变更通知；客户端重新读取状态']])paths['/api/'+path]={get:{summary,security:path==='health'?[]:[{UserSession:[]}],responses:{'200':{description:path==='events'?'text/event-stream':'JSON 数据'}}}};
paths['/api/messages'].get={summary:'读取对话消息',security:[{UserSession:[]}],parameters:[{name:'conversation_id',in:'query',required:true,schema:string}],responses};
for(const [path,summary] of [['assessment-rounds','读取逐题记录，正式考察结束前不显示反馈'],['material-content','读取指定正文版本']])paths['/api/'+path]={...(paths['/api/'+path]||{}),get:{summary,security:[{UserSession:[]}],parameters:[{name:'id',in:'query',required:true,schema:string}],responses}};
paths['/api/agent/tool']={post:{summary:'供外部 Agent 使用的受限业务接口',security:[{AgentBearer:[]}],requestBody:{required:true,content:{'application/json':{schema:{oneOf:Object.entries(tools).map(([name,t])=>({type:'object',properties:{name:{const:name},arguments:zodToJsonSchema(t.schema)},required:['name','arguments']}))}}}},responses}};
paths['/mcp']={post:{summary:'标准 Streamable HTTP MCP；同一组 Agent 工具',security:[{AgentBearer:[]}],requestBody:{required:true,content:{'application/json':{schema:{type:'object'}}}},responses:{'200':{description:'MCP JSON-RPC response'},'202':{description:'Notification accepted'}}}};
writeFileSync(new URL('../docs/openapi.json',import.meta.url),JSON.stringify({openapi:'3.1.0',info:{title:'AI Teacher Local API',version:'0.4.0',description:'仅可信本机单用户使用。Web 首次 GET / 获得 HttpOnly 会话 cookie。Agent 使用 data/agent-token 中的 Bearer 凭据。启用执行器后会调用所选模型或本机 Codex。'},servers:[{url:'http://127.0.0.1:4317'}],components:{securitySchemes:{UserSession:{type:'apiKey',in:'cookie',name:'teacher_session'},AgentBearer:{type:'http',scheme:'bearer'}}},paths},null,2));
console.log('OpenAPI document generated.');
