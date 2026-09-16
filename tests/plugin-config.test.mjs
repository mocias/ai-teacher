import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {configurePlugin} from '../scripts/configure-plugin.mjs';

test('host config is generated for a relocated root without rewriting portable templates',()=>{
 const root=mkdtempSync(join(tmpdir(),"teacher-config-中文 space'-"));
 mkdirSync(join(root,'plugins','ai-teacher'),{recursive:true});mkdirSync(join(root,'docs'));
 for(const file of ['plugins/ai-teacher/.mcp.template.json','docs/deepseek-harness.yaml'])copyFileSync(resolve(file),join(root,file));
 const before=readFileSync(join(root,'docs/deepseek-harness.yaml'),'utf8');
 const nodePath=join(root,"Node's runtime",'node.exe');
 const {pluginFile,harnessFile}=configurePlugin(root,nodePath);
 const config=JSON.parse(readFileSync(pluginFile,'utf8')).mcpServers['ai-teacher'];
 assert.equal(config.command,nodePath);assert.deepEqual(config.args,[join(root,'plugins','ai-teacher','scripts','mcp.mjs')]);
 const yaml=readFileSync(harnessFile,'utf8');assert.ok(yaml.includes(nodePath.replaceAll("'","''")));assert.ok(!yaml.includes('{{MCP_ENTRY}}'));
 assert.equal(readFileSync(join(root,'docs/deepseek-harness.yaml'),'utf8'),before);
});
