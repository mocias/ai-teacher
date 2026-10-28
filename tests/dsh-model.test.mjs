import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {resolveDshModel,readDshCatalog,dshFailure} from '../server/dsh-model.mjs';
function home(t){const dir=mkdtempSync(join(tmpdir(),'teacher-dsh-model-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function patch(dir,profile,rows){const folder=profile?join(dir,'profiles',profile):dir;mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'cordis.patch.yml'),JSON.stringify(rows));}
const desktop=[{id:'agent-default-model',config:{provider:'campus',model:'study-model',reasoningEffort:'high'}},{id:'llm-pi-ai',config:{providers:{campus:{apiKeyEnv:'CAMPUS_API_KEY',api:'openai-completions',baseURL:'https://example.test/v1',models:[{id:'study-model'}]},unrelated:{apiKeyEnv:'OTHER_KEY'}}}},{id:'arbitrary-plugin',name:'some-desktop-ui',config:{secret:'must-not-copy'}}];
test('empty model inherits the actual Desktop selection and only that provider, not UI or other plugins',t=>{
 const dir=home(t);patch(dir,'desktop',desktop);patch(dir,'headless',[]);
 const result=resolveDshModel({model:''},{home:dir});
 assert.deepEqual(result.selection,{provider:'campus',model:'study-model',reasoningEffort:'high'});
 assert.equal(result.source,'Desktop');assert.equal(result.adapterPatches.length,1);
 assert.deepEqual(Object.keys(result.adapterPatches[0].config.providers),['campus']);
 assert.ok(!JSON.stringify(result).includes('must-not-copy'));assert.ok(!JSON.stringify(result).includes('OTHER_KEY'));
});
test('explicit model and headless settings take priority; credential files are never read',t=>{
 const dir=home(t);patch(dir,'desktop',desktop);patch(dir,'headless',[{id:'agent-default-model',config:{provider:'campus',model:'headless-model'}}]);
 writeFileSync(join(dir,'.credentials.yaml'),'unparseable secret: [');
 assert.equal(resolveDshModel({model:''},{home:dir}).selection.model,'headless-model');
 const explicit=resolveDshModel({model:'campus/override'},{home:dir});assert.deepEqual(explicit.selection,{provider:'campus',model:'override'});assert.equal(explicit.source,'功能设置');
 assert.deepEqual(resolveDshModel({model:'deepseek-flash'},{home:dir}).selection,{provider:'deepseek-official',model:'deepseek-flash'});
});
test('empty installations keep the shipped defaults; common overrides apply without executing YAML expressions',t=>{
 const dir=home(t);assert.equal(resolveDshModel({model:''},{home:dir}).selection,null);
 patch(dir,'desktop',desktop);patch(dir,null,[{id:'agent-default-model',config:{provider:'campus',model:'shared'}}]);
 assert.equal(resolveDshModel({model:''},{home:dir}).selection.model,'shared');
 writeFileSync(join(dir,'cordis.patch.yml'),'- id: unrelated\n  config:\n    value: !!js process.exit(99)\n');
 assert.equal(resolveDshModel({model:''},{home:dir}).selection.model,'study-model');
 writeFileSync(join(dir,'cordis.patch.yml'),'- id: agent-default-model\n  config:\n    provider: campus\n    model: !!js process.exit(99)\n');
 assert.throws(()=>resolveDshModel({model:''},{home:dir}),/动态表达式/);
});
test('DSH failures expose actionable static categories, never provider messages or credentials',()=>{
 const error={type:'status',phase:'turn_end',reason:{kind:'error',error:{code:'MISSING_CREDENTIAL',message:'secret-do-not-display'}}};
 const message=dshFailure(error);assert.match(message,/凭据/);assert.ok(!message.includes('secret-do-not-display'));
 assert.match(dshFailure({...error,reason:{kind:'error',error:{code:'INSUFFICIENT_BALANCE'}}}),/余额/);
 assert.equal(dshFailure({type:'text',text:'MISSING_CREDENTIAL'}),'');
});

test('catalog lists actual providers with slash-containing model IDs and no adapter secrets',t=>{
 const dir=home(t);patch(dir,'desktop',[...desktop,{id:'llm-pi-ai',config:{providers:{campus:{displayName:'校园',apiKey:'do-not-leak',apiKeyEnv:'SECRET_ENV',headers:{Authorization:'secret-header'},baseURL:'https://private.test',models:[{id:'smart/default',name:'自动'},{id:'second'}]},other:{models:[{id:'other-model'}]}}}}]);
 const result=readDshCatalog({home:dir});assert.ok(result.models.some(m=>m.id==='campus/smart/default'));assert.ok(result.models.some(m=>m.id==='campus/study-model'));
 assert.equal(result.default_model,'campus/study-model');assert.equal(result.source,'Desktop');
 for(const secret of ['do-not-leak','SECRET_ENV','secret-header','private.test'])assert.ok(!JSON.stringify(result).includes(secret));
 patch(dir,null,[{id:'llm-pi-ai',config:{providers:{campus:{models:[{id:'override'}]}}}}]);
 const overridden=readDshCatalog({home:dir});assert.ok(overridden.models.some(m=>m.id==='campus/override'));assert.ok(!overridden.models.some(m=>m.id==='campus/second'));assert.ok(overridden.models.some(m=>m.id==='other/other-model'));
});
