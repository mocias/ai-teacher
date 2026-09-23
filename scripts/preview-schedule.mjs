// Isolated scheduling fixture. Never reads production data or calls an AI provider.
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {startServer} from '../server/index.mjs';
const app=startServer({port:4329,dataDir:mkdtempSync(join(tmpdir(),'teacher-schedule-preview-'))});
await once(app.server,'listening');
const g=app.store.createGoal({title:'推理引擎入门',domain:'AI',scope:'单卡推理'}).goal.id;
const p=app.store.propose({goal_id:g,title:'基础路线',summary:'缓存与调度',items:[{title:'理解 KV Cache',objective:'解释缓存的内容和生命周期'},{title:'理解批处理',objective:'解释请求如何一起执行'}],request_id:randomUUID()});app.store.decide(p.proposal_id,true);
console.log('ISOLATED_SCHEDULE_PREVIEW http://127.0.0.1:4329');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
