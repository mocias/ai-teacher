import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {randomUUID} from 'node:crypto';
const base=process.env.TEACHER_HOST_URL,token=process.env.TEACHER_HOST_TOKEN;
if(!base||!token)throw Error('Missing task-scoped AI Teacher connection');
async function request(path,data){const response=await fetch(base+'/api/harness/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data),signal:AbortSignal.timeout(35000)});const value=await response.json();if(!response.ok)throw Error(value.error||'AI Teacher connection failed');return value;}
const server=new Server({name:'ai-teacher-job',version:'0.5.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,()=>request('catalog',{}));
server.setRequestHandler(CallToolRequestSchema,async input=>{try{return {content:[{type:'text',text:JSON.stringify(await request('tool',{name:input.params.name,arguments:input.params.arguments||{},operation_id:randomUUID()}))}]};}catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}});
await server.connect(new StdioServerTransport());
process.stdin.on('end',()=>server.close().finally(()=>process.exit(0)));
