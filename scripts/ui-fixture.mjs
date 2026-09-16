// Isolated browser QA data. Never opens the user's database or invokes a model.
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.mjs';
import {id} from '../server/store.mjs';
const app=startServer({port:4318,dataDir:mkdtempSync(join(tmpdir(),'teacher-ui-'))});
const s=app.store,g=s.createGoal({title:'界面测试 · 理解 KV Cache',domain:'测试资料',scope:'这是隔离测试数据，不是实际学习记录。'}).goal.id;
const p=s.learning.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'解释缓存机制',kind:'CORE',requirements:[{node:'KV Cache',description:'解释过去 token 的 K/V 为什么可以复用'}]}]});
console.log('Isolated UI fixture ready; capability proposal '+p.proposal_id);
