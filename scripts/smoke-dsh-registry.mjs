// Uses the installed DSH/Qoder account only to enumerate models and validate
// adapter readiness. No prompt, paid inference, or learning database is used.
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const app=process.env.TEACHER_DSH_APP_ROOT;
const source=path=>app?pathToFileURL(join(app,path)).href:new URL('../'+path,import.meta.url).href;
const {createDshModelDirectory}=await import(source('server/dsh-model-directory.mjs'));
const {dshCommand,dshPatch}=await import(source('server/dsh-host.mjs'));
const {discoverDsh}=await import(source('server/dsh-discovery.mjs'));
const dir=mkdtempSync(join(tmpdir(),'teacher-registry-ready-')),home=process.env.DSH_HOME||join(homedir(),'.dsh');
const config=join(home,'profiles','desktop','cordis.patch.yml'),hash=()=>createHash('sha256').update(readFileSync(config)).digest('hex'),before=hash();
const host=await discoverDsh();assert.ok(host.found);const directory=createDshModelDirectory({home,runtimeHome:join(dir,'catalog'),detect:async()=>host});
try{
 const catalog=await directory.refresh();assert.equal(catalog.discovery,'runtime',JSON.stringify(catalog.diagnostics));
 const choice=catalog.models.find(row=>row.provider==='qoder-cn');assert.ok(choice,'installed Qoder CN must be discoverable');
 const modelConfig=await directory.resolve({model:choice.id});assert.equal(modelConfig.registry.plugins.length,1);
 const completion=join(dir,'complete.mjs');writeFileSync(completion,"export const inject=['teacherModelReady','llm'];export async function apply(ctx){process.stdout.write(JSON.stringify({type:'teacher_registry_ready',ready:true})+'\\n');ctx.get('appExit')(0);}");
 const patch=dshPatch({model:choice.id},{modelConfig,sourceHome:home,session:{logs:join(dir,'logs')},bridge:'unused',baseUrl:'http://127.0.0.1:9',token:'unused'}).filter(row=>!row.insert?.some(p=>p.id==='mcp-teacher-job'));
 patch.push({id:'headless-runner',disabled:true},{id:'headless-startup',disabled:true},{insert:[{id:'teacher-ready-check',name:pathToFileURL(completion).href}]});
 const file=join(dir,'ready.json');writeFileSync(file,JSON.stringify(patch),{mode:0o600});const launch=dshCommand(host.executable);
 const result=await new Promise((resolve,reject)=>{
  let ready=false;const child=spawn(launch.command,[...launch.args,'--profile','headless','--patch',file],{cwd:dir,env:{...process.env,...launch.env,DSH_HOME:join(dir,'conversation'),DSH_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>child.kill(),35000);child.stderr.on('data',()=>{});child.stdout.on('data',chunk=>{if(chunk.toString().includes('"type":"teacher_registry_ready"'))ready=true;});child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve({code,ready});});
 });
 assert.deepEqual(result,{code:0,ready:true});assert.equal(hash(),before,'discovery must not modify the source DSH configuration');
 const report={version:JSON.parse(readFileSync(app?join(app,'package.json'):new URL('../package.json',import.meta.url),'utf8')).version,models:catalog.models.length,providers:[...new Set(catalog.models.map(m=>m.provider))],qoderCn:catalog.models.filter(m=>m.provider==='qoder-cn').length,qoder:catalog.models.filter(m=>m.provider==='qoder').length,selected:choice.id,executionAdapterReady:true,sourceConfigUnchanged:true,noInference:true,diagnostics:catalog.diagnostics};
 mkdirSync('outputs',{recursive:true});writeFileSync(resolve('outputs','dsh-registry-ready'+(app?'-packaged':'')+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await directory.close();rmSync(dir,{recursive:true,force:true});}
