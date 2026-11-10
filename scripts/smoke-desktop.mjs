import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const choices=process.argv.includes('--choices');
const attachments=process.argv.includes('--attachments'),workflowReturn=process.argv.includes('--workflow-return');
const readerTools=process.argv.includes('--reader-tools'),uiNavigation=process.argv.includes('--ui-navigation');
const layout=process.argv.includes('--layout');
const readerSelection=process.argv.includes('--reader-selection');
const readerSidebar=process.argv.includes('--reader-sidebar');
const readerNetwork=process.argv.includes('--reader-network');
const planning=process.argv.includes('--planning');
const canonical=process.argv.includes('--canonical');
const priorLearning=canonical||process.argv.includes('--prior-learning');
const feedback=process.argv.includes('--feedback'),directConfig=process.argv.includes('--direct-config'),registry=process.argv.includes('--registry'),modelPicker=process.argv.includes('--model-picker')||registry,performance=process.argv.includes('--performance'),packaged=process.argv.includes('--packaged'),streaming=process.argv.includes('--streaming'),chatUI=process.argv.includes('--chat-ui'),dsh=process.argv.includes('--dsh'),recovery=process.argv.includes('--recovery'),remediation=process.argv.includes('--remediation')||recovery,followups=process.argv.includes('--followups')||remediation;
const work=mkdtempSync(join(tmpdir(),'teacher-desktop-smoke-'));
const recoveryVersion=packaged && recovery ? JSON.parse(readFileSync(join(resolve(process.env.TEACHER_PACKAGE_DIR||'dist/AI Teacher-win32-x64'),'resources','app','package.json'),'utf8')).version : '';
const output=process.env.TEACHER_SMOKE_OUTPUT?resolve(process.env.TEACHER_SMOKE_OUTPUT):resolve('outputs',readerNetwork?(packaged?'desktop-reader-network-packaged':'desktop-reader-network-dev'):planning?(packaged?'planning-v0160/packaged':'planning-v0160/dev'):process.argv.includes('--input')?(packaged?'bugfix-v0151/input-packaged':'bugfix-v0151/input-dev'):canonical?(packaged?'desktop-canonical-packaged':'desktop-canonical-dev'):priorLearning?(packaged?'desktop-prior-learning-packaged':'desktop-prior-learning-dev'):feedback?(packaged?'desktop-feedback-packaged':'desktop-feedback-dev'):directConfig?(packaged?'desktop-direct-config-packaged':'desktop-direct-config-dev'):registry?(packaged?'desktop-registry-packaged':'desktop-registry-dev'):modelPicker?(packaged?'desktop-model-picker-packaged':'desktop-model-picker-dev'):performance?(packaged?'desktop-performance-packaged':'desktop-performance-dev'):streaming?(packaged?'desktop-streaming-packaged':'desktop-streaming-dev'):chatUI?(packaged?'desktop-chat-ui-packaged':'desktop-chat-ui-dev'):dsh?(packaged?'desktop-dsh-packaged':'desktop-dsh-dev'):recovery?(packaged?'desktop-v'+recoveryVersion+'-recovery-packaged':'desktop-recovery-dev'):remediation?(packaged?'desktop-v07-packaged':'desktop-v07-dev'):followups?(packaged?'desktop-v06-packaged':'desktop-v06-dev'):packaged&&process.env.TEACHER_PACKAGE_DIR?'desktop-packaged-next':packaged?'desktop-packaged':'desktop-dev');
mkdirSync(join(work,'profile'),{recursive:true});
const exe=packaged?resolve(process.env.TEACHER_PACKAGE_DIR||'dist/AI Teacher-win32-x64','AI Teacher.exe'):resolve('node_modules/electron/dist/electron.exe');
if(packaged){
 const personal=readFileSync(join(resolve(process.env.TEACHER_PACKAGE_DIR||'dist/AI Teacher-win32-x64'),'resources','app','public','personal.html'),'utf8');
 assert.match(personal,/让学习从了解你开始/,'Packaged desktop must include the current onboarding layout');
}
const env={...process.env,TEACHER_DATA_DIR:join(work,'data'),TEACHER_SMOKE_PROFILE:join(work,'profile'),TEACHER_SMOKE_OUTPUT:output};
delete env.ELECTRON_RUN_AS_NODE;
if(feedback||directConfig||streaming||modelPicker&&!registry){env.DSH_HOME=join(work,'dsh');env.TEACHER_DSH_TEST_KEY='local-test-key';}
if(registry)env.TEACHER_REGISTRY_SMOKE='1';
const child=spawn(exe,[...(!packaged?['.']:[]),'--smoke-test',...(choices?['--choice-smoke']:[]),...(attachments?['--attachment-smoke']:[]),...(workflowReturn?['--workflow-return-smoke']:[]),...(readerTools?['--reader-tools-smoke']:[]),...(uiNavigation?['--ui-navigation-smoke']:[]),...(layout?['--layout-smoke']:[]),...(readerSelection?['--reader-selection-smoke']:[]),...(readerSidebar?['--reader-sidebar-smoke']:[]),...(readerNetwork?['--reader-network-smoke']:[]),...(planning?['--planning-smoke']:[]),...(process.argv.includes('--input')?['--input-smoke']:[]),...(feedback?['--feedback-smoke']:[]),...(directConfig?['--direct-config-smoke']:[]),...(modelPicker?['--model-picker-smoke']:[]),...(performance?['--performance-smoke']:[]),...(streaming?['--streaming-smoke']:[]),...(chatUI?['--chat-ui-smoke']:[]),...(dsh?['--dsh-smoke']:[]),...(process.argv.includes('--reader')?['--reader-smoke']:[]),...(canonical?['--canonical-smoke']:[]),...(priorLearning?['--prior-learning-smoke']:[]),...((process.argv.includes('--learning')||followups||priorLearning)?['--learning-smoke']:[]),...(followups?['--followup-smoke']:[]),...(remediation?['--remediation-smoke']:[]),...(recovery?['--recovery-smoke']:[])],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
const timer=setTimeout(()=>child.kill(),180000);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
assert.equal(code,0,logs);assert.match(logs,/DESKTOP_SMOKE_OK/);if(process.argv.includes('--reader')){assert.match(logs,/READER_SMOKE_OK/);console.log(logs.match(/READER_SMOKE_OK .*/)?.[0]);}
if(readerNetwork){assert.match(logs,/READER_NETWORK_SMOKE_OK/);console.log(logs.match(/READER_NETWORK_SMOKE_OK .*/)?.[0]);}
if(choices){assert.match(logs,/CHOICE_SMOKE_OK/);console.log(logs.match(/CHOICE_SMOKE_OK .*/)?.[0]);}
if(attachments){assert.match(logs,/ATTACHMENT_SMOKE_OK/);console.log(logs.match(/ATTACHMENT_SMOKE_OK .*/)?.[0]);}
if(workflowReturn){assert.match(logs,/WORKFLOW_RETURN_SMOKE_OK/);console.log(logs.match(/WORKFLOW_RETURN_SMOKE_OK .*/)?.[0]);}
if(readerTools){assert.match(logs,/READER_TOOLS_SMOKE_OK/);console.log(logs.match(/READER_TOOLS_SMOKE_OK .*/)?.[0]);}
if(uiNavigation){assert.match(logs,/UI_NAVIGATION_SMOKE_OK/);console.log(logs.match(/UI_NAVIGATION_SMOKE_OK .*/)?.[0]);}
if(layout){assert.match(logs,/LAYOUT_SMOKE_OK/);console.log(logs.match(/LAYOUT_SMOKE_OK .*/)?.[0]);}
if(readerSelection){assert.match(logs,/READER_SELECTION_SMOKE_OK/);console.log(logs.match(/READER_SELECTION_SMOKE_OK .*/)?.[0]);}
if(readerSidebar){assert.match(logs,/READER_SIDEBAR_SMOKE_OK/);console.log(logs.match(/READER_SIDEBAR_SMOKE_OK .*/)?.[0]);}
if(planning){assert.match(logs,/GUIDED_PLANNING_OK/);console.log(logs.match(/GUIDED_PLANNING_OK .*/)?.[0]);}
if(feedback){assert.match(logs,/FEEDBACK_SMOKE_OK/);console.log(logs.match(/FEEDBACK_SMOKE_OK .*/)?.[0]);}
if(directConfig){assert.match(logs,/DIRECT_CONFIG_SMOKE_OK/);console.log(logs.match(/DIRECT_CONFIG_SMOKE_OK .*/)?.[0]);}
if(streaming){assert.match(logs,/STREAMING_SMOKE_OK/);console.log(logs.match(/STREAMING_SMOKE_OK .*/)?.[0]);}
if(modelPicker){assert.match(logs,/MODEL_PICKER_SMOKE_OK/);console.log(logs.match(/MODEL_PICKER_SMOKE_OK .*/)?.[0]);}
if(performance){assert.match(logs,/PERFORMANCE_SMOKE_OK/);console.log(logs.match(/PERFORMANCE_SMOKE_OK .*/)?.[0]);}
if(process.argv.includes('--input')){assert.match(logs,/INPUT_SMOKE_OK/);console.log(logs.match(/INPUT_SMOKE_OK .*/)?.[0]);}
if(chatUI){assert.match(logs,/CHAT_UI_SMOKE_OK/);console.log(logs.match(/CHAT_UI_SMOKE_OK .*/)?.[0]);}
if(dsh){assert.match(logs,/DSH_SMOKE_OK/);console.log(logs.match(/DSH_SMOKE_OK .*/)?.[0]);}
if(process.argv.includes('--learning')||followups||priorLearning){assert.match(logs,/LEARNING_LOOP_SMOKE_OK/);console.log(logs.match(/LEARNING_LOOP_SMOKE_OK .*/)?.[0]);}
const result=JSON.parse(readFileSync(join(output,'result.json'),'utf8'));
assert.equal(result.hasApp,true);assert.equal(result.goals,0);assert.equal(result.packaged,packaged);
assert.deepEqual(result.menus,['AI Teacher','编辑','视图']);
assert.ok(existsSync(join(work,'data','teacher.sqlite')));
await assert.rejects(fetch(result.base+'/api/health',{signal:AbortSignal.timeout(1000)}));
console.log(JSON.stringify({ok:true,packaged,output,serviceStopped:true,result},null,2));
