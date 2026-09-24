// Isolated, deterministic UI fixture. Does not read the user's library or call an AI.
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID as id} from 'node:crypto';
import {once} from 'node:events';
import {startServer} from '../server/index.mjs';
const app=startServer({port:4329,dataDir:mkdtempSync(join(tmpdir(),'teacher-interactions-'))});await once(app.server,'listening');
const s=app.store,l=s.learning,created=s.createGoal({title:'掌握 KV Cache 与调度',domain:'AI Infra'}),g=created.goal.id;
const caps=l.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'解释缓存与调度',kind:'CORE',requirements:[{node:'缓存',description:'解释 K/V 复用边界'}]}]});l.confirmCapabilities({id:caps.proposal_id,accept:true});const r=l.state(g).requirements[0].id;
const a=l.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',scope:'理解缓存原理',requirement_ids:[r],resource_ids:[],request_id:id()});l.endEarly({id:a.assessment_id});
const topic=(key,title,dependencies,tasks)=>({key,title,dependencies,requirement_ids:[r],resource_ids:[],sessions:tasks.map(title=>({title,objective:'通过推导与实验验证 '+title}))});
const p=l.proposeRoadmap({goal_id:g,title:'从缓存到服务优化',summary:'显式的分支与汇合依赖',request_id:id(),phases:[{title:'基础机制',topics:[topic('cache','缓存复用',[],['推导缓存读写','估算显存预算'])]},{title:'服务运行',topics:[topic('batch','连续批处理',['cache'],['观察调度与延迟']),topic('memory','内存管理',['cache'],['理解分页缓存'])]},{title:'总结验证',topics:[topic('report','实验总结',['batch','memory'],['撰写实验分析报告'])]}]});l.decide({id:p.proposal_id,accept:true});
l.schedule({goal_id:g,requirement_id:r,due_date:'2026-10-01',reason:'一周后闭卷回忆缓存复用边界',request_id:id()});
s.saveNote({title:'缓存原理笔记',content:'K/V 会被后续 token 重用。\nQ 只用于当前查询。',goal_id:g});
s.send(created.conversation.id,'为什么缓存 K/V，而不缓存 Q？',id());const job=s.claim('界面验证',created.conversation.id).job;s.reply({job_id:job.id,lease_token:job.lease_token,content:'因为后续 token 会访问历史 K/V，而当前 Q 只参与当前查询。\n我们可以从一次 prefill 和两次 decode 的计算过程看起。',request_id:id()});
console.log('ISOLATED_INTERACTIONS_PREVIEW http://127.0.0.1:4329');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
