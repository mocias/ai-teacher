import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {join,dirname,delimiter,isAbsolute,resolve} from 'node:path';
import {dshCommand} from './dsh-host.mjs';

const runFile=promisify(execFile);
// Fixed, read-only query; no caller data is interpolated into PowerShell code.
const windowsQuery=String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'SilentlyContinue'
$roots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
$installed = @(Get-ItemProperty -Path $roots | Where-Object { $_.DisplayName -match '(?i)deepseek[ -]?harness|^dsh([ -]|$)' } | Select-Object InstallLocation, DisplayIcon, UninstallString)
$running = @(Get-Process -Name 'DeepSeek Harness','dsh' | Select-Object -ExpandProperty Path)
$shortcutRoots = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'), [Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('CommonDesktopDirectory')) | Where-Object { $_ }
$links = @(Get-ChildItem -LiteralPath $shortcutRoots -Filter '*.lnk' -File -Recurse | Where-Object { $_.BaseName -match '(?i)deepseek[ -]?harness|^dsh$' })
$targets = @()
if ($links.Count -gt 0) {
 $wsh = New-Object -ComObject WScript.Shell
 $targets = @($links | ForEach-Object { $wsh.CreateShortcut($_.FullName).TargetPath })
}
@{ installed=$installed; running=$running; shortcuts=$targets } | ConvertTo-Json -Compress -Depth 4
`;

export function windowsDshCandidates(data={}){
 const rows=[],add=(path,source)=>{if(typeof path==='string'&&path.trim())rows.push({executable:path.trim(),source});};
 for(const entry of data.installed||[]){
  if(entry.InstallLocation)add(join(entry.InstallLocation.replace(/^"|"$/g,''),'DeepSeek Harness.exe'),'Windows 安装记录');
  if(entry.DisplayIcon)add(entry.DisplayIcon.replace(/,\s*-?\d+\s*$/,'').replace(/^"|"$/g,''),'Windows 安装记录');
  const uninstall=entry.UninstallString?.match(/^"([^"]+)"|^(.+?\.exe)(?:\s|$)/i);
  if(uninstall)add(join(dirname(uninstall[1]||uninstall[2]),'DeepSeek Harness.exe'),'Windows 安装记录');
 }
 for(const path of data.running||[])add(path,'运行中的 DSH');
 for(const path of data.shortcuts||[])add(path,'开始菜单或桌面快捷方式');
 return rows;
}

async function readWindowsCandidates(run,env){
 const powershell=join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const result=await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',windowsQuery],{windowsHide:true,encoding:'utf8',timeout:8000,maxBuffer:512_000});
 return windowsDshCandidates(JSON.parse(result.stdout.replace(/^\uFEFF/,'').trim()));
}

export async function discoverDsh({env=process.env,platform=process.platform,exists=existsSync,run=runFile,windowsCandidates=()=>readWindowsCandidates(run,env)}={}){
 const deadline=Date.now()+15_000;
 const candidates=[],add=(executable,source)=>{if(executable)candidates.push({executable,source});};
 add(env.TEACHER_DSH_EXECUTABLE,'环境变量');
 for(const dir of (env.PATH||env.Path||'').split(delimiter).map(value=>value.trim().replace(/^"|"$/g,'')).filter(Boolean)){
  for(const file of platform==='win32'?['dsh.exe','dsh.cmd']:['dsh'])add(join(dir,file),'PATH');
 }
 if(platform==='win32'){
  add(env.DSH_DESKTOP_NODE_EXECUTABLE,'DSH 运行环境');
  for(const dir of [env.APPDATA&&join(env.APPDATA,'npm'),env.LOCALAPPDATA&&join(env.LOCALAPPDATA,'pnpm'),env.USERPROFILE&&join(env.USERPROFILE,'.local','bin')].filter(Boolean)){
   add(join(dir,'dsh.cmd'),'用户 CLI 安装目录');add(join(dir,'dsh.exe'),'用户 CLI 安装目录');
  }
  for(const root of [env.LOCALAPPDATA&&join(env.LOCALAPPDATA,'Programs'),env.ProgramFiles,env['ProgramFiles(x86)']].filter(Boolean))add(join(root,'DeepSeek Harness','DeepSeek Harness.exe'),'常用安装目录');
  try{candidates.push(...await windowsCandidates());}catch{/* PATH and standard installs still work when system inventory is unavailable. */}
 }
 const seen=new Set();
 for(const candidate of candidates){
  if(Date.now()>=deadline)break;
  if(typeof candidate.executable!=='string'||!isAbsolute(candidate.executable))continue;
  const executable=resolve(candidate.executable),key=platform==='win32'?executable.toLowerCase():executable;
  if(seen.has(key)||!exists(executable))continue;seen.add(key);
  try{
   const launch=dshCommand(executable,{env,platform,exists});
   const result=await run(launch.command,[...launch.args,'--version'],{env:{...env,...launch.env},windowsHide:true,encoding:'utf8',timeout:Math.max(1,Math.min(5000,deadline-Date.now())),maxBuffer:64_000});
   const version=result.stdout.trim().match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\s|$)/)?.[1];
   if(!version)continue;
   return {found:true,executable,source:candidate.source,version,message:'已检测到本机 DSH'};
  }catch{/* Skip stale registrations and broken launchers; try the next installation. */}
 }
 return {found:false,executable:'',version:'',source:'',message:'未检测到可用的 DSH，请安装后重新检测，或手动指定路径'};
}

export function createDshDetector({ttlMs=30_000,discover=discoverDsh,exists=existsSync}={}){
 let cached,checkedAt=0,pending;
 return async function detect({refresh=false}={}){
  if(pending)return pending;
  if(!refresh&&cached&&Date.now()-checkedAt<ttlMs&&(!cached.found||exists(cached.executable)))return cached;
  pending=discover().then(result=>{cached=result;checkedAt=Date.now();return result;}).finally(()=>{pending=null;});
  return pending;
 };
}
