// Per-invocation bridge. The token authorizes only the one claimed Web job.
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {randomUUID} from 'node:crypto';
const base=process.env.TEACHER_HOST_URL,token=process.env.TEACHER_HOST_TOKEN;
if(!base||!token)throw new Error('This adapter is started only by the local host dispatcher.');
async function request(path,input){const res=await fetch(base+'/api/host/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});const result=await res.json();if(!res.ok)throw new Error(result.error||'任务连接不可用');return result;}
const catalog=await request('catalog',{});
const server=new Server({name:'ai-teacher-job',version:'0.4.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:catalog.tools}));
server.setRequestHandler(CallToolRequestSchema,async req=>{try{const result=await request('tool',{name:req.params.name,arguments:req.params.arguments||{},operation_id:randomUUID()});return {content:[{type:'text',text:JSON.stringify(result)}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
await server.connect(new StdioServerTransport());

process.stdin.on("end",()=>{server.close().finally(()=>process.exit(0));});
