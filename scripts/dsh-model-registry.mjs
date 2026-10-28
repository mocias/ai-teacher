// Runs inside DSH. Its own registry is the authority for model IDs, labels,
// regional switches and plugin filters. Never project adapter config or secrets.
import {registerHooks} from 'node:module';
import {dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
export const name='teacher-model-registry';
export const inject=['llm'];
const clean=value=>typeof value==='string'?value.slice(0,150):'';
const issue=(plugin,code)=>({plugin:clean(plugin),code});
// Optional adapter-specific cache optimization, independent of discovery. The
// registry still supplies all providers/models, including unfamiliar plugins.
// Only Qoder's public catalog schema is copied, never arbitrary home files.
export function seedPublicModelCatalogs(sourceHome,targetHome,plugins=[]){
 if(!sourceHome||!targetHome||sourceHome===targetHome||!plugins.some(p=>p.id==='llm-qoder'))return;
 for(const filename of ['.qoder-catalog.qoder-cn.json','.qoder-catalog.qoder.json'])try{
  const raw=readFileSync(join(sourceHome,filename),'utf8');if(raw.length>1_000_000)continue;const cached=JSON.parse(raw);
  if(cached.version!==1||!Number.isFinite(cached.fetchedAt)||!Array.isArray(cached.entries))continue;
  try{if(JSON.parse(readFileSync(join(targetHome,filename),'utf8')).fetchedAt>=cached.fetchedAt)continue;}catch{}
  const entries=cached.entries.slice(0,500).filter(e=>e&&typeof e.id==='string'&&typeof e.key==='string').map(e=>{
   const value={};for(const key of ['id','key','name'])if(typeof e[key]==='string')value[key]=e[key].slice(0,150);
   for(const key of ['isVL','isReasoning','supportsEffort','alwaysThinking','isFree','isDefault'])if(typeof e[key]==='boolean')value[key]=e[key];
   for(const key of ['maxInputTokens','defaultContextWindow','priceFactor'])if(Number.isFinite(e[key]))value[key]=e[key];
   value.effortLevels=Array.isArray(e.effortLevels)?e.effortLevels.filter(v=>typeof v==='string').slice(0,20):[];
   value.contextOptions=Array.isArray(e.contextOptions)?e.contextOptions.filter(Number.isFinite).slice(0,20):[];return value;
  });
  mkdirSync(targetHome,{recursive:true});const target=join(targetHome,filename),tmp=target+'.teacher-'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify({version:1,fetchedAt:cached.fetchedAt,entries}));renameSync(tmp,target);
 }catch{/* A missing/malformed cache falls back to the plugin's own discovery. */}
}
export async function inspectRegistry(ctx,plugins=[]){
 const owners=new Map(),diagnostics=[];
 for(const entry of plugins){
  try{
   const mod=await import(entry.entry);
   const required=Array.isArray(mod.inject)?mod.inject:Object.keys(mod.inject?.required||{});
   if(!required.includes('llm')||required.some(key=>!['llm','credentials'].includes(key))){diagnostics.push(issue(entry.id,'UNSUPPORTED_DEPENDENCIES'));continue;}
   const before=new Set(ctx.llm.listProviders().map(p=>p.id));
   const fiber=await ctx.plugin(mod,entry.config||{});
   const added=ctx.llm.listProviders().filter(p=>!before.has(p.id));
   if(!added.length){diagnostics.push(issue(entry.id,'NO_PROVIDERS'));await fiber.dispose();continue;}
   for(const provider of added)owners.set(provider.id,entry.id);
  }catch(error){diagnostics.push({...issue(entry.id,'PLUGIN_LOAD_FAILED'),...typeof error.code==='string'&&/^[A-Z_]+$/.test(error.code)?{reason:error.code}:{}});}
 }
 const providers=[],models=[];
 // Plugin catalogs can arrive asynchronously after the provider registers.
 // Wait once for the set, rather than treating startup's empty catalog as final.
 const pending=new Set(owners.keys()),until=Date.now()+8000;
 while(pending.size&&Date.now()<until){
  for(const provider of pending)try{if((await ctx.llm.listModels(provider)).length)pending.delete(provider);}catch{pending.delete(provider);}
  if(pending.size)await new Promise(resolve=>setTimeout(resolve,150));
 }
 for(const provider of ctx.llm.listProviders()){
  const owner=owners.get(provider.id)||null;
  try{
   const rows=await ctx.llm.listModels(provider.id);
   providers.push({id:clean(provider.id),name:clean(provider.name),owner});
   for(const row of rows)models.push({provider:clean(provider.id),model:clean(row.id),name:clean(row.name),provider_name:clean(provider.name),owner});
   if(owner&&!rows.length)diagnostics.push(issue(owner,'EMPTY_CATALOG'));
  }catch{diagnostics.push(issue(owner||provider.id,'MODEL_LIST_FAILED'));}
 }
 return {providers,models,diagnostics};
}
export async function apply(ctx,config={}){
 try{
  seedPublicModelCatalogs(config.sourceHome,process.env.DSH_HOME,config.plugins);
  // Installed profile extensions rely on the executing DSH's peer packages.
  // A conversation has its own DSH_HOME; resolve missing peers from this CLI,
  // without copying the Desktop profile or importing unrelated plugins.
  const roots=(config.plugins||[]).map(p=>pathToFileURL(dirname(fileURLToPath(p.entry))+'/').href);
  if(roots.length){const hook=registerHooks({resolve(specifier,context,nextResolve){
   try{return nextResolve(specifier,context);}catch(error){
    if(error.code!=='ERR_MODULE_NOT_FOUND'||!roots.some(root=>context.parentURL?.startsWith(root))||specifier.startsWith('.')||specifier.includes(':'))throw error;
    return nextResolve(specifier,{...context,parentURL:pathToFileURL(process.argv[1]).href});
   }
  }});ctx.effect(()=>()=>hook.deregister());}
  // Other core adapter fibers mount in the same loader turn.
  await new Promise(resolve=>setTimeout(resolve,100));
  const result=await inspectRegistry(ctx,config.plugins);
  if(config.mode==='probe'){
   process.stdout.write(JSON.stringify({type:'teacher_model_catalog',...result})+'\n');
   ctx.get('appExit')(0);return;
  }
  const selected=config.selection;
  if(!result.providers.some(p=>p.id===selected?.provider)||!result.models.some(m=>m.provider===selected.provider&&m.model===selected.model)){
   process.stdout.write(JSON.stringify({type:'error',message:'MODEL_NOT_FOUND: DSH 模型提供商未就绪或模型已从目录移除，请刷新列表检查插件状态',diagnostics:result.diagnostics,providers:result.providers.map(p=>p.id)})+'\n');
   ctx.get('appExit')(1);return;
  }
  ctx.provide('teacherModelReady',true);
 }catch{
  process.stdout.write(JSON.stringify({type:'error',message:'MODEL_NOT_FOUND: 无法读取 DSH 运行时模型目录，请检查插件状态'})+'\n');
  ctx.get('appExit')(1);
 }
}
