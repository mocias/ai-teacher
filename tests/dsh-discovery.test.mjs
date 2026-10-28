import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {discoverDsh,windowsDshCandidates,createDshDetector} from '../server/dsh-discovery.mjs';

const root=tmpdir();
test('DSH discovery finds a custom drive installation from Windows registration and checks its CLI',async()=>{
 const executable=join(root,'个人软件','DeepSeek Harness.exe'),calls=[];
 const result=await discoverDsh({env:{},platform:'win32',exists:path=>path===executable,windowsCandidates:async()=>windowsDshCandidates({installed:[{InstallLocation:join(root,'个人软件')}]}),run:async(command,args,options)=>{
  calls.push({command,args,options});return {stdout:'0.2.1-rc.3\n'};
 }});
 assert.equal(result.executable,executable);assert.equal(result.found,true);assert.equal(result.source,'Windows 安装记录');
 assert.equal(result.version,'0.2.1-rc.3');assert.equal(calls.length,1);assert.equal(calls[0].options.windowsHide,true);
 assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(calls[0].args.at(-1),'--version');
 assert.equal(calls[0].options.shell,undefined);
});

test('DSH discovery skips stale or broken installations and supports running apps and shortcuts',async()=>{
 const broken=join(root,'broken','DeepSeek Harness.exe'),live=join(root,'portable','DeepSeek Harness.exe');
 const rows=windowsDshCandidates({installed:[{DisplayIcon:'"'+broken+'",0'},{InstallLocation:join(root,'missing')}],running:[live],shortcuts:[live]});
 let checks=0;
 const result=await discoverDsh({env:{},platform:'win32',exists:path=>[broken,live].includes(path),windowsCandidates:async()=>rows,run:async(command)=>{checks++;if(command===broken)throw Error('stale');return {stdout:'dsh 0.2.1'};}});
 assert.equal(result.executable,live);assert.equal(result.source,'运行中的 DSH');assert.equal(checks,2);
 const shortcut=await discoverDsh({env:{},platform:'win32',exists:path=>path===live,windowsCandidates:async()=>windowsDshCandidates({shortcuts:[live]}),run:async()=>({stdout:'0.2.1'})});
 assert.equal(shortcut.source,'开始菜单或桌面快捷方式');
});

test('DSH discovery keeps environment priority and works without Windows inventory',async()=>{
 const executable=join(root,'dsh.exe');
 const result=await discoverDsh({env:{TEACHER_DSH_EXECUTABLE:executable},platform:'win32',exists:path=>path===executable,windowsCandidates:async()=>{throw Error('PowerShell disabled');},run:async()=>({stdout:'0.2.1'})});
 assert.equal(result.executable,executable);assert.equal(result.source,'环境变量');
 const cli=join(root,'cli','dsh');
 const unix=await discoverDsh({env:{PATH:join(root,'cli')},platform:'linux',exists:path=>path===cli,windowsCandidates:async()=>assert.fail('Windows query on Unix'),run:async()=>({stdout:'0.2.0'})});
 assert.equal(unix.executable,cli);assert.equal(unix.source,'PATH');
 const missing=await discoverDsh({env:{},platform:'win32',exists:()=>false,windowsCandidates:async()=>[],run:async()=>assert.fail('must not execute')});
 assert.equal(missing.found,false);assert.equal(missing.executable,'');
});

test('DSH detection coalesces concurrent requests, refreshes on demand and drops deleted paths',async()=>{
 let calls=0,present=true;
 const detector=createDshDetector({exists:()=>present,discover:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return {found:true,executable:join(root,'dsh.exe'),version:String(calls)};}});
 const [a,b]=await Promise.all([detector(),detector({refresh:true})]);assert.deepEqual(a,b);assert.equal(calls,1);
 await detector();assert.equal(calls,1);await detector({refresh:true});assert.equal(calls,2);
 present=false;await detector();assert.equal(calls,3);
});
