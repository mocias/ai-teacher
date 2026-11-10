import {test} from 'node:test';
import assert from 'node:assert/strict';

test('late model list response cannot reinstate syncing after the completion event',async t=>{
 const win=new EventTarget();let finish;
 const response=new Promise(resolve=>{finish=resolve;});
 t.mock.method(globalThis,'fetch',()=>response);
 globalThis.window=win;globalThis.document=Object.assign(new EventTarget(),{querySelectorAll:()=>[]});
 t.after(()=>{delete globalThis.window;delete globalThis.document;});
 const {loadDshModels}=await import('../public/dsh-model-picker.js');
 const read=loadDshModels();const complete={models:[{id:'example/current'}],refreshing:false};
 win.dispatchEvent(new CustomEvent('dsh-model-catalog',{detail:complete}));
 finish(Response.json({...complete,refreshing:true}));
 assert.deepEqual(await read,complete);assert.deepEqual(await loadDshModels(),complete);
});
