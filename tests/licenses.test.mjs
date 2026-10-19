import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nodeLicense} from '../scripts/generate-licenses.mjs';

test('offline packaging accepts only a cached license for the exact runtime and unchanged contents',async t=>{
 const root=mkdtempSync(join(tmpdir(),'teacher-license-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'licenses'));
 const source='Node.js is licensed for use as follows:\nPermission is hereby granted\nIsolated test fixture.';
 const online=await nodeLicense(root,{fetcher:async()=>({ok:true,text:async()=>source})});
 writeFileSync(join(root,'licenses/Node-LICENSE.txt'),source);writeFileSync(join(root,'licenses/Node-LICENSE.meta.json'),JSON.stringify(online.meta));
 const noNetwork=()=>{throw Error('offline mode must not fetch');};
 assert.deepEqual(await nodeLicense(root,{offline:true,fetcher:noNetwork}),online);
 writeFileSync(join(root,'licenses/Node-LICENSE.meta.json'),JSON.stringify({...online.meta,version:'v0.0.0'}));await assert.rejects(nodeLicense(root,{offline:true}),/runtime or file hash/);
 writeFileSync(join(root,'licenses/Node-LICENSE.meta.json'),JSON.stringify(online.meta));writeFileSync(join(root,'licenses/Node-LICENSE.txt'),source+' altered');await assert.rejects(nodeLicense(root,{offline:true}),/runtime or file hash/);
 await assert.rejects(nodeLicense(root,{fetcher:async()=>({ok:true,text:async()=>'<html>error</html>'})}),/Unexpected Node license/);
});
