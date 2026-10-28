import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {discoverDshModelPlugins} from '../server/dsh-provider-plugins.mjs';
import {createDshModelDirectory} from '../server/dsh-model-directory.mjs';
import {inspectRegistry,seedPublicModelCatalogs} from '../scripts/dsh-model-registry.mjs';
import {dshPatch} from '../server/dsh-host.mjs';
function home(t){const dir=mkdtempSync(join(tmpdir(),'teacher-registry-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function plugin(home,{id='llm-example',name='example-provider',source="export const inject=['llm']; export function apply(){}",config={}}={}){
 const profile=join(home,'profiles','desktop'),root=join(profile,'node_modules',name);mkdirSync(root,{recursive:true});
 writeFileSync(join(profile,'package.json'),JSON.stringify({dsh:{profile:{bundles:[name]}}}));
 writeFileSync(join(root,'package.json'),JSON.stringify({name,type:'module',main:'index.mjs',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
 writeFileSync(join(root,'index.mjs'),source);writeFileSync(join(root,'cordis.patch.yml'),JSON.stringify([{insert:[{id,name,config}]}]));return {profile,root};
}
test('model plugins are discovered from installed bundles, without a Qoder allowlist; overrides and disable are honored',t=>{
 const dir=home(t),{profile}=plugin(dir,{id:'llm-another-vendor',name:'@sample/another-vendor',config:{enabledRegions:{local:true},private:'never-return'}});
 let result=discoverDshModelPlugins(dir);assert.equal(result.plugins[0].id,'llm-another-vendor');assert.match(result.plugins[0].entry,/another-vendor/);
 const first=result.fingerprint;writeFileSync(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'llm-another-vendor',config:{enabledRegions:{local:false}}}]));
 result=discoverDshModelPlugins(dir);assert.notEqual(result.fingerprint,first);assert.equal(result.plugins[0].config.enabledRegions.local,false);
 writeFileSync(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'llm-another-vendor',disabled:true}]));result=discoverDshModelPlugins(dir);assert.equal(result.plugins.length,0);assert.equal(result.diagnostics[0].code,'DISABLED');
});
test('runtime catalog preserves provider/model identity, exposes safe metadata, coalesces reads and refreshes on plugin changes',async t=>{
 const dir=home(t),{profile}=plugin(dir);let probes=0;
 const directory=createDshModelDirectory({home:dir,detect:async()=>({found:true,executable:'test'}),probe:async()=>{probes++;await new Promise(r=>setTimeout(r,10));return {providers:[{id:'new-provider',owner:'llm-example'}],models:[{provider:'new-provider',model:'smart/auto',name:'Auto',provider_name:'Example',owner:'llm-example',apiKey:'must-not-leak'}],diagnostics:[]};}});t.after(()=>directory.close());
 const [a,b]=await Promise.all([directory.refresh(),directory.refresh()]);assert.equal(probes,1);assert.deepEqual(a,b);assert.equal(a.models[0].id,'new-provider/smart/auto');assert.ok(!JSON.stringify(a).includes('must-not-leak'));
 await directory.refresh();assert.equal(probes,1);
 const resolved=await directory.resolve({model:'new-provider/smart/auto'});assert.equal(resolved.registry.plugins.length,1);assert.equal(resolved.registry.plugins[0].id,'llm-example');
 const patch=dshPatch({model:'new-provider/smart/auto'},{bridge:'test',modelConfig:resolved});assert.ok(patch.some(r=>r.id==='headless-runner'&&r.inject.includes('teacherModelReady')));
 writeFileSync(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'llm-example',disabled:true}]));await assert.rejects(directory.resolve({model:'new-provider/smart/auto'}),/插件已改变/);assert.equal(probes,2);
});
test('unavailable registries never masquerade as a complete cached directory or allow a stale execution route',async t=>{
 const dir=home(t);plugin(dir);let broken=false;
 const directory=createDshModelDirectory({home:dir,detect:async()=>({found:true}),probe:async()=>{if(broken)throw Error('probe unavailable');return {models:[{provider:'p',model:'one',owner:'llm-example'}]};}});t.after(()=>directory.close());
 await directory.refresh();broken=true;const result=await directory.refresh({force:true});assert.equal(result.discovery,'unavailable');assert.equal(result.error,'probe unavailable');assert.equal(directory.snapshot().error,'probe unavailable');await assert.rejects(directory.resolve({model:'p/one'}),/probe unavailable/);
});
test('the registry observes dynamic provider registrations and model filters; failures are explicit and redacted',async t=>{
 const dir=home(t),ok=join(dir,'ok.mjs'),bad=join(dir,'bad.mjs'),other=join(dir,'other.mjs');
 writeFileSync(ok,"export const inject=['llm']; export function apply(ctx){ctx.llm.rows.push({id:'qoder-like',name:'Dynamic'});}");
 writeFileSync(bad,"export const inject=['llm']; export function apply(){throw Error('private-token');}");
 writeFileSync(other,"export const inject=['llm','webServer']; export function apply(){throw Error('must not boot');}");
 const llm={rows:[],listProviders(){return this.rows;},async listModels(id){return [{provider:id,id:'Only-enabled-model',name:'Filtered'}];}};
 const ctx={llm,async plugin(mod){await mod.apply(this);return {dispose(){}};}};
 const result=await inspectRegistry(ctx,[{id:'dynamic',entry:pathToFileURL(ok).href},{id:'broken',entry:pathToFileURL(bad).href},{id:'web-only',entry:pathToFileURL(other).href}]);
 assert.equal(result.models[0].model,'Only-enabled-model');assert.equal(result.models[0].owner,'dynamic');assert.equal(result.diagnostics.length,2);assert.ok(!JSON.stringify(result).includes('private-token'));assert.equal(result.diagnostics[1].code,'UNSUPPORTED_DEPENDENCIES');
});
test('a profile changing during discovery cannot bind a model to the wrong execution plugin',async t=>{
 const dir=home(t),{profile}=plugin(dir);const directory=createDshModelDirectory({home:dir,detect:async()=>({found:true}),probe:async()=>{writeFileSync(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'llm-example',disabled:true}]));return {models:[{provider:'p',model:'one',owner:'llm-example'}]};}});t.after(()=>directory.close());
 const result=await directory.refresh();assert.equal(result.discovery,'unavailable');assert.match(result.error,/配置已变化/);assert.ok(!result.models.some(m=>m.id==='p/one'));
});
test('cold Qoder starts reuse public model metadata, omit secrets and preserve a fresher runtime cache',t=>{
 const source=home(t),target=home(t),file='.qoder-catalog.qoder.json';writeFileSync(join(source,file),JSON.stringify({version:1,fetchedAt:100,apiKey:'secret-top',entries:[{id:'Auto',key:'auto',name:'Auto',apiKey:'secret-entry',contextOptions:[200000],effortLevels:[]}]}));
 seedPublicModelCatalogs(source,target,[{id:'llm-qoder'}]);const result=JSON.parse(readFileSync(join(target,file),'utf8'));assert.equal(result.entries[0].id,'Auto');assert.ok(!JSON.stringify(result).includes('secret'));
 writeFileSync(join(target,file),JSON.stringify({version:1,fetchedAt:200,entries:[]}));seedPublicModelCatalogs(source,target,[{id:'llm-qoder'}]);assert.equal(JSON.parse(readFileSync(join(target,file),'utf8')).fetchedAt,200);
});
