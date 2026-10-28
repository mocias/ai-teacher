import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {parseDocument,isMap,isSeq,isAlias} from 'yaml';

const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const dynamic=node=>!!node&&(isAlias(node)||node.tag==='tag:yaml.org,2002:js'||(node.items||[]).some(item=>dynamic(item?.key)||dynamic(item?.value)||dynamic(item)));
function readLayer(file){
 let text;try{text=readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return new Map();fail('无法读取本机 DSH 模型配置，请检查文件权限');}
 const doc=parseDocument(text,{logLevel:'silent'});if(doc.errors.length)fail('本机 DSH 配置格式有误，请在 DSH 中检查模型设置');
 const rows=new Map();
 function visit(seq){if(!isSeq(seq))return;for(const row of seq.items){if(!isMap(row))continue;
  const id=row.get('id'),name=row.get('name');
  const key=['agent-default-model','llm-pi-ai','llm-deepseek'].includes(id)?id:name==='@deepseek-ai/dsh-agent-default-model'?'agent-default-model':name==='@deepseek-ai/dsh-llm-pi-ai'?'llm-pi-ai':name==='@deepseek-ai/dsh-llm-deepseek'?'llm-deepseek':null;
  if(key)rows.set(key,{node:row.get('config',true),disabled:row.get('disabled')===true});
  visit(row.get('insert',true));
 }}visit(doc.contents);return rows;
}

// Public catalog: project only names/IDs. Never expose adapter configuration,
// endpoint headers, API-key environment variables, or credential contents.
export function readDshCatalog({home=process.env.DSH_HOME||join(homedir(),'.dsh')}={}){
 const layers=[['DSH 全局设置','cordis.patch.yml'],['headless','profiles/headless/cordis.patch.yml'],['Desktop','profiles/desktop/cordis.patch.yml']].map(([source,path])=>({source,layer:readLayer(join(home,path))}));
 const providers=new Set(),models=new Map();let selected=null,source='headless 默认值';
 const text=v=>typeof v==='string'?v.trim():'';
 const add=(provider,model,name,providerName,origin)=>{provider=text(provider);model=text(model);const id=provider+'/'+model;if(!provider||provider.includes('/')||!model||id.length>150||/[\x00-\x1f]/.test(id)||models.size>=500)return;models.set(id,{id,provider,model,name:text(name).slice(0,150)||model,provider_name:text(providerName).slice(0,100)||provider,source:origin});};
 for(const item of layers){
  if(!selected){const value=config(item.layer.get('agent-default-model'));if(value){selected=selection(value);source=item.source;}}
  const adapter=config(item.layer.get('llm-pi-ai'));
  for(const [provider,value] of Object.entries(adapter?.providers||{})){
   if(providers.has(provider))continue;providers.add(provider);
   for(const model of Array.isArray(value?.models)?value.models:[])add(provider,typeof model==='string'?model:model?.id,model?.name,value.displayName,item.source);
  }
 }
 if(selected&&!models.has(selected.provider+'/'+selected.model))add(selected.provider,selected.model,selected.model,selected.provider,source);
 return {models:[...models.values()],default_model:selected?selected.provider+'/'+selected.model:null,source};
}
function config(record){
 if(!record||record.disabled||!record.node)return null;
 if(dynamic(record.node))fail('DSH 模型配置包含动态表达式或别名，无法安全复用；请改为明确的模型配置');
 return record.node.toJSON();
}
function selection(value){
 if(!value)return null;
 if(typeof value.provider!=='string'||!value.provider.trim()||typeof value.model!=='string'||!value.model.trim())fail('DSH 默认模型缺少 provider 或 model');
 return {provider:value.provider,model:value.model,...typeof value.reasoningEffort==='string'?{reasoningEffort:value.reasoningEffort}:{}};
}
export function resolveDshModel(route,{home=process.env.DSH_HOME||join(homedir(),'.dsh')}={}){
 // Read only model declarations. Never boot/copy Desktop plugins or read credentials.
 const desktop=readLayer(join(home,'profiles','desktop','cordis.patch.yml')),
  headless=readLayer(join(home,'profiles','headless','cordis.patch.yml')),
  shared=readLayer(join(home,'cordis.patch.yml'));
 const value=(layer,id)=>config(layer.get(id));
 let chosen,source='headless 默认值';
 if(route.model){const split=route.model.indexOf('/');chosen=selection({provider:split<0?'deepseek-official':route.model.slice(0,split),model:split<0?route.model:route.model.slice(split+1)});source='功能设置';}
 else for(const [layer,label] of [[shared,'DSH 全局设置'],[headless,'headless'],[desktop,'Desktop']]){const candidate=value(layer,'agent-default-model');if(candidate){chosen=selection(candidate);source=label;break;}}
 if(!chosen)return {selection:null,adapterPatches:[],source};
 const adapterPatches=[];
 if(chosen.provider==='deepseek-official'){
  for(const layer of [shared,headless,desktop]){const adapter=value(layer,'llm-deepseek');if(adapter){adapterPatches.push({id:'llm-deepseek',disabled:false,config:adapter});break;}}
 }else{
  for(const layer of [shared,headless,desktop]){const adapter=value(layer,'llm-pi-ai');if(adapter?.providers?.[chosen.provider]){adapterPatches.push({id:'llm-pi-ai',disabled:false,config:{providers:{[chosen.provider]:adapter.providers[chosen.provider]}}});break;}}
 }
 return {selection:chosen,adapterPatches,source};
}

export function dshFailure(event){
 if(event?.type==='error'&&/unknown option ['"]--session-id/.test(String(event.message||'')))return '当前 DSH 版本不支持持续会话恢复，请更新本机 DSH 后重试';
 if(event?.type==='error'&&/session.*(?:does not exist|recorded in|cannot be adopted)|corrupt session|SESSION_QUERY/i.test(String(event.message||'')))return 'DSH 会话无法恢复，请在模型与分工中检查会话，或从检查点恢复';
 const code=event?.type==='status'&&event.phase==='turn_end'&&event.reason?.kind==='error'?event.reason.error?.code:event?.type==='error'?String(event.message||'').match(/\b(MISSING_CREDENTIAL|INSUFFICIENT_BALANCE|UNAUTHORIZED|AUTHENTICATION_ERROR|MODEL_NOT_FOUND|RATE_LIMITED)\b/)?.[1]:null;
 return ({MISSING_CREDENTIAL:'DSH 所选服务商缺少可用凭据，请在 DSH 的模型设置中配置对应 API Key',INSUFFICIENT_BALANCE:'DSH 模型服务商余额不足，请检查对应账号后重试',UNAUTHORIZED:'DSH 模型服务商拒绝认证，请检查 DSH 中的凭据',AUTHENTICATION_ERROR:'DSH 模型服务商认证失败，请检查 DSH 中的凭据',MODEL_NOT_FOUND:'DSH 所选模型不存在，请检查服务商和模型名称',RATE_LIMITED:'DSH 模型服务商请求受限，请稍后重试'})[code]||'';
}
