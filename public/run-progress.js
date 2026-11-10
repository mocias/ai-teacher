import {readingPosition,restoreReadingPosition} from './chat-ui.js';
import {liveEvents as events} from './live-events.js';
const rows=new Map(),bindings=new Map();let queued=false;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const elapsed=(start,end=Date.now())=>{const seconds=Math.max(0,Math.floor((end-Date.parse(start))/1000));return seconds<60?seconds+' 秒':Math.floor(seconds/60)+' 分 '+seconds%60+' 秒';};
const toolList=row=>`<ol class="progress-tools">${row.tools.slice(-5).map(tool=>`<li class="${tool.status.toLowerCase()}"><span aria-hidden="true">${tool.status==='COMPLETED'?'✓':tool.status==='RUNNING'?'◌':'!'}</span><span>${esc(tool.label)}${tool.error?`<small>${esc(tool.error)}</small>`:''}</span><small>${tool.status==='RUNNING'?'执行中':tool.status==='COMPLETED'?'完成':tool.status==='CANCELLED'?'取消':'未完成'}</small></li>`).join('')}</ol>`;
function paint(){queued=false;for(const [container,cid] of bindings){if(!container.isConnected){bindings.delete(container);continue;}
 const position=readingPosition(container),latest=new Map();
 for(const row of rows.values())if(row.conversation_id===cid&&(!latest.has(row.job_id)||latest.get(row.job_id).revision<row.revision))latest.set(row.job_id,row);
 const keep=new Set();for(const row of [...latest.values()].slice(-8)){keep.add(row.run_id);let node=[...container.querySelectorAll('[data-run-progress]')].find(n=>n.dataset.runProgress===row.run_id);
  if(!node){node=document.createElement('article');node.className='run-progress-panel';node.dataset.runProgress=row.run_id;const anchor=[...container.querySelectorAll('[data-message-id]')].find(n=>n.dataset.messageId===row.reply_to);if(anchor)anchor.after(node);else container.append(node);}
  for(const old of document.querySelectorAll('[data-job-status]'))if(old.dataset.jobStatus===row.job_id)old.hidden=true;
  if(node.dataset.revision===String(row.revision))continue;const open=node.querySelector('details')?.open;
  node.dataset.revision=row.revision;node.dataset.status=row.status;
  const summary=`<span class="progress-dot" aria-hidden="true"></span><strong>${esc(row.label)}</strong><span class="progress-time" ${row.status==='RUNNING'?`data-progress-start="${esc(row.started_at)}"`:''}>${elapsed(row.started_at,row.ended_at?Date.parse(row.ended_at):Date.now())}</span>`;
  if(row.status==='RUNNING')node.innerHTML=`<div class="progress-heading" role="status">${summary}</div><div class="progress-meta">${esc(row.model||row.harness)}${row.tools.length?' · '+row.tools.length+' 项工具记录':''}</div>${toolList(row)}<div class="progress-footer"><small data-progress-idle="${esc(row.last_activity_at)}"></small><button type="button" data-stop-progress="${esc(row.job_id)}">停止</button></div>`;
  else node.innerHTML=`<details ${open?'open':''}><summary class="progress-heading">${summary}</summary><div class="progress-meta">${esc(row.model||row.harness)} · ${row.tools.length} 项工具记录</div>${toolList(row)}</details>`;
 }
 for(const node of container.querySelectorAll('[data-run-progress]'))if(!keep.has(node.dataset.runProgress))node.remove();
 container.dataset.hasRunProgress=[...latest.values()].some(row=>row.status==='RUNNING')?'true':'false';
 restoreReadingPosition(container,position);
 }tick();}
function schedule(){if(!queued){queued=true;requestAnimationFrame(paint);}}
function tick(){if(document.hidden)return;for(const node of document.querySelectorAll('[data-progress-start]'))node.textContent=elapsed(node.dataset.progressStart);for(const node of document.querySelectorAll('[data-progress-idle]')){const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(node.dataset.progressIdle))/1000));node.textContent=seconds>=30?`已有 ${seconds} 秒未收到新进展，可继续等待或停止。`:'进度随宿主事件更新';}}
function receive(row){if(!row||typeof row.run_id!=='string'||!Number.isSafeInteger(row.revision)||!Array.isArray(row.tools))return;if((rows.get(row.run_id)?.revision||0)>=row.revision)return;rows.set(row.run_id,row);while(rows.size>100)rows.delete(rows.keys().next().value);schedule();}
export function bindRunProgress(container,cid){if(!container||!cid)return;bindings.set(container,cid);schedule();}
events.addEventListener('run-progress',event=>{try{receive(JSON.parse(event.data));}catch{}});
events.addEventListener('open',()=>{rows.clear();schedule();fetch('/api/run-progress').then(r=>r.ok?r.json():[]).then(list=>list.forEach(receive)).catch(()=>{});});
document.addEventListener('click',async event=>{const button=event.target.closest('[data-stop-progress]');if(!button)return;button.disabled=true;try{const response=await fetch('/api/jobs/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:button.dataset.stopProgress})});if(!response.ok)throw Error();button.textContent='正在停止…';}catch{button.disabled=false;button.textContent='停止失败，重试';}});
const timer=setInterval(tick,1000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
