const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog=null,loading=null,loadedAt=0;const pending=new Set();
export async function loadDshModels(force=false){
 if(loading)return loading;if(!force&&catalog&&Date.now()-loadedAt<60000)return catalog;
 loading=fetch('/api/agents/dsh-models'+(force?'?refresh=1':'')).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error||'无法读取 DSH 模型');catalog=value;loadedAt=Date.now();return value;}).finally(()=>{loading=null;});return loading;
}
export function dshModelOptions(value,current='',defaultLabel='沿用功能默认模型'){
 const options=value?.models||[],groups=new Map();for(const row of options){if(!groups.has(row.provider))groups.set(row.provider,[]);groups.get(row.provider).push(row);}
 return `<option value="">${esc(defaultLabel)}</option>`+(current&&!options.some(row=>row.id===current)?`<option value="${esc(current)}" selected>${esc(current)} · 未在列表中</option>`:'')+[...groups].map(([provider,rows])=>`<optgroup label="${esc(rows[0].provider_name+' · '+provider)}">${rows.map(row=>`<option value="${esc(row.id)}" ${row.id===current?'selected':''}>${esc(row.name+' · '+row.provider)}</option>`).join('')}</optgroup>`).join('');
}
export function conversationRole(state,cid,taskKind='chat'){
 const kind=state.conversations.find(c=>c.id===cid)?.kind;
 if(kind==='ORCHESTRATION')return 'master';if(['READING','ONBOARDING','CHANGE_REVIEW'].includes(kind))return kind.toLowerCase();
 const assessment=state.learning?.assessments.find(a=>a.conversation_id===cid);
 return assessment?assessment.kind==='FINAL'?'final':['REVIEW','REVIEW_DIAGNOSTIC','REINFORCEMENT'].includes(assessment.kind)?'review':'assessment':taskKind;
}
export function bindDshModelPicker(form,state,cid,role=conversationRole(state,cid)){
 if(!form)return;let box=form.querySelector('.dsh-model-picker');
 const route=state.agents?.routes.find(row=>row.role===role);
 if(!cid||!state.agents?.enabled||route?.mode!=='MCP'||route.harness!=='DSH'){box?.remove();return;}
 if(!box){box=document.createElement('div');box.className='dsh-model-picker';(form.querySelector('.composer-tools')||form).prepend(box);}
 const chosen=state.agents?.dsh_conversation_models?.find(row=>row.conversation_id===cid)?.model||'';
 const signature=JSON.stringify([cid,chosen,route.model]);if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.dataset.cid=cid;
 box.innerHTML='<span class="dsh-model-label">DSH 模型</span><span class="help" role="status">正在读取模型列表…</span>';
 function paint(value){
  if(!box.isConnected||box.dataset.signature!==signature)return;
  const fallback=route.model||value.default_model||'DSH 默认模型';
  const notices=value.error||value.diagnostics?.filter(row=>row.code!=='DISABLED').map(row=>row.plugin+'：'+row.message).join('；')||'';
  box.innerHTML=`<label class="dsh-model-label">DSH 模型<select aria-label="此对话的 DSH 模型" ${pending.has(cid)?'disabled':''}>${dshModelOptions(value,chosen,'默认：'+fallback)}</select></label><button class="ghost small" type="button" title="重新读取 DSH 模型列表" aria-label="刷新 DSH 模型列表">↻</button><small role="status" class="${notices?'picker-notice':''}">${esc(notices)}</small>`;
  const select=box.querySelector('select'),status=box.querySelector('small');
  select.onchange=async()=>{
   const model=select.value;if(pending.has(cid))return;pending.add(cid);select.disabled=true;status.classList.add('picker-notice');status.textContent='正在保存模型选择…';
   try{const response=await fetch('/api/agents/dsh-model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation_id:cid,model})}),result=await response.json();if(!response.ok)throw Error(result.error||'保存失败');status.textContent='已保存，后续消息使用所选模型';window.dispatchEvent(new CustomEvent('dsh-model-changed',{detail:{cid,model}}));}
   catch(error){select.value=chosen;status.textContent=error.message;}
   finally{pending.delete(cid);for(const picker of document.querySelectorAll('.dsh-model-picker'))if(picker.dataset.cid===cid&&picker.querySelector('select'))picker.querySelector('select').disabled=false;}
  };
  box.querySelector('button').onclick=async()=>{const refresh=box.querySelector('button');refresh.disabled=true;status.classList.add('picker-notice');status.textContent='正在同步 DSH 提供商和插件模型…';try{paint(await loadDshModels(true));}catch(error){status.textContent=error.message;}finally{refresh.disabled=false;}};
 }
 loadDshModels().then(paint).catch(error=>{if(box.isConnected){box.dataset.signature='';box.innerHTML='<span role="status">'+esc(error.message)+'</span><button type="button" class="small">重新读取</button>';box.querySelector('button').onclick=()=>bindDshModelPicker(form,state,cid,role);}});
}
// Do not let a message race the model preference write.
globalThis.document?.addEventListener('submit',event=>{const box=event.target.querySelector?.('.dsh-model-picker');if(box&&pending.has(box.dataset.cid)){event.preventDefault();event.stopImmediatePropagation();box.querySelector('small').textContent='模型选择正在保存，请稍后发送';}},true);
