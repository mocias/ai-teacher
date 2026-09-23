// Isolated browser-check fixture: never reads production data or calls a real model.
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {startServer} from '../server/index.mjs';
const dataDir=mkdtempSync(join(tmpdir(),'teacher-discovery-preview-'));
const app=startServer({port:4329,dataDir,executorOptions:{fetcher:async(_url,options)=>{
 const body=JSON.parse(options.body),context=JSON.parse(body.messages[1].content).context;
 const turns=context.messages.filter(m=>m.role==='user').length;
 let message;
 if(turns<2)message={content:'你希望先建立整体认识，还是达到能独立修改推理引擎的实践层级？'};
 else if(!body.messages.some(m=>m.role==='tool'))message={tool_calls:[{id:'draft-fixture',type:'function',function:{name:'teacher_propose_goal_draft',arguments:JSON.stringify({revision:context.discovery.discussion.revision,draft:{direction:'单卡大模型推理',background:'已掌握 Python',level:'能够独立实践',outcome:'运行并修改简化推理引擎',exclusions:'多机部署'},summary:'希望从 Python 基础出发，聚焦单卡推理实践。'})}}]};
 else message={content:'我已把讨论整理成目标草案。你可以点击“查看目标草案”进行修改，确认后再创建目标。'};
 return new Response(JSON.stringify({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}]}));
 }}});
await once(app.server,'listening');
const model=app.store.models.save({name:'界面验证用模拟模型',base_url:'https://fixture.invalid/v1',model:'fixture',key:''});
app.store.models.routes({routes:[{module:'chat',profile_id:model.id}]});app.store.models.enabled(true);
console.log('ISOLATED_DISCOVERY_PREVIEW http://127.0.0.1:4329');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
