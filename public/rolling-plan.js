const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function rollingPlanView(state,goalId,{expanded=false}={}){
 const plan=state.rolling_plan;if(!plan)return '';
 const queue=plan.queue.filter(x=>x.session.goal_id===goalId),overflow=plan.overflow.filter(x=>x.session.goal_id===goalId),excluded=plan.excluded.filter(x=>x.session.goal_id===goalId),deferred=new Set(plan.deferred.map(x=>x.session_id)),removed=new Set(plan.removed.map(x=>x.session_id)),excludedTopics=plan.excluded_topics;
 const domain=state.goals.find(x=>x.id===goalId)?.domain||'',limit=plan.config.domain_limits[domain]??plan.config.global_limit;
 return `<section class="panel rolling-plan"><div class="panelhead"><div><h2>接下来学什么</h2><p class="help">选择一项任务继续学习，或先查看任务要求和资料。</p></div><span class="badge">${queue.length} / ${limit}</span></div>

 ${queue.length?`<ol>${queue.map(x=>`<li class="rolling-task"><div><button type="button" class="ghost rolling-task-title" data-action="detail-session" data-id="${esc(x.session.id)}">${esc(x.session.title)}</button>${x.topic?`<small class="muted">${esc(x.topic)}</small>`:''}</div><div class="row"><button type="button" class="primary small" data-action="task-chat" data-id="${esc(x.session.id)}">进入学习答疑</button><button class="small ghost" data-action="rolling-defer" data-id="${esc(x.session.id)}">延后</button> <button class="small ghost" data-action="rolling-remove" data-id="${esc(x.session.id)}">移除此任务</button></div></li>`).join('')}</ol>`:'<p class="help">当前没有可执行的近期任务。</p>'}
 ${overflow.length?`<details><summary>后续可执行 · ${overflow.length} 项</summary><ol>${overflow.map(x=>`<li>${esc(x.session.title)}${x.topic?` · ${esc(x.topic)}`:''}</li>`).join('')}</ol></details>`:''}
 ${excluded.length?`<details><summary>暂不可执行 · ${excluded.length} 项</summary><ul>${excluded.map(x=>`<li>${esc(x.session.title)}：${esc(x.reason)}${deferred.has(x.session.id)||removed.has(x.session.id)?` <button class="small" data-action="rolling-restore" data-id="${esc(x.session.id)}">恢复任务</button>`:''}</li>`).join('')}</ul></details>`:''}
 <details class="rolling-adjustments" data-rolling-goal="${esc(goalId)}" ${expanded?'open':''}><summary id="rolling-adjustments-summary">调整学习队列</summary><p class="help">全局默认 ${plan.config.global_limit} 项 · ${esc(domain)} 当前 ${limit} 项。延期和阻塞项会自动补位，不会自动恢复。</p><form class="row" data-rolling-settings data-domain="${esc(domain)}"><label>此领域近期任务数 <input id="rolling-limit" name="limit" type="number" min="0" max="50" value="${limit}" aria-label="此领域近期任务数"></label><button class="small" type="button" data-action="rolling-settings">保存队列数量</button></form>
 ${state.proposals.filter(p=>p.goal_id===goalId&&p.status==='ACCEPTED').map(p=>{const core=new Set((state.learning?.requirements||[]).filter(r=>state.learning.readiness_items.some(i=>i.id===r.readiness_id&&i.kind==='CORE')).map(r=>r.id));return p.items.filter(x=>x.key).map(x=>{const excluded=excludedTopics.some(e=>e.proposal_id===p.id&&e.topic_key===x.key),isCore=(x.requirement_ids||[]).some(id=>core.has(id));return `<p class="help">${esc(x.topic||x.key)}${isCore?' · 核心主题':''} ${excluded?`<button class="small" data-action="rolling-restore-topic" data-id="${esc(p.id)}" data-topic="${esc(x.key)}">恢复主题</button>`:`<button class="small ghost" data-action="rolling-exclude-topic" data-id="${esc(p.id)}" data-topic="${esc(x.key)}">排除此主题</button>`}</p>`;}).join('');}).join('')}</details></section>`;
}

export async function rollingPlanAction(name,node,{state,api,dialog,toast}){
 const id=node.dataset.id;
 if(name==='rolling-defer'){
  dialog('延后近期任务','<label for="defer-reason">延后原因（可选）</label><input id="defer-reason" name="reason" maxlength="500" placeholder="例如：本周先处理其他内容">',async value=>{await api('rolling-plan/defer',{session_id:id,reason:value.reason||''});toast('已延后；不会自动恢复');});return true;
 }
 if(name==='rolling-restore'){await api('rolling-plan/restore',{session_id:id});toast('已恢复到队列候选中');return true;}
 if(name==='rolling-remove'){await api('rolling-plan/remove',{session_id:id});toast('已移除此任务；同主题的其他任务不受影响');return true;}
 if(name==='rolling-exclude-topic'){await api('rolling-plan/exclude-topic',{proposal_id:id,topic_key:node.dataset.topic});toast('已排除此主题');return true;}
 if(name==='rolling-restore-topic'){await api('rolling-plan/restore-topic',{proposal_id:id,topic_key:node.dataset.topic});toast('已恢复此主题');return true;}
 if(name==='rolling-settings'){const form=node.closest('[data-rolling-settings]');if(!form)return true;const data=new FormData(form),domain=form.dataset.domain;await api('rolling-plan/settings',{revision:state.rolling_plan.config.revision,global_limit:state.rolling_plan.config.global_limit,domain_limits:{...state.rolling_plan.config.domain_limits,[domain]:Number(data.get('limit'))},goal_order:state.rolling_plan.config.goal_order});toast('近期队列数量已保存');return true;}
 return false;
}
