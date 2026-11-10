// Run with the package's runtime/node.exe; all app and SDK imports resolve from
// the packaged directory, so the development node_modules cannot hide omissions.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';

const root=resolve(process.env.TEACHER_PACKAGE_DIR||'dist/AI Teacher-win32-x64','resources/app');
assert.equal(resolve(process.execPath).toLowerCase(),join(root,'runtime/node.exe').toLowerCase(),'Use the bundled Node runtime');
const require=createRequire(join(root,'package.json'));
const module=async name=>import(pathToFileURL(require.resolve(name)).href);
const {Client}=await module('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=await module('@modelcontextprotocol/sdk/client/stdio.js');
const {StreamableHTTPClientTransport}=await module('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {startServer}=await import(pathToFileURL(join(root,'server/index.mjs')).href);
const work=mkdtempSync(join(tmpdir(),'teacher-package-backend-'));
let app,stdio,http;
try{
 app=startServer({port:0,dataDir:work});await once(app.server,'listening');
 const base='http://127.0.0.1:'+app.server.address().port;
 app.store.agents.configure({role:'reading',mode:'MCP'});
 const {token}=app.store.agents.token('reading');
 const resource=app.store.resource({title:'Packaged dependency check'});
 const chat=app.store.study.open({resource_id:resource.id});
 app.store.study.ask({conversation_id:chat.conversation_id,content:'Explain this text',page_content:'Isolated package smoke text',request_id:randomUUID()});
 stdio=new Client({name:'packaged-stdio-check',version:'1'});
 await stdio.connect(new StdioClientTransport({command:process.execPath,args:[join(root,'scripts/agent-mcp.mjs')],cwd:root,env:{...process.env,TEACHER_URL:base,TEACHER_AGENT_ROLE:'reading',TEACHER_TOKEN:token},stderr:'pipe'}));
 const catalog=await stdio.listTools();assert.ok(catalog.tools.some(t=>t.name==='teacher_reply'));
 const call=async(name,args)=>{const result=await stdio.callTool({name,arguments:args});assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse(result.content[0].text);};
 const claimed=await call('teacher_claim_message',{});assert.equal(claimed.job.conversation_id,chat.conversation_id);
 const task={job_id:claimed.job.id,lease_token:claimed.job.lease_token};
 const context=await call('teacher_get_context',task);assert.match(JSON.stringify(context),/Isolated package smoke text/);
 await call('teacher_reply',{...task,content:'Packaged bridge reply',request_id:randomUUID()});
 assert.equal(app.store.messages(chat.conversation_id).at(-1).content,'Packaged bridge reply');
 http=new Client({name:'packaged-http-check',version:'1'});
 await http.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp/agents/reading'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
 assert.equal((await http.listTools()).tools.length,catalog.tools.length);
 await http.close();http=null;await stdio.close();stdio=null;await app.close();app=null;
 app=startServer({port:0,dataDir:work});await once(app.server,'listening');
 assert.equal(app.store.messages(chat.conversation_id).at(-1).content,'Packaged bridge reply');
 console.log('PACKAGE_BACKEND_SMOKE_OK '+JSON.stringify({stdio:true,http:true,claimContextReply:true,sqliteRestart:true,tools:catalog.tools.length}));
}finally{
 await http?.close();await stdio?.close();await app?.close();
 assert.ok(resolve(work).startsWith(resolve(tmpdir())+require('node:path').sep+'teacher-package-backend-'));
 rmSync(work,{recursive:true,force:true});
}
