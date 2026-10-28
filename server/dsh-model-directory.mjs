import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readDshCatalog,resolveDshModel} from './dsh-model.mjs';
import {discoverDshModelPlugins} from './dsh-provider-plugins.mjs';
import {createDshDetector} from './dsh-discovery.mjs';
import {dshCommand,dshDisabledPlugins} from './dsh-host.mjs';

const registry=pathToFileURL(fileURLToPath(new URL('../scripts/dsh-model-registry.mjs',import.meta.url))).href;
const messages={UNSUPPORTED_DEPENDENCIES:'需要 headless 环境未提供的服务',NO_PROVIDERS:'没有注册模型提供商，请检查插件登录或启用状态',EMPTY_CATALOG:'提供商未返回模型，请检查登录、模型开关或网络后刷新',PLUGIN_LOAD_FAILED:'插件加载失败，请检查 DSH 插件依赖',MODEL_LIST_FAILED:'模型目录读取失败',PLUGIN_MISSING:'插件文件缺失',BUNDLE_UNREADABLE:'无法读取插件声明',DYNAMIC_CONFIG:'包含动态配置，无法自动复用',INVALID_CONFIG:'配置格式错误',DISABLED:'已在 DSH 配置中停用'};
const explain=rows=>rows.map(row=>({plugin:row.plugin,code:row.code,...row.reason?{reason:row.reason}:{},message:messages[row.code]||'请检查 DSH 模型设置'}));
const fail=message=>{throw Object.assign(Error(message),{status:409});};

export async function probeDshRegistry({home,runtimeHome,plugins,executable,signal,spawnProcess=spawn}){
 const dir=mkdtempSync(join(tmpdir(),'teacher-model-catalog-')),file=join(dir,'probe.json');
 const native=[],providers={},declared=readDshCatalog({home});for(const provider of new Set(declared.models.map(m=>m.provider))){const model=declared.models.find(m=>m.provider===provider);for(const patch of resolveDshModel({model:model.id},{home}).adapterPatches){if(patch.id==='llm-pi-ai')Object.assign(providers,patch.config.providers);else native.push(patch);}}
 if(Object.keys(providers).length)native.push({id:'llm-pi-ai',disabled:false,config:{providers}});
 const patch=[...dshDisabledPlugins.map(id=>({id,disabled:true})),{id:'headless-runner',disabled:true},{id:'headless-startup',disabled:true},{id:'credentials',disabled:false,config:{path:join(home,'.credentials.yaml'),dshHome:home,watch:false}},...native,{insert:[{id:'teacher-model-registry',name:registry,config:{mode:'probe',plugins,sourceHome:home}}]}];
 writeFileSync(file,JSON.stringify(patch),{mode:0o600});
 try{
  const launch=dshCommand(executable);
  return await new Promise((resolve,reject)=>{
   let result,buffer='',bytes=0,settled=false;
   const child=spawnProcess(launch.command,[...launch.args,'--profile','headless','--patch',file],{env:{...process.env,...launch.env,DSH_HOME:runtimeHome||join(dir,'home'),DSH_TELEMETRY_DISABLED:'1'},cwd:dir,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
   const timer=setTimeout(()=>{child.kill();},25000),abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
   child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>1_000_000){child.kill();return;}buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const v=JSON.parse(line);if(v.type==='teacher_model_catalog')result=v;}catch{}}});
   // Provider logs can contain URLs/account details; never return or persist them.
   child.stderr.on('data',()=>{});child.once('error',()=>finish(Error('无法启动 DSH 模型目录查询')));
   child.once('close',code=>finish(code===0&&result?null:Error('DSH 模型目录查询未完成，请检查插件后刷新')));
  });
 }finally{rmSync(dir,{recursive:true,force:true});}
}

export function createDshModelDirectory({home=process.env.DSH_HOME||join(homedir(),'.dsh'),runtimeHome,detect=createDshDetector(),probe=probeDshRegistry,ttlMs=60000}={}){
 let cached=null,pending=null,failure=null,checkedAt=0,fingerprint='',closed=false;const abort=new AbortController();
 function snapshot(){
  const declared=readDshCatalog({home}),found=discoverDshModelPlugins(home);
  if(cached&&fingerprint===found.fingerprint)return {...cached,default_model:declared.default_model,source:declared.source};
  if(failure?.fingerprint===found.fingerprint)return {...declared,diagnostics:explain(found.diagnostics),discovery:'unavailable',error:failure.message};
  return {...declared,diagnostics:explain(found.diagnostics),discovery:found.configured?'pending':'declared'};
 }
 async function refresh({force=false}={}){
  if(pending)return pending;
  const found=discoverDshModelPlugins(home),declared=readDshCatalog({home});
  if(!found.configured&&!found.plugins.length)return snapshot();
  if(!force&&cached&&fingerprint===found.fingerprint&&Date.now()-checkedAt<ttlMs)return snapshot();
  pending=(async()=>{
   try{
    const host=await detect();if(!host.found)throw Error('未检测到 DSH，无法核对插件模型');
    const result=await probe({home,runtimeHome,plugins:found.plugins,executable:host.executable,signal:abort.signal});
    if(closed)throw Error('模型目录查询已关闭');
    if(discoverDshModelPlugins(home).fingerprint!==found.fingerprint)throw Error('查询期间 DSH 配置已变化，请重新刷新模型列表');
    const models=[],seen=new Set();
    for(const row of result.models||[]){
     const {provider,model}=row;if(typeof provider!=='string'||typeof model!=='string'||!provider||provider.includes('/')||!model)continue;
     const id=provider+'/'+model;if(id.length>150||/[\x00-\x1f]/.test(id)||seen.has(id)||models.length>=500)continue;seen.add(id);
     models.push({id,provider,model,name:typeof row.name==='string'?row.name.slice(0,150):model,provider_name:typeof row.provider_name==='string'?row.provider_name.slice(0,100):provider,source:row.owner?'DSH 插件 · '+row.owner:'DSH 运行时',owner:row.owner||null});
    }
    const diagnostics=explain([...found.diagnostics,...result.diagnostics||[]]);
    for(const old of declared.models)if(!seen.has(old.id))diagnostics.push({plugin:old.provider,code:'MODEL_UNAVAILABLE',message:'已声明的模型未在 DSH 运行时注册：'+old.model});
    cached={...declared,models,diagnostics,discovery:'runtime',checked_at:new Date().toISOString()};failure=null;fingerprint=found.fingerprint;checkedAt=Date.now();return snapshot();
   }catch(error){
    // Do not label a stale snapshot as ready after an extension changed or failed.
    cached=null;failure={fingerprint:found.fingerprint,message:error.message};return {...declared,diagnostics:explain(found.diagnostics),discovery:'unavailable',error:error.message};
   }
  })().finally(()=>{pending=null;});return pending;
 }
 async function resolveModel(route){
  const base=resolveDshModel(route,{home}),selected=base.selection;if(!selected)return base;
  const found=discoverDshModelPlugins(home);
  if(!found.configured&&!found.plugins.length)return base;
  const catalog=await refresh();if(catalog.error)fail(catalog.error);
  const row=catalog.models.find(row=>row.provider===selected.provider&&row.model===selected.model);
  if(!row)fail('所选模型当前未在 DSH 运行时注册，请刷新模型列表并检查插件状态');
  const plugin=row.owner?found.plugins.find(p=>p.id===row.owner):null;
  if(row.owner&&!plugin)fail('所选模型的执行插件已改变，请刷新模型列表');
  return {...base,registry:{plugins:plugin?[plugin]:[],selection:selected},source:row.owner?'DSH 插件 · '+row.owner:base.source};
 }
 return {snapshot,refresh,resolve:resolveModel,close:async()=>{closed=true;abort.abort();await pending?.catch(()=>{});}};
}
