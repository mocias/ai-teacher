// Explicit live check: uses the local Codex login and its account quota.
// Data is isolated; never writes demonstration goals into the user's database.
import {spawn} from 'node:child_process';
import {startServer} from '../server/index.mjs';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'teacher-live-host-'));
const app=startServer({port:0,dataDir:dir,hostOptions:{intervalMs:100,spawnProcess:(...args)=>{const c=spawn(...args);if(process.env.TEACHER_SMOKE_DEBUG){c.stdout.on('data',d=>process.stdout.write(d));c.stderr.on('data',d=>process.stderr.write(d));}return c;}}});
await once(app.server,'listening');
const url='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(url)).headers.get('set-cookie').split(';')[0];
async function post(path,a){const r=await fetch(url+'/api/'+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(a)});const result=await r.json();if(!r.ok)throw new Error(result.error);return result;}
async function waitFor(job){const end=Date.now()+180000;while(Date.now()<end){const j=app.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(job),r=app.store.db.prepare('SELECT status,error,tool_calls FROM host_runs WHERE job_id=? ORDER BY rowid DESC LIMIT 1').get(job);if(r?.status==='FAILED')throw new Error(r.error);if(j.status==='COMPLETED'&&r?.status==='COMPLETED'){if(!r.tool_calls)throw new Error('Expected explicit MCP writeback');return r;}await new Promise(r=>setTimeout(r,200));}throw new Error('Live check timed out');}
try{
 console.log('Login:',JSON.stringify(await app.hostDriver.check()));
 await post('host/settings',{enabled:true,timeout_seconds:180});
 const {conversation}=await post('goals',{title:'自动唤醒隔离验证',domain:'测试'});
 for(let turn=1;turn<=2;turn++){
  const sent=await post('messages',{conversation_id:conversation.id,content:`这是第 ${turn} 条自动唤醒测试。请读取上下文，然后调用 teacher_reply，仅回复“第 ${turn} 轮自动唤醒成功”。不需要其他教学操作。`,request_id:randomUUID()});
  const result=await waitFor(sent.job_id);console.log(JSON.stringify({turn,...result,reply:app.store.messages(conversation.id).at(-1).content}));
 }
}finally{await app.hostDriver.stop();app.close();await once(app.server,'close');}
