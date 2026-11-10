import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../server/index.mjs';
import {id} from '../server/store.mjs';

test('lease maintenance is quiet, but recovery from GET state notifies other clients',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-events-')),controller=new AbortController();
 const app=startServer({port:0,dataDir:dir,executorOptions:{intervalMs:1000000},hostOptions:{intervalMs:1000000},harnessOptions:{intervalMs:1000000}});
 await once(app.server,'listening');
 t.after(async()=>{controller.abort();await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,headers={Cookie:(await fetch(base)).headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 const s=app.store,g=s.createGoal({title:'后台续租',domain:'测试'});s.send(g.conversation.id,'等待',id());const job=s.claim('Manual',g.conversation.id).job;
 // Publish a real operation to establish the old implementation's baseline.
 await fetch(base+'/api/notes',{method:'POST',headers,body:JSON.stringify({title:'正常保存',content:'用于设置通知基线'})});
 const stream=await fetch(base+'/api/events',{headers,signal:controller.signal});let events='';
 const reading=(async()=>{try{for await(const chunk of stream.body)events+=new TextDecoder().decode(chunk);}catch(e){if(!controller.signal.aborted)throw e;}})();
 t.after(()=>reading);
 s.renew(job.id,job.lease_token);
 await new Promise(r=>setTimeout(r,5300));
 assert.equal((events.match(/data: changed/g)||[]).length,0,'lease-only writes must not trigger the study timer refresh');
 s.db.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(job.id);
 const state=await(await fetch(base+'/api/state',{headers})).json();
 assert.equal(state.jobs.find(j=>j.id===job.id).status,'QUEUED');
 for(let i=0;i<50&&!events.includes('data: changed');i++)await new Promise(r=>setTimeout(r,10));
 assert.equal((events.match(/data: changed/g)||[]).length,1,'GET recovery must notify the other open page');
});
