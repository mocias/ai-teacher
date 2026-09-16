import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {readFileSync} from 'node:fs';
import {tools} from '../../../server/tools.mjs';
const base=process.env.TEACHER_URL||'http://127.0.0.1:4317';
const token=process.env.TEACHER_TOKEN||readFileSync(new URL('../../../data/agent-token',import.meta.url),'utf8').trim();
const server=new McpServer({name:'ai-teacher',version:'0.4.0'});
for(const [name,t] of Object.entries(tools))server.registerTool(name,{description:t.description,inputSchema:t.schema.shape},async args=>{
 try{const res=await fetch(base+'/api/agent/tool',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({name,arguments:args}),signal:AbortSignal.timeout(35000)});const value=await res.json();return {isError:!res.ok,content:[{type:'text',text:JSON.stringify(value)}]};}
 catch(e){return {isError:true,content:[{type:'text',text:'本地 AI Teacher 服务不可达。请先启动服务。'+e.message}]};}
});
await server.connect(new StdioServerTransport());
