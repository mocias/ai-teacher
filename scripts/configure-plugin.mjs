import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function configurePlugin(root=fileURLToPath(new URL('../',import.meta.url)),command=process.execPath){
 root=resolve(root);
 const entry=join(root,'plugins','ai-teacher','scripts','mcp.mjs');
 const template=JSON.parse(readFileSync(join(root,'plugins','ai-teacher','.mcp.template.json'),'utf8'));
 const replacements={'{{NODE_EXECUTABLE}}':command,'{{MCP_ENTRY}}':entry};
 const config=JSON.parse(JSON.stringify(template),(_key,value)=>typeof value==='string'&&Object.hasOwn(replacements,value)?replacements[value]:value);
 const pluginFile=join(root,'plugins','ai-teacher','.mcp.json');
 const localDir=join(root,'.local');mkdirSync(localDir,{recursive:true});
 writeFileSync(pluginFile,JSON.stringify(config,null,2)+'\n');
 const yaml=readFileSync(join(root,'docs','deepseek-harness.yaml'),'utf8')
  .replaceAll('{{NODE_EXECUTABLE}}',command.replaceAll("'","''"))
  .replaceAll('{{MCP_ENTRY}}',entry.replaceAll("'","''"));
 const harnessFile=join(localDir,'deepseek-harness.yaml');writeFileSync(harnessFile,yaml);
 return {pluginFile,harnessFile};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const paths=configurePlugin();console.log('Generated machine-local configuration (excluded from Git):\n'+Object.values(paths).join('\n'));
}
