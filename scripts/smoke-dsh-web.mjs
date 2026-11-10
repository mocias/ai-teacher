// Real installed DSH web tools, isolated from learning conversations. One public
// documentation search/fetch; never print credentials or raw provider errors.
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {discoverDsh} from '../server/dsh-discovery.mjs';
import {dshCommand,dshPatch} from '../server/dsh-host.mjs';
import assert from 'node:assert/strict';
const root=mkdtempSync(join(tmpdir(),'teacher-web-check-')),home=process.env.DSH_HOME||join(homedir(),'.dsh');
try{
 const host=await discoverDsh();assert.ok(host.found);const check=join(root,'check.mjs');
 writeFileSync(check,`export const inject=['web','tools'];export function apply(ctx){(async()=>{await new Promise(r=>setTimeout(r,100));const out={type:'teacher_web_check',searchTool:!!ctx.tools.get('web_search'),fetchTool:!!ctx.tools.get('web_fetch')};try{const result=await ctx.web.search({query:'Python official documentation',maxResults:2},AbortSignal.timeout(20000));out.searchOk=true;out.sourceCount=result.sources?.length||0;}catch(e){out.searchOk=false;out.searchCode=/^[A-Z_]+$/.test(e.code||'')?e.code:'REQUEST_FAILED';}try{const result=await ctx.web.fetch({url:'https://docs.python.org/3/'},AbortSignal.timeout(20000));out.fetchOk=result.status===undefined||result.status>=200&&result.status<300;}catch(e){out.fetchOk=false;out.fetchCode=/^[A-Z_]+$/.test(e.code||'')?e.code:'REQUEST_FAILED';}process.stdout.write(JSON.stringify(out)+'\\n');ctx.get('appExit')(0);})().catch(()=>ctx.get('appExit')(1));}`);
 const patch=dshPatch({model:''},{bridge:'unused',sourceHome:home,session:{logs:join(root,'logs')},baseUrl:'http://127.0.0.1:9',token:'unused'}).filter(row=>!row.insert?.some(p=>p.id==='mcp-teacher-job'));
 patch.push({id:'headless-runner',disabled:true},{id:'headless-startup',disabled:true},{insert:[{id:'teacher-web-check',name:pathToFileURL(check).href}]});const file=join(root,'web.json');writeFileSync(file,JSON.stringify(patch));const launch=dshCommand(host.executable);
 const report=await new Promise((resolve,reject)=>{let found,buffer='';const child=spawn(launch.command,[...launch.args,'--profile','headless','--patch',file],{cwd:root,env:{...process.env,...launch.env,DSH_HOME:join(root,'home'),DSH_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>child.kill(),50000);child.stderr.on('data',()=>{});child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){try{const row=JSON.parse(buffer.slice(0,n));if(row.type==='teacher_web_check')found=row;}catch{}buffer=buffer.slice(n+1);}});child.once('error',reject);child.once('close',code=>{clearTimeout(timer);if(code!==0||!found)reject(Error('DSH web verification did not complete'));else resolve(found);});});
 mkdirSync('outputs',{recursive:true});writeFileSync('outputs/dsh-web-live-v0143.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));assert.ok(report.searchTool&&report.fetchTool);
}finally{rmSync(root,{recursive:true,force:true});}
