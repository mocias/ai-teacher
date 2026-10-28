import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import {staticAssets} from '../server/static-assets.mjs';
import {startServer} from '../server/index.mjs';

test('public asset revalidation sends no body for unchanged files and serves source edits immediately',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'teacher-assets-')),file=join(dir,'script.js');
 await writeFile(file,'first');const serve=staticAssets({maxBytes:16});
 const server=http.createServer((req,res)=>serve(req,res,file,'text/javascript').catch(()=>{res.writeHead(500);res.end();}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${server.address().port}`;
 const first=await fetch(url),etag=first.headers.get('etag');assert.equal(await first.text(),'first');assert.ok(etag);assert.match(first.headers.get('cache-control'),/no-cache/);
 const cached=await fetch(url,{headers:{'If-None-Match':etag}});assert.equal(cached.status,304);assert.equal(await cached.text(),'');
 await writeFile(file,'second version');
 const edited=await fetch(url,{headers:{'If-None-Match':etag}});assert.equal(edited.status,200);assert.equal(await edited.text(),'second version');assert.notEqual(edited.headers.get('etag'),etag);
 await writeFile(file,'a large file that exceeds the small test cache budget');
 assert.equal((await fetch(url)).status,200);
});

test('HTML refresh renews the user session while private data remains uncached and authenticated',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'teacher-cache-api-'));const app=startServer({port:0,dataDir:dir});await once(app.server,'listening');
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`,page=await fetch(base),cookie=page.headers.get('set-cookie').split(';')[0];await page.text();
 const revalidated=await fetch(base,{headers:{'If-None-Match':page.headers.get('etag')}});assert.equal(revalidated.status,304);assert.ok(revalidated.headers.get('set-cookie'));
 const state=await fetch(base+'/api/state',{headers:{Cookie:cookie,'If-None-Match':'*'}});assert.equal(state.status,200);assert.equal(state.headers.get('cache-control'),'no-store');
 assert.equal((await fetch(base+'/api/state')).status,401);
 for(const path of ['/live-events.js','/workspace.css','/vendor/marked.js']){const first=await fetch(base+path);await first.text();assert.equal(first.status,200);assert.equal((await fetch(base+path,{headers:{'If-None-Match':first.headers.get('etag')}})).status,304);}
});
