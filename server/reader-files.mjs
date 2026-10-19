import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const pending=new Map();
let conversion=Promise.resolve();
export async function readerFile(store,id){
 const file=store.db.prepare('SELECT * FROM resource_files WHERE resource_id=?').get(id);
 if(!file)throw Error('本地文件不存在');
 const ext=extname(file.name).toLowerCase();
 if(['.md','.markdown'].includes(ext))return {type:'text/plain; charset=utf-8',bytes:Buffer.from(file.content)};
 if(ext==='.pdf')return {type:'application/pdf',bytes:Buffer.from(file.content)};
 if(!['.ppt','.pptx'].includes(ext))throw Error('阅读器支持 PDF、Markdown、PPT 和 PPTX');
 store.db.exec('CREATE TABLE IF NOT EXISTS reading_pdf(resource_id TEXT PRIMARY KEY REFERENCES resources(id),content BLOB NOT NULL)');
 const old=store.db.prepare('SELECT content FROM reading_pdf WHERE resource_id=?').get(id);if(old)return {type:'application/pdf',bytes:Buffer.from(old.content)};
 const key=store+':'+id;if(pending.has(key))return pending.get(key);
 const task=conversion.catch(()=>{}).then(async()=>{
  const dir=await mkdtemp(join(tmpdir(),'teacher-ppt-')),input=join(dir,'slides'+ext),output=join(dir,'slides.pdf');
  try{await writeFile(input,Buffer.from(file.content));await new Promise((resolve,reject)=>{
   const useOffice=process.platform==='win32'&&!process.env.TEACHER_SOFFICE;
   const cmd=useOffice?'powershell.exe':process.env.TEACHER_SOFFICE||'soffice';
   const args=useOffice?['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../desktop/convert-ppt.ps1',import.meta.url))]:['-env:UserInstallation=file:///'+join(dir,'office-profile').replaceAll('\\','/'),'--headless','--convert-to','pdf','--outdir',dir,input];
   const child=spawn(cmd,args,{windowsHide:true,stdio:'ignore',env:{...process.env,TEACHER_PPT_INPUT:input,TEACHER_PPT_OUTPUT:output}});
   const timer=setTimeout(()=>{child.kill();reject(Error('幻灯片转换超时，请检查是否有 Office 对话框等待处理'));},90000);
   child.once('error',()=>{clearTimeout(timer);reject(Error('PPT 阅读需要 Microsoft PowerPoint，或通过 TEACHER_SOFFICE 配置 LibreOffice'));});
   child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('无法转换幻灯片，请检查本机 PowerPoint 或 LibreOffice 是否可用'));});
  });const bytes=await readFile(output);if(bytes.length>100*1024*1024)throw Error('转换后的 PDF 超过 100 MB');store.db.prepare('INSERT OR REPLACE INTO reading_pdf VALUES(?,?)').run(id,bytes);return {type:'application/pdf',bytes};
  }finally{await rm(dir,{recursive:true,force:true});}
 });conversion=task;pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
