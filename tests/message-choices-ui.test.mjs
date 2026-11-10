import test from 'node:test';
import assert from 'node:assert/strict';
import {createChoiceController} from '../public/message-choices.js';

const question=(id='q1',type='SINGLE',extra={})=>({id,conversation_id:'planning',role:'assistant',choice:{type,status:'OPEN',options:[{id:'a',text:'先看调用过程'},{id:'b',text:'直接做练习'},{id:'c',text:'我还不确定'}],selected_option_ids:[],answer_message_id:null,...extra}});
const key=q=>JSON.stringify([q.conversation_id,q.id]);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(options={}){const calls=[],errors=[],success=[],changes=[];let counter=0;const controller=createChoiceController({api:async(path,data)=>{calls.push({path,data});return {id:'answer'};},onError:e=>errors.push(e),onSuccess:(result,origin)=>success.push({result,origin}),onChange:k=>changes.push(k),requestId:()=>`request-${++counter}`,...options});return {controller,calls,errors,success,changes};}

test('single choice submits immediately with the captured conversation and exact ids',async()=>{
 const h=harness(),q=question();h.controller.view(q);
 assert.equal(await h.controller.choose(key(q),'b'),true);assert.equal(h.calls.length,1);
 assert.deepEqual(h.calls[0],{path:'messages',data:{conversation_id:'planning',choice_answer:{question_message_id:'q1',option_ids:['b']},request_id:'request-1'}});
 assert.deepEqual(h.success[0].origin,{conversation_id:'planning',question_message_id:'q1'});
 assert.equal(await h.controller.choose(key(q),'a'),false);assert.equal(h.calls.length,1);
});

test('multiple choices toggle without sending, require a selection, and submit in source order',async()=>{
 const h=harness(),q=question('multi','MULTIPLE');h.controller.view(q);
 assert.equal(await h.controller.submit(key(q)),false);
 await h.controller.choose(key(q),'c');await h.controller.choose(key(q),'a');await h.controller.choose(key(q),'c');await h.controller.choose(key(q),'b');assert.equal(h.calls.length,0);
 // Re-render and rendering a different route/question retain this question's draft.
 h.controller.view(question('other'));h.controller.view(structuredClone(q));
 assert.equal(await h.controller.submit(key(q)),true);
 assert.deepEqual(h.calls[0].data.choice_answer.option_ids,['a','b']);
});

test('overlapping click, keyboard activation and submit cannot duplicate a pending write',async()=>{
 const gate=deferred(),calls=[];const h=harness({api:async(path,data)=>{calls.push(data);return gate.promise;}}),q=question();h.controller.view(q);
 const first=h.controller.choose(key(q),'a');
 assert.equal(await h.controller.choose(key(q),'b'),false);assert.equal(await h.controller.submit(key(q)),false);
 h.controller.view(structuredClone(q));assert.equal(await h.controller.choose(key(q),'a'),false);assert.equal(calls.length,1);
 gate.resolve({id:'answer'});assert.equal(await first,true);
});

test('lost response retry retains request identity and question selection across route refresh',async()=>{
 const calls=[];const h=harness({api:async(path,data)=>{calls.push(data);if(calls.length===1)throw Error('连接中断');return {id:'saved'};}}),q=question('multi','MULTIPLE');h.controller.view(q);
 await h.controller.choose(key(q),'b');await h.controller.choose(key(q),'a');assert.equal(await h.controller.submit(key(q)),false);
 h.controller.view(question('route-b'));h.controller.view(structuredClone(q));assert.equal(await h.controller.submit(key(q)),true);
 assert.deepEqual(calls[0],calls[1]);assert.deepEqual(h.errors,['连接中断']);
});

test('request fingerprints follow the selected set including returning to an earlier selection',async()=>{
 const calls=[];const h=harness({api:async(path,data)=>{calls.push(data);throw Error('offline');}}),q=question('multi','MULTIPLE');h.controller.view(q);
 await h.controller.choose(key(q),'b');await h.controller.submit(key(q));
 await h.controller.choose(key(q),'a');await h.controller.submit(key(q));
 await h.controller.choose(key(q),'a');await h.controller.submit(key(q));
 assert.equal(calls[0].request_id,calls[2].request_id);assert.notEqual(calls[0].request_id,calls[1].request_id);
});

test('authoritative stale, answered and disabled projections prevent retries and keep history',async()=>{
 for(const status of ['STALE','ANSWERED','DISABLED']){
  const h=harness({api:async()=>{throw Error('offline');}}),q=question();h.controller.view(q);await h.controller.choose(key(q),'a');
  const historical=question('q1','SINGLE',{status,selected_option_ids:status==='ANSWERED'?['b']:[]});
  const html=h.controller.view(historical);assert.equal(await h.controller.choose(key(q),'c'),false);assert.equal(await h.controller.submit(key(q)),false);
  if(status==='ANSWERED'){assert.match(html,/is-selected[^]*data-choice-option="b"/);assert.match(html,/原始作答已保留/);}
  else assert.match(html,/当前记录只读|不是当前问题/);
 }
 const h=harness(),q=question('typed','SINGLE',{status:'ANSWERED',answer_message_id:'typed-answer'});
 assert.match(h.controller.view(q),/已通过文字作答/);assert.equal(await h.controller.choose(key(q),'a'),false);
});

test('read-only context and invalid messages cannot create an actionable question',async()=>{
 const h=harness(),q=question();h.controller.view(q,{disabled:true});assert.equal(await h.controller.choose(key(q),'a'),false);
 h.controller.view(q,{disabled:false});assert.equal(await h.controller.choose(key(q),'nonexistent'),false);assert.equal(h.calls.length,0);
 for(const invalid of [{...q,role:'user'},{...q,choice:{...q.choice,options:[{id:'a',text:'only one'}]}},{...q,choice:{...q.choice,options:[{id:'a',text:'one'},{id:'a',text:'duplicate'}]}}])assert.equal(h.controller.view(invalid),'');
});

test('option text and ids stay plain escaped content and multiple controls expose pressed state',()=>{
 const h=harness(),q=question('safe','MULTIPLE',{options:[{id:'" onfocus="evil',text:'<img src=x onerror=evil()>\n代码 & 数学'},{id:'b',text:'第二项'}]});
 const html=h.controller.view(q);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/&quot; onfocus=&quot;evil/);assert.match(html,/aria-pressed="false"/);assert.doesNotMatch(html,/>A\.|>B\./);
});

test('accepted answer remains locked if the follow-up refresh fails',async()=>{
 const h=harness({onSuccess:async()=>{throw Error('refresh failed');}}),q=question();h.controller.view(q);
 assert.equal(await h.controller.choose(key(q),'a'),true);assert.equal(await h.controller.choose(key(q),'a'),false);assert.equal(h.calls.length,1);assert.deepEqual(h.errors,['refresh failed']);
});

test('delegated binding survives new card buttons and binds a persistent root once',async()=>{
 const h=harness(),q=question('multi','MULTIPLE');h.controller.view(q);let listener,bindings=0;
 const root={addEventListener:(name,fn)=>{assert.equal(name,'click');listener=fn;bindings++;},contains:()=>true};h.controller.bind(root);h.controller.bind(root);
 const card={dataset:{choiceCard:key(q)}};
 const event=option=>{const button={disabled:false,dataset:{choiceOption:option},hasAttribute:()=>!!option,closest:()=>card};return {target:{closest:()=>button},preventDefault:()=>{}};};
 listener(event('b'));h.controller.view(structuredClone(q));listener(event('a'));listener(event(null));
 await Promise.resolve();assert.equal(bindings,1);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].data.choice_answer.option_ids,['a','b']);
});
