import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {startServer} from '../server/index.mjs';

test('desktop service identity distinguishes libraries and graceful close persists data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-desktop-test-'));
 async function open(dataDir){const service=startServer({port:0,dataDir});await once(service.server,'listening');const base=`http://127.0.0.1:${service.server.address().port}`;return {service,base,health:await(await fetch(base+'/api/health')).json()};}
 const first=await open(join(dir,'a'));
 assert.equal(first.health.service,'ai-teacher');assert.match(first.health.data_id,/^[a-f0-9]{64}$/);
 const goal=first.service.store.createGoal({title:'Desktop persistence',domain:'Test'});
 await first.service.close();await first.service.close();
 await assert.rejects(fetch(first.base+'/api/health'));
 const second=await open(join(dir,'a'));
 try{assert.equal(second.health.data_id,first.health.data_id);assert.equal(second.service.store.overview().goals[0].id,goal.goal.id);}finally{await second.service.close();}
 const other=await open(join(dir,'b'));
 try{assert.notEqual(other.health.data_id,first.health.data_id);assert.equal(other.service.store.overview().goals.length,0);}finally{await other.service.close();}
});
