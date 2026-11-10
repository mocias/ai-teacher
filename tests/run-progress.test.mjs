import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runProgress} from '../server/run-progress.mjs';
import {progressProjector} from '../scripts/dsh-progress.mjs';
import {resolveDshWeb} from '../server/dsh-model.mjs';
import {dshPatch} from '../server/dsh-host.mjs';
import {dshNetwork} from '../server/dsh-network.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('execution progress only projects phases and tool metadata, never reasoning, arguments or results',()=>{
 let time=0;const events=[],p=progressProjector(e=>events.push(e),{clock:()=>time}),agent={id:'one'};
 p.stream({agent,frame:{type:'start'}});p.stream({agent,frame:{type:'chunk',chunk:{type:'reasoning-delta',text:'private-reasoning'}}});p.stream({agent:{id:'other'},frame:{type:'chunk',chunk:{type:'text-delta',text:'foreign'}}});
 p.toolStart({agent,name:'web_search',callId:'a',arguments:{queries:['private-query']}});p.toolEnd({agent,name:'web_search',callId:'a'},{isError:true,error:{info:{code:'WEB_PROVIDER_CREDENTIAL_MISSING'},message:'secret-provider-body'},content:[{text:'private-result'}]});
 assert.deepEqual(events.map(e=>e.sequence),[1,2,3,4]);for(const secret of ['private-','foreign','secret-provider-body'])assert.ok(!JSON.stringify(events).includes(secret));
 const updates=[],run={runId:'r',harness:'DSH',job:{id:'j',conversation_id:'c',message_id:'m'}},progress=runProgress({publish:v=>updates.push(v)});progress.start(run);for(const e of events)progress.update(run,e);
 assert.equal(progress.list()[0].tools[0].status,'FAILED');assert.match(progress.list()[0].tools[0].error,/缺少凭据/);progress.finish('r','CANCELLED');assert.equal(progress.update(run,{sequence:5,kind:'phase',phase:'reply'}),false);assert.equal(progress.list()[0].status,'CANCELLED');
 time=4000;p.stream({agent,frame:{type:'chunk',chunk:{type:'reasoning-delta',text:'still-private'}}});assert.equal(events.at(-1).phase,'reasoning');assert.equal(events.length,5);assert.ok(!JSON.stringify(events).includes('still-private'));
});
test('progress is bounded, reconnectable, terminal and expires without modifying saved messages',()=>{
 let now=1000;const p=runProgress({clock:()=>now,ttlMs:100,maxEntries:2}),run=n=>({runId:'r'+n,harness:'DSH',job:{id:'j'+n,conversation_id:'c',message_id:'m'+n}});
 p.start(run(1));p.phase('r1','waiting','p/m');p.update(run(1),{sequence:1,kind:'tool_start',name:'web_fetch',call_id:'x'});p.finish('r1','FAILED');assert.equal(p.list()[0].tools[0].status,'INTERRUPTED');now+=101;assert.equal(p.list().length,0);for(let n=0;n<4;n++)p.start(run(n));assert.equal(p.list().length,2);
});
test('DSH web settings are reused independently of chat models while unrelated tools remain disabled',t=>{
 const home=mkdtempSync(join(tmpdir(),'teacher-web-config-'));t.after(()=>rmSync(home,{recursive:true,force:true}));mkdirSync(join(home,'profiles','desktop'),{recursive:true});writeFileSync(join(home,'profiles','desktop','cordis.patch.yml'),JSON.stringify([{id:'web',config:{searchProvider:'deepseek-search-api',fetchProvider:'http'}},{id:'web-deepseek-api',config:{apiKeyEnv:'SEARCH_KEY'}}]));
 const web=resolveDshWeb({home});assert.equal(web[0].config.searchProvider,'deepseek-search-api');const patch=dshPatch({model:'qoder-cn/Auto'},{sourceHome:home,bridge:'test'});assert.equal(patch.findLast(p=>p.id==='tool-web').disabled,false);for(const id of ['tool-bash','tool-fs','tool-subagent'])assert.equal(patch.findLast(p=>p.id===id).disabled,true);
});
test('DSH-only proxy is persistent, bypasses loopback and does not change parent or system environment',t=>{
 const home=mkdtempSync(join(tmpdir(),'teacher-network-'));t.after(()=>rmSync(home,{recursive:true,force:true}));const before=process.env.HTTPS_PROXY,n=dshNetwork(home);assert.deepEqual(n.env(),{});n.set('http://127.0.0.1:7897');assert.equal(n.env().HTTPS_PROXY,'http://127.0.0.1:7897');assert.match(n.env().NO_PROXY,/127\.0\.0\.1/);assert.equal(process.env.HTTPS_PROXY,before);assert.equal(dshNetwork(home).get().proxy_url,'http://127.0.0.1:7897');assert.throws(()=>n.set('http://user:password@127.0.0.1:7897'));n.set('');assert.deepEqual(n.env(),{});
});
