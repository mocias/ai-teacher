import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const packaged=process.argv.includes('--packaged'),remediation=process.argv.includes('--remediation'),followups=process.argv.includes('--followups')||remediation;
const work=mkdtempSync(join(tmpdir(),'teacher-desktop-smoke-'));
const output=resolve('outputs',remediation?(packaged?'desktop-v07-packaged':'desktop-v07-dev'):followups?(packaged?'desktop-v06-packaged':'desktop-v06-dev'):packaged&&process.env.TEACHER_PACKAGE_DIR?'desktop-packaged-next':packaged?'desktop-packaged':'desktop-dev');
mkdirSync(join(work,'profile'),{recursive:true});
const exe=packaged?resolve(process.env.TEACHER_PACKAGE_DIR||'dist/AI Teacher-win32-x64','AI Teacher.exe'):resolve('node_modules/electron/dist/electron.exe');
if(packaged){
 const personal=readFileSync(join(resolve(process.env.TEACHER_PACKAGE_DIR||'dist/AI Teacher-win32-x64'),'resources','app','public','personal.html'),'utf8');
 assert.match(personal,/让学习从了解你开始/,'Packaged desktop must include the current onboarding layout');
}
const env={...process.env,TEACHER_DATA_DIR:join(work,'data'),TEACHER_SMOKE_PROFILE:join(work,'profile'),TEACHER_SMOKE_OUTPUT:output};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(exe,[...(!packaged?['.']:[]),'--smoke-test',...(process.argv.includes('--reader')?['--reader-smoke']:[]),...((process.argv.includes('--learning')||followups)?['--learning-smoke']:[]),...(followups?['--followup-smoke']:[]),...(remediation?['--remediation-smoke']:[])],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
const timer=setTimeout(()=>child.kill(),180000);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
assert.equal(code,0,logs);assert.match(logs,/DESKTOP_SMOKE_OK/);if(process.argv.includes('--reader')){assert.match(logs,/READER_SMOKE_OK/);console.log(logs.match(/READER_SMOKE_OK .*/)?.[0]);}
if(process.argv.includes('--learning')||followups){assert.match(logs,/LEARNING_LOOP_SMOKE_OK/);console.log(logs.match(/LEARNING_LOOP_SMOKE_OK .*/)?.[0]);}
const result=JSON.parse(readFileSync(join(output,'result.json'),'utf8'));
assert.equal(result.hasApp,true);assert.equal(result.goals,0);assert.equal(result.packaged,packaged);
assert.deepEqual(result.menus,['AI Teacher','编辑','视图']);
assert.ok(existsSync(join(work,'data','teacher.sqlite')));
await assert.rejects(fetch(result.base+'/api/health',{signal:AbortSignal.timeout(1000)}));
console.log(JSON.stringify({ok:true,packaged,output,serviceStopped:true,result},null,2));
