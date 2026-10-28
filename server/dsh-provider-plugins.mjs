import {readFileSync,existsSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseDocument,isSeq,isMap,isAlias} from 'yaml';

const dynamic=node=>!!node&&(isAlias(node)||node.tag==='tag:yaml.org,2002:js'||(node.items||[]).some(v=>dynamic(v?.key)||dynamic(v?.value)||dynamic(v)));
// Discover model plugins from the user's installed profile composition, not a
// provider-name allowlist. Do not import or boot Desktop UI/tool bundles here.
export function discoverDshModelPlugins(home){
 const rows=new Map(),diagnostics=[],hash=createHash('sha256');let configured=false;
 const read=file=>{const text=readFileSync(file,'utf8');hash.update(file).update(text);return text;};
 const report=(plugin,code)=>diagnostics.push({plugin:String(plugin).slice(0,150),code});
 function patch(file,req,owner,modelBundle=false){
  if(!existsSync(file))return;
  const doc=parseDocument(read(file),{logLevel:'silent'});if(doc.errors.length){report(owner,'INVALID_CONFIG');return;}
  function visit(seq,parentDisabled=false){if(!isSeq(seq))return;for(const row of seq.items){if(!isMap(row))continue;
   const id=row.get('id'),name=row.get('name'),disabled=parentDisabled||row.get('disabled')===true;
   const known=typeof id==='string'&&rows.has(id);let providerModule=false;
   if(modelBundle&&typeof name==='string')try{providerModule=/\bregisterAdapter\s*\(/.test(readFileSync(req.resolve(name),'utf8'));}catch{/* Non-model bundles can contain optional UI/agent entry aliases. */}
   const candidate=typeof id==='string'&&typeof name==='string'&&!name.startsWith('@deepseek-ai/')&&(id.startsWith('llm-')||providerModule);
   if(known||candidate){
    const before=rows.get(id)||{},node=row.get('config',true);let config=before.config||{},error=before.error;
    if(node){if(dynamic(node)){error='DYNAMIC_CONFIG';}else{const value=node.toJSON();if(value&&typeof value==='object'&&!Array.isArray(value)){config=value;error=null;}else error='INVALID_CONFIG';}}
    let entry=before.entry;
    if(candidate)try{entry=pathToFileURL(req.resolve(name)).href;const st=statSync(req.resolve(name));hash.update(String(st.mtimeMs)).update(String(st.size));}catch{error='PLUGIN_MISSING';}
    rows.set(id,{id,entry,config,disabled:row.has('disabled')||parentDisabled?disabled:before.disabled||false,error});
   }
   visit(row.get('insert',true),disabled);
  }}visit(doc.contents);
 }
 for(const profile of ['desktop','headless']){
  const root=join(home,'profiles',profile),manifest=join(root,'package.json');if(!existsSync(manifest))continue;configured=true;
  try{
   const pkg=JSON.parse(read(manifest)),req=createRequire(manifest),visited=new Set();
   function bundle(spec){if(typeof spec!=='string'||visited.has(spec)||visited.size>=100)return;visited.add(spec);
    // Built-in adapters are supplied by the headless base and queried at runtime.
    if(spec.startsWith('@deepseek-ai/'))return;
    try{let file;try{file=req.resolve(spec+'/package.json');}catch{const direct=join(root,'node_modules',spec,'package.json');if(existsSync(direct))file=direct;else throw Error('missing manifest');}const p=JSON.parse(read(file)),local=createRequire(file),isModel=!!(p.peerDependencies?.['@deepseek-ai/dsh-llm']||p.dependencies?.['@deepseek-ai/dsh-llm']);
     for(const child of p.dsh?.profile?.bundles||[])bundle(child);
     if(p.dsh?.bundle?.patch)patch(resolve(dirname(file),p.dsh.bundle.patch),local,spec,isModel);
    }catch{report(spec,'BUNDLE_UNREADABLE');}
   }
   for(const spec of pkg.dsh?.profile?.bundles||[])bundle(spec);
  }catch{report(profile,'INVALID_CONFIG');}
 }
 // Keep the existing model configuration precedence: shared > headless > Desktop.
 for(const profile of ['desktop','headless']){const root=join(home,'profiles',profile);patch(join(root,'cordis.patch.yml'),createRequire(join(root,'package.json')),profile);}
 patch(join(home,'cordis.patch.yml'),createRequire(join(home,'package.json')),'shared');
 const plugins=[];
 for(const row of rows.values()){
  if(row.disabled){report(row.id,'DISABLED');continue;}
  if(row.error||!row.entry){report(row.id,row.error||'PLUGIN_MISSING');continue;}
  plugins.push({id:row.id,entry:row.entry,config:row.config});
 }
 return {plugins,diagnostics,configured,fingerprint:hash.digest('hex')};
}
