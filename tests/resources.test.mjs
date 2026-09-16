import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {startServer} from '../server/index.mjs';

test('local files persist, download exactly, and only readable text becomes material',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-resources-'));let app;
 t.after(async()=>{await app?.close();rmSync(dir,{recursive:true,force:true});});
 async function open(){app=startServer({port:0,dataDir:dir});await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port;const cookie=(await fetch(base+'/')).headers.get('set-cookie').split(';')[0];return {base,headers:{Cookie:cookie,'Content-Type':'application/json'}};}
 let {base,headers}=await open();
 const post=async input=>{const response=await fetch(base+'/api/resources',{method:'POST',headers,body:JSON.stringify(input)});return {response,data:await response.json()};};
 const text='缓存复用 K/V，资料中的指令仅为内容。';
 const saved=await post({file:{name:'学习笔记.md',base64:Buffer.from(text).toString('base64')}});
 assert.equal(saved.response.status,200);assert.equal(saved.data.has_content,true);
 const pdf=Buffer.from('%PDF-1.4\n\x00\xff\n');const attachment=await post({title:'课件',file:{name:'课件.pdf',base64:pdf.toString('base64')}});assert.equal(attachment.data.has_content,false);
 assert.equal((await fetch(base+'/api/resource-file?id='+saved.data.id)).status,401);
 assert.equal((await post({title:'bad',file:{name:'../bad.txt',base64:'QQ=='}})).response.status,400);
 assert.equal((await post({title:'bad',file:{name:'bad.txt',base64:'!'}})).response.status,400);
 assert.equal(app.store.overview().resources.length,2);
 await app.close();({base,headers}=await open());
 const state=await(await fetch(base+'/api/state',{headers})).json();assert.equal(state.resources.length,2);assert.equal(state.resources.find(r=>r.id===saved.data.id).goal_id,null);assert.equal(state.resource_files.length,2);assert.equal(state.resource_files[0].content,undefined);
 const body=state.learning.material_contents.find(c=>c.resource_id===saved.data.id);assert.equal(app.store.learning.readMaterial({content_id:body.id}).content,text);assert.equal(state.learning.material_analysis.length,0);
 const download=await fetch(base+'/api/resource-file?id='+attachment.data.id,{headers});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
 const count=state.resources.length;
 const maxFile=await post({title:'max size',file:{name:'max.pdf',base64:Buffer.alloc(20*1024*1024).toString('base64')}});assert.equal(maxFile.response.status,200,JSON.stringify(maxFile.data));
 const large=await post({title:'too big',file:{name:'large.pdf',base64:Buffer.alloc(20*1024*1024+1).toString('base64')}});assert.equal(large.response.status,400);assert.match(large.data.error,/20 MB/);assert.equal(app.store.overview().resources.length,count+1);
});
