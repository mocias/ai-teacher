import {packager} from '@electron/packager';
import {mkdirSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {generateLicenses} from './generate-licenses.mjs';
await generateLicenses();
// Bundle a real Node runtime so SQLite and Codex's stdio adapter use the same runtime.
mkdirSync('runtime',{recursive:true});copyFileSync(process.execPath,'runtime/node.exe');
copyFileSync('licenses/Node-LICENSE.txt','runtime/Node-LICENSE.txt');
const allowed=new Set(['desktop','server','public','scripts','docs','runtime','node_modules','package.json','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','licenses']);
const paths=await packager({dir:'.',out:'dist',name:'AI Teacher',platform:'win32',arch:'x64',asar:false,overwrite:true,ignore:path=>{
 const relative=path.replace(/^[\\/]/,'').replaceAll('\\','/'),[top]=relative.split('/');
 if(top==='scripts')return relative!=='scripts'&&relative!=='scripts/host-mcp.mjs';
 if(top==='docs')return relative!=='docs'&&!['docs/openapi.json','docs/DESKTOP.md'].includes(relative);
 return !!top&&!allowed.has(top);
}});
console.log('Desktop application:',paths.map(p=>resolve(p)).join('\n'));
