import {packager} from '@electron/packager';
import {mkdirSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {generateLicenses} from './generate-licenses.mjs';
await generateLicenses();
// Bundle a real Node runtime so SQLite and Codex's stdio adapter use the same runtime.
mkdirSync('runtime',{recursive:true});copyFileSync(process.execPath,'runtime/node.exe');
copyFileSync('licenses/Node-LICENSE.txt','runtime/Node-LICENSE.txt');
const allowed=new Set(['desktop','server','public','scripts','docs','runtime','node_modules','package.json','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','licenses']);
const paths=await packager({dir:'.',out:process.env.TEACHER_PACKAGE_OUT||'dist',electronZipDir:process.env.TEACHER_ELECTRON_ZIP_DIR||undefined,name:'AI Teacher',platform:'win32',arch:'x64',asar:false,overwrite:true,ignore:path=>{
 const relative=path.replace(/^[\\/]/,'').replaceAll('\\','/'),[top]=relative.split('/');
 if(top==='scripts')return relative!=='scripts'&&relative!=='scripts/host-mcp.mjs'&&relative!=='scripts/agent-mcp.mjs'&&relative!=='scripts/harness-mcp.mjs'&&relative!=='scripts/dsh-reply-stream.mjs'&&relative!=='scripts/dsh-model-registry.mjs'&&relative!=='scripts/dsh-progress.mjs'&&relative!=='scripts/dsh-resident-model.mjs'&&relative!=='scripts/teacher-web-public.mjs';
 if(top==='docs')return relative!=='docs'&&!['docs/openapi.json','docs/DESKTOP.md','docs/LEARNING-LOOP-V05.md','docs/REVIEW-FOLLOWUPS-V06.md','docs/REMEDIATION-V07.md','docs/RECOVERY-V08.md','docs/DSH-HOST.md','docs/DSH-SESSIONS-V09.md','docs/UI-V010.md','docs/STREAMING-V011.md','docs/PERFORMANCE-V012.md','docs/DSH-MODELS-V013.md','docs/CHAT-UI-V014.md','docs/DSH-MODELS-V0141.md','docs/DIRECT-CONFIG-V0142.md','docs/FEEDBACK-WEB-V0143.md','docs/CANONICAL-V1-PROGRESS.md','docs/RELIABILITY-V0151.md','docs/GUIDED-PLANNING.md','docs/RUNTIME-V0180.md'].includes(relative);
 return !!top&&!allowed.has(top);
}});
console.log('Desktop application:',paths.map(p=>resolve(p)).join('\n'));
