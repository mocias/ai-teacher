// Each host launches its own stdio bridge. The scoped token is supplied by the user.
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const base=process.env.TEACHER_URL||'http://127.0.0.1:4317',role=process.env.TEACHER_AGENT_ROLE,token=process.env.TEACHER_TOKEN;
if(!role||!token)throw Error('Set TEACHER_AGENT_ROLE and TEACHER_TOKEN from the agent connection settings.');
async function request(path,data){const r=await fetch(base+'/api/agents/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({role,...data}),signal:AbortSignal.timeout(35000)});const v=await r.json();if(!r.ok)throw Error(v.error||'Agent connection failed');return v;}
const server=new Server({name:'ai-teacher-'+role,version:'0.5.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,()=>request('catalog',{}));
server.setRequestHandler(CallToolRequestSchema,async req=>{try{return {content:[{type:'text',text:JSON.stringify(await request('tool',{name:req.params.name,arguments:req.params.arguments||{}}))}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
await server.connect(new StdioServerTransport());
process.stdin.on('end',()=>server.close().finally(()=>process.exit(0)));
