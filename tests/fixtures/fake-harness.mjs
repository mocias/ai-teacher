import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const bridge=fileURLToPath(new URL('../../scripts/harness-mcp.mjs',import.meta.url));
const client=new Client({name:'fake-harness',version:'1'});
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[bridge],env:process.env,stderr:'pipe'}));
 const listed=await client.listTools();if(listed.tools.some(tool=>tool.name==='teacher_claim_message'))throw Error('claim tool was exposed');
 if(process.env.FAKE_REQUIRE_CONTEXT_TEST){const premature=await client.callTool({name:'teacher_reply',arguments:{content:'旧轮次不应写入'}});if(!premature.isError)throw Error('stale write was accepted before fresh context');}
 const context=await client.callTool({name:'teacher_get_context',arguments:{}});
 const value=JSON.parse(context.content[0].text);if(!value.claimed_message_id)throw Error('missing bound message');
 const reply=await client.callTool({name:'teacher_reply',arguments:{content:'通过任务专属 MCP 回写的测试回答'}});
 if(reply.isError)throw Error(reply.content[0].text);
 if(process.env.FAKE_HARNESS_EXIT_DELAY)await new Promise(resolve=>setTimeout(resolve,Number(process.env.FAKE_HARNESS_EXIT_DELAY)));
 await client.close();process.exit(0);
}catch(error){console.error(error.message);await client.close().catch(()=>{});process.exit(1);}
