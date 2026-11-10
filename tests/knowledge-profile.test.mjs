import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore,id} from '../server/store.mjs';
import {knowledgeProfileView} from '../public/knowledge-profile.js';
import {executionTools} from '../server/agent-policy.mjs';
import {startServer} from '../server/index.mjs';

function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());return s;}
function goalWithNode(s,{domain,title='学习缓存',name='缓存机制',node_id,topic_id}){
 const goal=s.createGoal({title,domain}).goal,L=s.learning;
 const proposal=L.proposeCapabilities({goal_id:goal.id,request_id:id(),items:[{title:'基础能力',kind:'CORE',requirements:[{node:name,description:'解释缓存行为',...(node_id?{node_id}:{}),...(topic_id?{topic_id}:{})}]}]});
 L.confirmCapabilities({id:proposal.proposal_id,accept:true});return {goal,requirement:L.state(goal.id).requirements[0],L};
}
function assess(s,g,L,requirement,relation,answer,judgment){
 const a=L.begin({goal_id:g.id,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',requirement_ids:[requirement.id],request_id:id()}),job=s.claim('profile-test',a.conversation_id).job;
 const q=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'请解释缓存机制。',requirement_ids:[requirement.id],request_id:id()});
 s.send(a.conversation_id,answer,id());L.feedback({round_id:q.round_id,feedback:'根据回答形成的反馈。',request_id:id()});
 L.finish({assessment_id:a.assessment_id,summary:'完成节点考察',profile:'当前目标画像',change_summary:'更新目标级画像',relations:[{requirement_id:requirement.id,relation}],node_judgments:[{requirement_id:requirement.id,judgment,change_reason:'变化判断直接对应本轮回答'}],request_id:id()});
 return a;
}
function topicTask(s,goal,topic){const conversation=s.newConversation(goal.id,'主题结构整理'),sent=s.send(conversation.id,'请分析主题结构',id(),{intent:'TOPIC_REORGANIZATION',subject_id:topic.id}),row=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(sent.message_id);s.models.tag(row.id,'chat');s.db.prepare("UPDATE job_execution SET mode='API',blocked=0,agent_role=NULL WHERE job_id=?").run(row.id);return {conversation,job:s.claim('topic-profile',conversation.id,'API').job};}

test('same-domain unique names preserve the legacy node ID; cross-domain same names stay separate unless explicitly referenced',t=>{
 const s=setup(t),first=goalWithNode(s,{domain:'推理系统'}),originalNode=first.requirement.node_id;
 const same=goalWithNode(s,{domain:'推理系统',title:'同领域复用'});assert.equal(same.requirement.node_id,originalNode);
 const cross=goalWithNode(s,{domain:'编程语言',title:'同名不同领域'});assert.notEqual(cross.requirement.node_id,originalNode);
 const explicit=goalWithNode(s,{domain:'应用架构',title:'显式跨域引用',node_id:originalNode});assert.equal(explicit.requirement.node_id,originalNode);
 const duplicate=s.db.prepare('INSERT INTO knowledge_nodes VALUES(?,?,?)').run(id(),'缓存机制','推理系统');
 assert.throws(()=>s.learning.proposeCapabilities({goal_id:same.goal.id,request_id:id(),items:[{title:'二义性',kind:'CORE',requirements:[{node:'缓存机制',description:'再确认同名'}]}]}),/多个候选/);
 const selected=s.learning.proposeCapabilities({goal_id:same.goal.id,request_id:id(),items:[{title:'明确选择',kind:'CORE',requirements:[{node:'缓存机制',node_id:originalNode,description:'沿用旧节点'}]}]});assert.ok(selected.proposal_id);assert.ok(duplicate.lastInsertRowid);
 const conversation=s.overview().conversations.find(c=>c.goal_id===first.goal.id),sent=s.send(conversation.id,'请提出能力要求',id()),job=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(sent.message_id);s.models.tag(job.id,'capabilities');s.claim('capability-context',conversation.id);const context=s.context(conversation.id).learning;assert.ok(context.knowledge_node_catalog.some(n=>n.id===originalNode));assert.ok(Object.hasOwn(context,'previously_assessed_nodes')||context.knowledge_node_catalog.length>0);
});

test('node judgments append sourced answers across goals and preserve contradictory performance',t=>{
 const s=setup(t),owner=goalWithNode(s,{domain:'数据平台'}),nodeId=owner.requirement.node_id;
 assess(s,owner.goal,owner.L,owner.requirement,'SUPPORTS','键和值会在后续 token 计算中复用。','能够说明复用机制和适用范围。');
 const other=goalWithNode(s,{domain:'应用开发',title:'跨领域目标',node_id:nodeId});
 assess(s,other.goal,other.L,other.requirement,'CONTRADICTS','每次请求都重新生成历史 token 的键和值。','现有回答仍把历史 token 状态当作需要重算。');
 const profile=s.knowledgeProfile.state(null,{full:true}),node=profile.nodes.find(n=>n.id===nodeId);
 assert.equal(node.domain,'数据平台');assert.equal(node.conflicted,true);assert.equal(node.current_judgment,null);assert.equal(node.judgments.length,2);
 assert.ok(node.judgments.every(j=>j.evidence_id&&j.source_message_ids.length===1&&j.answer_messages[0].content));
 assert.ok(node.explicit_references.some(r=>r.goal_id===other.goal.id&&r.target_domain==='应用开发'));
 assert.doesNotMatch(JSON.stringify(s.overview()),/每次请求都重新生成历史 token/,'overview/SSE state keeps full answer text out of ordinary updates');
 const detailedState=s.overview();detailedState.learning.knowledge_profile=profile;
 assert.match(knowledgeProfileView(detailedState),/不同作答证据存在冲突/);assert.match(knowledgeProfileView(detailedState),/每次请求都重新生成/);assert.match(knowledgeProfileView(detailedState),/请 Teacher 整理此节点画像/);
 const ordinary=goalWithNode(s,{domain:'普通聊天目标',title:'普通聊天',node_id:nodeId}),chat=s.newConversation(ordinary.goal.id,'普通聊天'),sent=s.send(chat.id,'普通问题',id()),jobRow=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(sent.message_id);s.models.tag(jobRow.id,'chat');s.claim('ordinary-chat',chat.id);const chatContext=s.context(chat.id);assert.doesNotMatch(JSON.stringify(chatContext),/每次请求都重新生成历史 token/);assert.equal(chatContext.learning.knowledge_profile,undefined);assert.deepEqual(chatContext.learning.knowledge_node_catalog,[]);
 const resource=s.resource({goal_id:ordinary.goal.id,title:'分析材料',role:'PRIMARY',scope:'全文'}),content=ordinary.L.material({goal_id:ordinary.goal.id,resource_id:resource.id,scope:'全文',content:'本材料无关节点画像'}),materialChat=s.newConversation(ordinary.goal.id,'分析材料'),materialSent=s.send(materialChat.id,'分析这份材料',id()),materialJob=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(materialSent.message_id);s.models.tag(materialJob.id,'material',content.id);s.claim('material-analysis',materialChat.id);assert.doesNotMatch(JSON.stringify(s.context(materialChat.id)),/每次请求都重新生成历史 token/);
});

test('topic ownership is unique, moves retain history, and curation needs every conflicting source plus user confirmation',t=>{
 assert.deepEqual(executionTools({module:'chat'},{learning:{}}),[]);
 assert.ok(executionTools({module:'chat'},{learning:{goal_chat_action:{intent:'KNOWLEDGE_PROFILE',subject_id:'node'}}}).includes('teacher_propose_knowledge_profile'));
 const s=setup(t),owner=goalWithNode(s,{domain:'推理系统'}),nodeId=owner.requirement.node_id;
 const domain=owner.goal.domain,topic=s.knowledgeProfile.createTopic({domain,name:'推理缓存',description:'推理时的状态复用',request_id:id()});
 const duplicate=s.knowledgeProfile.createTopic({domain,name:'推理缓存',request_id:id()});assert.deepEqual(duplicate,{id:topic.id,reused:true});
 s.knowledgeProfile.assignNode({node_id:nodeId,topic_id:topic.id,reason:'缓存机制属于推理时状态复用',request_id:id()});
 const next=s.knowledgeProfile.createTopic({domain,name:'状态生命周期',request_id:id()});s.knowledgeProfile.assignNode({node_id:nodeId,topic_id:next.id,reason:'按生命周期重新整理节点主题',request_id:id()});
 const afterMove=s.overview().learning.knowledge_profile.nodes.find(n=>n.id===nodeId);assert.equal(afterMove.topic_id,next.id);assert.equal(afterMove.topic_history.length,2);

 assess(s,owner.goal,owner.L,owner.requirement,'SUPPORTS','命中时复用已有键和值。','掌握基本复用。');
 const other=goalWithNode(s,{domain:'应用开发',node_id:nodeId,title:'矛盾证据目标'});
 assess(s,other.goal,other.L,other.requirement,'CONTRADICTS','每次读取都需要重新计算键和值。','应用场景下对复用条件仍有混淆。');
 const judgments=s.knowledgeProfile.state(null,{full:true}).nodes.find(n=>n.id===nodeId).judgments;
 const conversation=s.newConversation(other.goal.id,'整理长期知识画像');const sent=s.send(conversation.id,'请整理缓存机制节点',id(),{intent:'KNOWLEDGE_PROFILE',subject_id:nodeId}),jobRow=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(sent.message_id);
 s.models.tag(jobRow.id,'chat');s.db.prepare("UPDATE job_execution SET mode='API' WHERE job_id=?").run(jobRow.id);const job=s.claim('profile-api',conversation.id,'API').job;
 const sources=judgments.map(j=>j.id),proposal=s.knowledgeProfile.proposeFromJob({job_id:job.id,lease_token:job.lease_token,goal_id:other.goal.id,node_id:nodeId,content:'基本机制已理解，但需要明确应用条件；两种表现反映的要求范围不同。',reason:'第一条来自通用机理问题，第二条来自应用场景问题，应保留这一区别。',source_judgment_ids:sources,request_id:id()});
 assert.throws(()=>s.knowledgeProfile.proposeFromJob({job_id:job.id,lease_token:job.lease_token,goal_id:other.goal.id,node_id:nodeId,content:'新总结',reason:'整理',source_judgment_ids:[sources[0]],request_id:id()}),/引用并说明语义/);
 assert.equal(s.overview().learning.knowledge_profile.proposals.find(p=>p.id===proposal.proposal_id).status,'PENDING');
 assert.match(knowledgeProfileView(s.overview()),/确认生成新版本/);
 const decisionRequest=id(),accepted=s.knowledgeProfile.decide({proposal_id:proposal.proposal_id,accept:true,request_id:decisionRequest});assert.equal(accepted.curation.version,1);
 assert.deepEqual(s.knowledgeProfile.decide({proposal_id:proposal.proposal_id,accept:true,request_id:decisionRequest}),accepted);
 const final=s.overview().learning.knowledge_profile.nodes.find(n=>n.id===nodeId);assert.equal(final.judgments.length,2);assert.equal(final.curations.length,1);assert.deepEqual(final.curations[0].source_judgment_ids,sources);
});

test('AI topic split/merge proposals preserve old topic IDs and requirements, reject active assessments, and persist after restart',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-topic-lineage-'));let s=createStore(join(dir,'teacher.sqlite'));t.after(()=>{try{s.db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const goal=s.createGoal({title:'整理缓存主题',domain:'推理系统'}).goal,L=s.learning,cap=L.proposeCapabilities({goal_id:goal.id,request_id:id(),items:[{title:'缓存能力',kind:'CORE',requirements:[{node:'缓存命中',description:'解释命中条件'},{node:'缓存一致性',description:'解释一致性边界'}]}]});L.confirmCapabilities({id:cap.proposal_id,accept:true});
 const before=L.state(goal.id).requirements.map(r=>[r.id,r.node_id]),topics=s.knowledgeProfile.createTopic({domain:goal.domain,name:'缓存机制',request_id:id()}),nodes=before.map(x=>x[1]);for(const node_id of nodes)s.knowledgeProfile.assignNode({node_id,topic_id:topics.id,reason:'两项都属于缓存机制',request_id:id()});s.db.prepare("UPDATE goals SET status='ACTIVE' WHERE id=?").run(goal.id);
 assert.deepEqual(executionTools({module:'chat'},{learning:{goal_chat_action:{intent:'TOPIC_REORGANIZATION',subject_id:topics.id}}}),['teacher_propose_topic_reorganization']);
 const badConversation=s.newConversation(goal.id,'错误主题意图');assert.throws(()=>s.send(badConversation.id,'无效主题请求',id(),{intent:'TOPIC_REORGANIZATION',subject_id:'unknown-topic'}),/学习操作/);
 const task=topicTask(s,goal,{id:topics.id});const activeAssessment=L.begin({goal_id:goal.id,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',requirement_ids:[L.state(goal.id).requirements[0].id],request_id:id()});
 const splitArgs={job_id:task.job.id,lease_token:task.job.lease_token,goal_id:goal.id,topic_id:topics.id,kind:'SPLIT',partitions:[{name:'命中逻辑',node_ids:[nodes[0]]},{name:'一致性',node_ids:[nodes[1]]}],reason:'命中条件与跨请求状态一致性有不同解释边界',request_id:id()};
 assert.throws(()=>s.knowledgeProfile.proposeTopicReorganization(splitArgs),/进行中的考察/);L.endEarly({id:activeAssessment.assessment_id});
 const split=s.knowledgeProfile.proposeTopicReorganization(splitArgs);assert.match(knowledgeProfileView(s.overview()),/等待确认的主题拆分方案/);s.reply({job_id:task.job.id,lease_token:task.job.lease_token,content:'已提交主题拆分建议。',request_id:id()});
 const another=L.begin({goal_id:goal.id,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',requirement_ids:[L.state(goal.id).requirements[0].id],request_id:id()});
 assert.throws(()=>s.knowledgeProfile.decideTopicReorganization({proposal_id:split.proposal_id,accept:true,request_id:id()}),/进行中的考察/);L.endEarly({id:another.assessment_id});
 const accepted=s.knowledgeProfile.decideTopicReorganization({proposal_id:split.proposal_id,accept:true,request_id:id()});assert.equal(accepted.status,'ACCEPTED');
 let profile=s.knowledgeProfile.state(null,{full:true}),source=profile.domains.find(d=>d.name===goal.domain).topics.find(t=>t.id===topics.id);assert.equal(source.status,'SPLIT');assert.equal(profile.topic_lineage.filter(x=>x.source_topic_id===topics.id&&x.relation==='SPLIT_TO').length,2);assert.deepEqual(L.state(goal.id).requirements.map(r=>[r.id,r.node_id]),before);
 const activeTopics=profile.domains.find(d=>d.name===goal.domain).topics.filter(t=>t.status==='ACTIVE'),from=activeTopics.find(t=>t.name==='一致性'),to=activeTopics.find(t=>t.name==='命中逻辑'),mergeTask=topicTask(s,goal,from);
 const merge=s.knowledgeProfile.proposeTopicReorganization({job_id:mergeTask.job.id,lease_token:mergeTask.job.lease_token,goal_id:goal.id,topic_id:from.id,kind:'MERGE',target_topic_id:to.id,reason:'两个概念共同属于本目标的缓存机制主题',request_id:id()});s.reply({job_id:mergeTask.job.id,lease_token:mergeTask.job.lease_token,content:'已提交主题合并建议。',request_id:id()});
 s.knowledgeProfile.decideTopicReorganization({proposal_id:merge.proposal_id,accept:true,request_id:id()});profile=s.knowledgeProfile.state(null,{full:true});const merged=profile.domains.find(d=>d.name===goal.domain).topics.find(t=>t.id===from.id);assert.equal(merged.status,'MERGED');assert.equal(merged.merged_into_topic_id,to.id);assert.deepEqual(L.state(goal.id).requirements.map(r=>[r.id,r.node_id]),before);
 s.db.close();s=createStore(join(dir,'teacher.sqlite'));profile=s.knowledgeProfile.state(null,{full:true});const restarted=profile.domains.find(d=>d.name===goal.domain);assert.equal(restarted.topics.find(t=>t.id===topics.id).status,'SPLIT');assert.equal(restarted.topics.find(t=>t.id===from.id).merged_into_topic_id,to.id);assert.equal(profile.topic_lineage.length,3);assert.match(knowledgeProfileView({...s.overview(),learning:{...s.overview().learning,knowledge_profile:profile}}),/已合并/);
});

test('main profile link and dedicated full-history page keep answer text out of ordinary state payloads',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-profile-http-')),app=startServer({port:0,dataDir:dir});t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});await new Promise(resolve=>app.server.listening?resolve():app.server.once('listening',resolve));
 const owner=goalWithNode(app.store,{domain:'学习科学'});assess(app.store,owner.goal,owner.L,owner.requirement,'SUPPORTS','我能说明反馈与检索练习的边界。','能够区分两种练习形式。');
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0],ordinary=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();
 assert.doesNotMatch(JSON.stringify(ordinary),/我能说明反馈与检索练习的边界/);
 assert.equal((await fetch(base+'/api/knowledge-profile?full=1')).status,401);
 const detailed=await(await fetch(base+'/api/knowledge-profile?full=1',{headers:{Cookie:cookie}})).json();assert.match(JSON.stringify(detailed),/我能说明反馈与检索练习的边界/);
 assert.equal((await fetch(base+'/personal.html')).status,200);assert.equal((await fetch(base+'/knowledge-profile.js')).status,200);
 const appSource=await(await fetch(base+'/app.js')).text();assert.match(appSource,/打开长期知识画像（领域 \/ 主题 \/ 知识点）/);
 assert.match(knowledgeProfileView({...ordinary,learning:{...ordinary.learning,knowledge_profile:detailed}}),/领域 · 主题 · 知识点/);
});
