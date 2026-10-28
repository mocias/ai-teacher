import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname,delimiter,isAbsolute,resolve,extname} from 'node:path';

const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const cliEntry=root=>join(root,'resources','app.asar','dsh','node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js');

// Launch JS/npm and Desktop installations directly, without a shell or .cmd quoting.
export function dshCommand(configured='',{env=process.env,platform=process.platform,exists=existsSync}={}){
 let executable=configured||env.TEACHER_DSH_EXECUTABLE||'';
 if(!executable){
  const candidates=(env.PATH||env.Path||'').split(delimiter).filter(Boolean).flatMap(dir=>platform==='win32'?[join(dir,'dsh.exe'),join(dir,'dsh.cmd')]:[join(dir,'dsh')]);
  if(platform==='win32'){
   if(env.DSH_DESKTOP_NODE_EXECUTABLE)candidates.push(env.DSH_DESKTOP_NODE_EXECUTABLE);
   for(const root of [env.LOCALAPPDATA&&join(env.LOCALAPPDATA,'Programs'),env.ProgramFiles].filter(Boolean))candidates.push(join(root,'DeepSeek Harness','DeepSeek Harness.exe'));
  }
  executable=candidates.find(path=>exists(path))||'';
 }
 if(!executable)fail('未找到 DSH CLI；请填写 dsh 可执行文件、CLI 脚本或 DeepSeek Harness.exe 的绝对路径');
 if(!isAbsolute(executable)||!exists(executable))fail('配置的 DSH 可执行文件不存在或不是绝对路径');
 executable=resolve(executable);
 if(/\.cmd$/i.test(executable)){
  const npmEntry=join(dirname(executable),'node_modules','@deepseek-ai','dsh','lib','bin.js');
  if(exists(npmEntry))return {command:process.execPath,args:[npmEntry],env:{}};
  const desktop=resolve(dirname(executable),'../../../..','DeepSeek Harness.exe');
  if(exists(desktop))return {command:desktop,args:['--expose-internals',cliEntry(dirname(desktop))],env:{ELECTRON_RUN_AS_NODE:'1'}};
  fail('无法解析 DSH 启动脚本；请填写 CLI 的 bin.js 或 DeepSeek Harness.exe 路径');
 }
 if(/DeepSeek Harness\.exe$/i.test(executable))return {command:executable,args:['--expose-internals',cliEntry(dirname(executable))],env:{ELECTRON_RUN_AS_NODE:'1'}};
 if(['.js','.mjs','.cjs'].includes(extname(executable)))return {command:process.execPath,args:[executable],env:{}};
 return {command:executable,args:[],env:{}};
}

// JSON is valid YAML. Values never become executable !!js expressions.
// Only the bounded Teacher MCP tools are enabled for these one-shot jobs.
export const dshDisabledPlugins=['plan-mode','mcp-resources','tool-plugin-manager','tool-working-directory','tool-bash','tool-pwsh','tool-jobs','tool-fs','tool-fs-search','agent-instructions','skill-filesystem','tool-skill','tool-subagent-control','tool-subagent-list-agents','tool-subagent','tool-subagent-fork','tool-subagent-report','tool-workflow','tool-todo','tool-goal','tool-ralph','tool-str-replace-editor','tool-web','session-title-llm','config-editor','settings'];
export function dshPatch(route,{bridge,node=process.execPath,baseUrl,token,modelConfig,session,sourceHome}){
 const patch=dshDisabledPlugins.map(id=>({id,disabled:true}));
 patch.push({id:'tools',config:{mode:'native'}},{id:'credentials',disabled:false});
 if(session){patch.push({id:'credentials',disabled:false,config:{path:join(sourceHome,'.credentials.yaml'),dshHome:sourceHome,watch:false}},{id:'session-persistence-jsonl',config:{root:session.logs,compression:'none'}});}
 if(modelConfig?.selection){patch.push(...modelConfig.adapterPatches,{id:'agent-default-model',config:modelConfig.selection});}
 else if(route.model){
  const split=route.model.indexOf('/'),provider=split<0?'deepseek-official':route.model.slice(0,split),model=split<0?route.model:route.model.slice(split+1);
  if(!provider||!model)fail('DSH 模型请填写模型 ID 或 provider/model');
  patch.push({id:'agent-default-model',config:{provider,model}});
 }
 if(modelConfig?.registry){
  patch.push({insert:[{id:'teacher-model-registry',name:pathToFileURL(fileURLToPath(new URL('../scripts/dsh-model-registry.mjs',import.meta.url))).href,config:{mode:'execute',sourceHome,...modelConfig.registry}}]});
  patch.push({id:'headless-runner',inject:['headlessStartup','teacherModelReady']});
 }
 patch.push({insert:[{id:'teacher-reply-stream',name:pathToFileURL(fileURLToPath(new URL('../scripts/dsh-reply-stream.mjs',import.meta.url))).href}]});
 patch.push({insert:[{id:'mcp-teacher-job',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'teacher_job',transport:'stdio',command:node,args:[bridge],env:{TEACHER_HOST_URL:baseUrl,TEACHER_HOST_TOKEN:token},failOnStartupError:true,reconnect:{enabled:false},toolCallTimeoutMs:60000}}]});
 return patch;
}
