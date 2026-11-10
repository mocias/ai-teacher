// Opt-in, one real model answer to a synthetic assessment in isolated data.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {startServer} from '../server/index.mjs';
import {dshNetwork} from '../server/dsh-network.mjs';

assert.ok(process.argv.includes('--real-model'),'Pass --real-model to authorize one short assessment turn');
const output=resolve('outputs/runtime-v0180/assessment-live-'+Date.now());mkdirSync(output,{recursive:true});
const network=dshNetwork(join(process.env.APPDATA||homedir(),'AI Teacher','data'));
const app=startServer({port:0,dataDir:join(output,'data'),executorOptions:{intervalMs:1e9},hostOptions:{intervalMs:1e9},harnessOptions:{intervalMs:1e9,timeoutMs:180000,dshEnv:()=>network.env()}});
const report={checkedAt:new Date().toISOString(),isolated:true,model:'qoder-cn/DeepSeek-Flash'};
try{
 await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base+'/')).headers.get('set-cookie').split(';')[0];
 const catalog=await(await fetch(base+'/api/agents/dsh-models?refresh=1',{headers:{cookie}})).json();assert.ok(catalog.models.some(m=>m.id===report.model));
 const s=app.store,l=s.learning,g=s.createGoal({title:'讲解发布隔离验收',domain:'基础编程'}).goal.id;
 const p=l.proposeCapabilities({goal_id:g,request_id:crypto.randomUUID(),items:[{title:'函数组合',kind:'CORE',requirements:[{node:'函数组合',description:'理解内层结果传递给外层函数'}]}]});l.confirmCapabilities({id:p.proposal_id,accept:true});
 const r=l.state(g).requirements[0].id,a=l.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',scope:'简单函数组合',requirement_ids:[r],resource_ids:[],request_id:crypto.randomUUID()});
 const first=s.claim('synthetic setup',a.conversation_id).job,q=l.question({assessment_id:a.assessment_id,job_id:first.id,lease_token:first.lease_token,question:'double(x)=2*x，inc(x)=x+1。inc(double(3)) 应怎样计算？',requirement_ids:[r],request_id:crypto.randomUUID()});
 s.agents.configure({role:'assessment',mode:'MCP',harness:'DSH',model:report.model});
 const sent=s.send(a.conversation_id,'我不懂内外层是什么意思。请先在对话中用两三句话给我讲解，再出一道简单的同类题。',crypto.randomUUID());sent.job_id=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(sent.message_id).id;s.models.tag(sent.job_id);app.harnessDriver.tick();
 const started=Date.now();let run;while(Date.now()-started<200000){run=s.db.prepare('SELECT status,error,tool_calls FROM harness_runs WHERE job_id=? ORDER BY rowid DESC LIMIT 1').get(sent.job_id);if(run&&run.status!=='RUNNING')break;await new Promise(r=>setTimeout(r,500));}
 const rounds=l.rounds({id:a.assessment_id}),messages=s.messages(a.conversation_id),round=rounds[0],progress=app.harnessDriver.runProgress().find(p=>p.job_id===sent.job_id);
 Object.assign(report,{status:run?.status,error:run?.error||null,seconds:(Date.now()-started)/1000,publicLesson:!!round.explanation_message_id,publicLessonCharacters:round.explanation?.length||0,privateFeedbackHidden:round.feedback===null,feedbackRecorded:!!s.db.prepare('SELECT feedback FROM assessment_rounds WHERE id=?').get(q.round_id).feedback,nextQuestion:rounds.length===2,lessonBeforeNextQuestion:!!round.explanation_message_id&&messages.findIndex(m=>m.id===round.explanation_message_id)<messages.findIndex(m=>m.id===rounds[1]?.question_message_id),evidenceCount:s.overview().evidence.length,tools:progress?.tools.map(t=>({name:t.name,status:t.status}))||[]});
 assert.equal(report.status,'COMPLETED');assert.ok(report.publicLesson&&report.privateFeedbackHidden&&report.feedbackRecorded&&report.nextQuestion&&report.lessonBeforeNextQuestion);assert.equal(report.evidenceCount,0);report.ok=true;
}finally{await app.close();writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));console.log('Assessment live result: '+join(output,'result.json'));}
