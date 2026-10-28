import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replyPrefix,replyProjector} from '../scripts/dsh-reply-stream.mjs';
import {replyStreams} from '../server/reply-streams.mjs';

test('reply prefixes decode split escapes and surrogate pairs and select only the top-level content',()=>{
 const text='你好\n"引号" \\ 😀',raw=JSON.stringify({metadata:{content:'not the reply'},other:[1,{x:2}],content:text});
 for(let i=1;i<=raw.length;i++){const prefix=replyPrefix(raw.slice(0,i));if(prefix!==null){assert.ok(text.startsWith(prefix));assert.ok(!/[\uD800-\uDBFF]$/.test(prefix));}}
 assert.equal(replyPrefix(raw),text);assert.equal(replyPrefix('{"metadata":{"content":"secret"}'),null);assert.equal(replyPrefix('{"content":42}'),null);assert.equal(replyPrefix('{"content":"bad\\q'),null);
});
test('native frames stream only the reply tool, discard failed attempts, and ignore other agents',()=>{
 const events=[],p=replyProjector(e=>events.push(e),{delay:1e9}),agent={id:'owned'};
 const handle=frame=>p.handle({agent,frame:{attemptId:'a',...frame}});
 handle({type:'start'});handle({type:'chunk',chunk:{type:'reasoning-delta',text:'private reasoning'}});handle({type:'chunk',chunk:{type:'text-delta',text:'uncommitted text'}});
 handle({type:'chunk',chunk:{type:'tool-call-delta',index:0,id:'x',name:'another_tool',argumentsDelta:'{"content":"private args"}'}});
 handle({type:'chunk',chunk:{type:'tool-call-delta',index:1,id:'y',name:'mcp__teacher_job__teacher_reply',argumentsDelta:'{"content":"真实'}});
 p.handle({agent:{id:'other'},frame:{type:'start',attemptId:'other'}});
 handle({type:'end',outcome:{kind:'committed',eventType:'assistant/attempt'}});p.dispose();
 assert.deepEqual(events.map(e=>e.kind),['reset','delta','discard']);assert.equal(events[1].delta,'真实');assert.ok(!JSON.stringify(events).includes('private'));
});
test('previews isolate runs, enforce ordering, reset retries and remain volatile until authoritative writeback',()=>{
 const events=[],s=replyStreams({publish:e=>events.push(e)}),run={runId:'r',role:'master',job:{id:'j',conversation_id:'c',message_id:'u'}};
 const event=(kind,sequence,extra={})=>({kind,sequence,attempt:'a',...extra});
 assert.equal(s.update(run,event('delta',1,{delta:'orphan'})),false);
 assert.equal(s.update(run,event('reset',1)),true);s.update(run,event('delta',2,{delta:'半段'}));assert.equal(s.list()[0].content,'半段');
 assert.equal(s.update(run,event('delta',2,{delta:'duplicate'})),false);
 assert.equal(s.update(run,event('delta',4,{delta:'gap'})),false);assert.equal(s.list()[0].status,'INTERRUPTED');
 s.update(run,event('reset',5,{attempt:'retry'}));s.update(run,event('delta',6,{attempt:'retry',delta:'新的'}));assert.equal(s.list()[0].content,'新的');
 s.finish('r','COMPLETED',{id:'saved',content:'最终校验后的完整正文'});assert.equal(s.list()[0].message_id,'saved');assert.equal(s.list()[0].content,'最终校验后的完整正文');
 assert.equal(s.update(run,event('delta',7,{attempt:'retry',delta:'late'})),false);assert.equal(replyStreams().list().length,0);
});
test('cancelled previews reject late fragments and bounded terminal snapshots expire',()=>{
 let clock=0;const s=replyStreams({clock:()=>clock,ttlMs:10,maxEntries:2}),run={runId:'r',role:'chat',job:{id:'j',conversation_id:'c',message_id:'u'}};
 s.update(run,{kind:'reset',attempt:'a',sequence:1});s.update(run,{kind:'delta',attempt:'a',sequence:2,delta:'半段'});clock=20;assert.equal(s.list().length,1);
 s.finish('r','CANCELLED');assert.equal(s.update(run,{kind:'delta',attempt:'a',sequence:3,delta:'迟到'}),false);clock=31;assert.equal(s.list().length,0);
});
