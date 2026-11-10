import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createChatAttachments,CHAT_FILE_LIMIT} from '../public/chat-attachments.js';

const file=(name='学习.md',size=12)=>({name,size});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('queued files stay in their conversation and sending a snapshot preserves newer files',async()=>{
 const requests=[];const attachments=createChatAttachments({api:async(path,input)=>{requests.push({path,input});return {id:'resource-'+requests.length};},readFile:async()=> '5a2m5Lmg'});
 const first=attachments.add('planning',[file()]);attachments.add('discovery',[file('idea.txt')]);
 const snapshot=attachments.snapshot('planning');attachments.add('planning',[file('later.md')]);
 const prepared=await attachments.prepare('planning',snapshot);assert.deepEqual(prepared.tokens,first);assert.equal(prepared.resource_ids.length,1);
 assert.equal(requests[0].path,'resources');assert.equal(requests[0].input.goal_id,undefined);assert.equal(requests[0].input.role,'REFERENCE');
 // Failed message submission leaves the uploaded resource cached for retry.
 assert.deepEqual(await attachments.prepare('planning',snapshot),prepared);assert.equal(requests.length,1);
 attachments.clearSent('planning',prepared.tokens);assert.equal(attachments.count('planning'),1);assert.equal(attachments.count('discovery'),1);
 assert.match(attachments.view('planning'),/later\.md/);assert.doesNotMatch(attachments.view('planning'),/学习\.md/);
});

test('a failed file read or upload preserves pending files and supports retry',async()=>{
 let attempts=0;const attachments=createChatAttachments({api:async()=>{if(++attempts===1)throw Error('离线');return {id:'retry'};},readFile:async()=> 'QQ=='});
 attachments.add('session',[file()]);await assert.rejects(attachments.prepare('session'),/离线/);assert.equal(attachments.count('session'),1);assert.match(attachments.view('session'),/保存未确认/);
 assert.deepEqual((await attachments.prepare('session')).resource_ids,['retry']);assert.equal(attempts,2);
});

test('cancel before reading completes avoids persistence; cancel during persistence never attaches it',async()=>{
 const reading=deferred();let calls=0;const attachments=createChatAttachments({api:async()=>{calls++;return {id:'saved'};},readFile:()=>reading.promise});
 const [token]=attachments.add('a',[file()]);const pending=attachments.prepare('a');attachments.remove('a',token);reading.resolve('QQ==');assert.deepEqual((await pending).resource_ids,[]);assert.equal(calls,0);
 const uploading=deferred();const other=createChatAttachments({api:()=>uploading.promise,readFile:async()=> 'QQ=='});const [second]=other.add('b',[file()]);const operation=other.prepare('b');await Promise.resolve();other.remove('b',second);uploading.resolve({id:'original-remains-in-library'});assert.deepEqual((await operation).resource_ids,[]);assert.equal(other.count('b'),0);
});

test('overlapping prepares share a single resource upload',async()=>{
 const reading=deferred();let uploads=0;const attachments=createChatAttachments({api:async()=>{uploads++;return {id:'one'};},readFile:()=>reading.promise});attachments.add('a',[file()]);
 const one=attachments.prepare('a'),two=attachments.prepare('a');reading.resolve('QQ==');assert.deepEqual(await one,await two);assert.equal(uploads,1);
});

test('selection limits are atomic and attachment names cannot inject HTML',()=>{
 const attachments=createChatAttachments();attachments.add('a',[file('safe.md')]);
 assert.throws(()=>attachments.add('a',[file('ok.txt'),file('too-large.pdf',CHAT_FILE_LIMIT+1)]),/20 MB/);assert.equal(attachments.count('a'),1);
 assert.throws(()=>attachments.add('a',[file('combined.pdf',CHAT_FILE_LIMIT)]),/总大小/);assert.equal(attachments.count('a'),1);
 assert.throws(()=>attachments.add('a',Array.from({length:5},()=>file())),/最多/);assert.throws(()=>attachments.add('a',[file('empty.md',0)]),/非空/);
 assert.throws(()=>attachments.add('a',[file('../bad.md')]),/文件名/);
 attachments.add('a',[file('<img src=x onerror=alert(1)>.md')]);assert.doesNotMatch(attachments.view('a'),/<img/);assert.match(attachments.view('a'),/&lt;img/);
});

test('Explorer file drops suppress navigation and remain bound to the captured conversation',()=>{
 const attachments=createChatAttachments();const dropTarget={},root={querySelector:()=>null};attachments.bind(root,'original',{dropTarget});
 let prevented=0,stopped=0;const event={dataTransfer:{types:['Files'],files:[file()]},preventDefault:()=>prevented++,stopPropagation:()=>stopped++};dropTarget.ondragover(event);dropTarget.ondrop(event);
 assert.equal(prevented,2);assert.equal(stopped,1);assert.equal(attachments.count('original'),1);assert.equal(attachments.count('another'),0);
 attachments.move('original','created');assert.equal(attachments.count('original'),0);assert.equal(attachments.count('created'),1);
});
