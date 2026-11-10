// An isolated installed-DSH capability check. It sends one generic public query,
// never learning messages/documents; output includes only status and public URLs.
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {discoverDsh} from '../server/dsh-discovery.mjs';
import {dshCommand,dshDisabledPlugins} from '../server/dsh-host.mjs';
import {resolveDshWeb} from '../server/dsh-model.mjs';
import {teacherSearchPatches} from '../server/search-config.mjs';
import {dshNetwork} from '../server/dsh-network.mjs';
import assert from 'node:assert/strict';

const dir=mkdtempSync(join(tmpdir(),'teacher-public-search-')),home=process.env.DSH_HOME||join(homedir(),'.dsh'),failureCheck=process.argv.includes('--tool-failure');
try{
 const host=await discoverDsh();assert.ok(host.found,'DSH is installed');
 const check=join(dir,'check.mjs');
 const operation=failureCheck?`const signal=AbortSignal.timeout(5000),toolSet=await ctx.tools.resolve({modelSelection:{provider:'qoder-cn',model:'test-only'},signal});const batch=await ctx.tools.execute({toolSet,calls:[{type:'tool-call',id:'public-search-error-check',name:'web_search',arguments:JSON.stringify({queries:['x'.repeat(2001)]})}],signal});toolSet.dispose();const result=batch.results[0].result;report.toolFailed=result.isError;report.code=result.error?.info?.code;report.errorName=result.error?.info?.name;report.failureCodePreserved=result.isError&&report.code==='WEB_SEARCH_QUERY_INVALID';`:`const result=await ctx.web.search({query:report.query,maxResults:3},AbortSignal.timeout(25000));report.searchOk=result.sources.length>0;report.sources=result.sources.map(s=>({url:s.url,title:s.title}));report.truncated=result.truncated;`;
 writeFileSync(check,`export const inject=['web','tools'];export function apply(ctx){(async()=>{await new Promise(r=>setTimeout(r,250));const report={type:'teacher_public_search_check',checkedAt:new Date().toISOString(),query:'Python official documentation',searchTool:!!ctx.tools.get('web_search'),selected:ctx.web.selectSearchProvider().id,proxyConfigured:!!(process.env.HTTPS_PROXY||process.env.HTTP_PROXY)};try{${operation}}catch(e){report.searchOk=false;report.code=/^[A-Z_]+$/.test(e.code||'')?e.code:'REQUEST_FAILED';report.failedTool=String(e.message).match(/tool .([a-z_]+)./i)?.[1];}process.stdout.write(JSON.stringify(report)+'\\n');ctx.get('appExit')(report.searchOk||report.failureCodePreserved?0:1);})().catch(()=>ctx.get('appExit')(1));}`);
 // Error mode disables native providers in this disposable runtime only, so an
 // oversize generic fixture deterministically exercises our adapter with no
 // network request, account/model use, or real CAPTCHA.
 const webRows=failureCheck?teacherSearchPatches([],{env:{}}):teacherSearchPatches(resolveDshWeb({home}));
 const patch=[...dshDisabledPlugins.map(id=>({id,disabled:true})),{id:'headless-runner',disabled:true},{id:'headless-startup',disabled:true},{id:'credentials',config:{path:join(home,'.credentials.yaml'),dshHome:home,watch:false}},...webRows,...failureCheck?[{id:'web-search-deepseek',disabled:true},{id:'web-deepseek-api',disabled:true}]:[],{id:'tool-web',disabled:false,config:{search:true,fetch:true}},{insert:[{id:'teacher-public-search-check',name:pathToFileURL(check).href}]}];
 const file=join(dir,'patch.json');writeFileSync(file,JSON.stringify(patch),{mode:0o600});
 const network=dshNetwork(process.env.TEACHER_DATA_DIR||join(process.env.APPDATA||homedir(),'AI Teacher','data')).env(),launch=dshCommand(host.executable);
 const report=await new Promise((resolve,reject)=>{
  let found,buffer='';const child=spawn(launch.command,[...launch.args,'--profile','headless','--patch',file],{cwd:dir,env:{...process.env,...launch.env,...network,DSH_HOME:join(dir,'home'),DSH_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>child.kill(),45000);
  child.stderr.on('data',()=>{});child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>1_000_000){child.kill();return;}let end;while((end=buffer.indexOf('\n'))>=0){try{const value=JSON.parse(buffer.slice(0,end));if(value.type==='teacher_public_search_check')found=value;}catch{}buffer=buffer.slice(end+1);}});
  child.once('error',()=>reject(Error('Cannot launch installed DSH')));child.once('close',()=>{clearTimeout(timer);found?resolve(found):reject(Error('Installed DSH search check did not complete'));});
 });
 mkdirSync('outputs',{recursive:true});writeFileSync(failureCheck?'outputs/teacher-public-search-tool-failure.json':'outputs/teacher-public-search-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));assert.ok(report.searchTool&&(failureCheck?report.failureCodePreserved:report.searchOk));
}finally{rmSync(dir,{recursive:true,force:true});}
