import {pendingRemediation,remediationHistory} from './remediation.js';
import {currentGaps} from './followups.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const localDate=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const btn=(action,label,id,primary=false)=>`<button type="button" class="${primary?'primary':'small'}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
export function goalJourney(state,id,today=localDate()){
 const g=state.goals.find(g=>g.id===id),L=state.learning;
 if(!g)return null;
 const set=L.capability_sets.find(x=>x.goal_id===id&&x.status==='ACCEPTED'),resources=state.resources.filter(r=>r.goal_id===id);
 const sessions=state.sessions.filter(s=>s.goal_id===id&&s.status!=='REMOVED_FROM_PLAN');
 const base={goal:g,resources,sessions,set};const result=(stage,title,description,action,extra={})=>({...base,stage,title,description,action,...extra});
 if(g.status==='PAUSED')return result('paused','目标已暂停','恢复后继续学习与评估。','恢复目标');
 if(['COMPLETED','ABANDONED'].includes(g.status))return result('ended',g.status==='COMPLETED'?'目标已完成':'目标已终止','历史资料、学习记录和证据继续保留。',g.status==='COMPLETED'?'查看长期复习':'查看目标记录');
 const assessment=L.assessments.find(a=>a.goal_id===id&&['WAITING_HOST','WAITING_ANSWER'].includes(a.status));
 if(assessment)return result('assessment','继续当前考察',assessment.status==='WAITING_ANSWER'?'有一道问题等待你回答。':'Teacher 正在准备下一道问题，可查看处理状态。','继续考察',{assessment});
 const conversationIds=new Set(state.conversations.filter(c=>c.goal_id===id).map(c=>c.id)),job=state.jobs.find(j=>conversationIds.has(j.conversation_id)&&['QUEUED','RUNNING'].includes(j.status));
 if(job)return result('waiting','有待处理的学习请求','进入对话查看回复；遇到未配置或失败时，可调整对应功能并重试。','查看处理状态',{job});
 const material=resources.find(r=>r.role==='PRIMARY'&&(()=>{const c=L.material_contents.filter(c=>c.resource_id===r.id).at(-1);return !c||!L.material_analysis.some(a=>a.content_id===c.id&&a.status==='ANALYZED');})());
 if(material){const content=L.material_contents.filter(c=>c.resource_id===material.id).at(-1);return result('material','准备学习资料',`主材料“${material.title}”${content?'尚待分析。':'需要保存正文和分析范围。'}`,content?'分析主材料':'补充资料正文',{material,content});}
 if(L.capability_sets.some(s=>s.goal_id===id&&s.status==='PENDING'))return result('confirm-cap','确认能力要求','检查 AI 提出的学习要求，确认后开始诊断。','查看并确认');
 if(!set)return result('capabilities','明确要学会什么','根据目标与资料提出核心能力和具体要求，等你确认。','生成能力要求');
 const diagnostic=L.assessments.some(a=>a.goal_id===id&&a.kind==='INITIAL_DIAGNOSTIC'&&['COMPLETED','ENDED_EARLY'].includes(a.status)&&L.assessment_capabilities?.some(c=>c.assessment_id===a.id&&c.set_id===set.id));
 if(!diagnostic)return result('diagnostic','了解当前基础','完成本版能力要求的初始诊断，再生成学习路线。','开始初始诊断');
 const details=L.roadmap_details.filter(d=>d.set_id===set.id),valid=new Set(details.map(d=>d.proposal_id));
 if(state.proposals.some(p=>p.goal_id===id&&p.status==='PENDING'&&valid.has(p.id)))return result('confirm-roadmap','确认学习路线','检查阶段、资料和任务安排，确认后才能开始排期。','查看并确认路线');
 const proposal=state.proposals.find(p=>p.goal_id===id&&p.status==='ACCEPTED'&&valid.has(p.id));
 if(!proposal)return result('roadmap','生成学习路线','根据已确认要求、资料分析和诊断结果提出分阶段路线。','生成学习路线');
 const current=sessions.filter(s=>s.proposal_id===proposal.id),reviews=dueReviews(state,today).filter(r=>r.goal_id===id);
 if(reviews.length)return result('review','有复习等待完成',`有 ${reviews.length} 项到期或进行中的复习，先回忆再查看答案。`,'开始 / 继续复习',{review:reviews[0]});
 const unscheduled=current.filter(s=>s.status==='PLANNED'&&!state.calendar.some(e=>e.session_id===s.id&&!e.cancelled));
 if(unscheduled.length)return result('schedule','把路线放进每天',`${unscheduled.length} 个任务尚未排期。设置每日预算，先看预览再确认。`,'生成排期预览');
 const daily=state.calendar.find(e=>!e.cancelled&&!e.done&&current.some(s=>s.id===e.session_id));
 if(daily)return result('daily','按计划继续学习',`${daily.date} · ${daily.title} · 已记录 ${daily.progress}%`,'打开学习任务',{entry:daily});
 const unassessed=current.find(s=>s.status==='PLANNED');
 if(unassessed)return result('practice','学习后验证理解','学习记录已保存。可自愿进行考察，或安排下一次复习。','开始学习考察',{session:unassessed});
 const gap=currentGaps(state,id).find(g=>L.requirements.some(r=>r.id===g.requirement_id&&L.readiness_items.some(i=>i.id===r.readiness_id&&i.kind==='CORE')));
 const remedial=gap&&pendingRemediation(state,gap.id);
 if(remedial)return result('remediation','继续薄弱点补学',`${remedial.entry.date} · ${remedial.entry.title} · 已记录 ${remedial.entry.progress}%`,'打开补学任务',{entry:remedial.entry,gap});
 if(gap)return result('gap','先处理核心薄弱点',gap.description,'回看资料与强化',{gap});
 return result('final','总结学习成果','路线考察已记录；通过最终面试并确认后才能完成目标。','查看评估与结束条件');
}
export function dueReviews(state,today=localDate()){
 return (state.learning?.reviews||[]).filter(r=>['DUE','IN_PROGRESS'].includes(r.status)&&(r.due_date<=today||r.status==='IN_PROGRESS')&&state.goals.some(g=>g.id===r.goal_id&&!['PAUSED','ABANDONED'].includes(g.status))&&state.learning.requirements.some(q=>q.id===r.requirement_id&&state.learning.capability_sets.some(s=>s.id===q.set_id&&s.status==='ACCEPTED'))).sort((a,b)=>a.due_date.localeCompare(b.due_date));
}
export function journeySummary(state){
 const goals=state.goals.filter(g=>!['COMPLETED','ABANDONED'].includes(g.status)).slice(0,3);if(!goals.length)return '';
 return `<section class="journey-summary" aria-label="目标下一步">${goals.map(g=>{const j=goalJourney(state,g.id);return `<article class="panel"><span class="help">目标下一步</span><h3>${esc(g.title)}</h3><p>${esc(j.title)}</p>${btn('journey-open','查看目标进度',g.id)}</article>`;}).join('')}</section>`;
}
export function journeyView(state,id){
 const j=goalJourney(state,id);if(!j)return '<section class="panel"><h2>从资料或一个想法开始</h2><p>先收藏资料，再创建目标；也可以在首页讨论学习方向。</p><button data-view="resources">前往资料库</button><button data-view="home">讨论学习目标</button></section>';
 const {goal,resources,sessions}=j,L=state.learning,notes=state.notes.filter(n=>n.goal_id===id&&!n.archived),evidence=state.evidence.filter(e=>e.goal_id===id),reviews=L.reviews.filter(r=>r.goal_id===id);
 return `<section class="panel journey-next" data-stage="${j.stage}"><div class="eyebrow">下一步</div><h2>${esc(j.title)}</h2><p>${esc(j.description)}</p><div class="row">${btn('journey-next',j.action,id,true)}${btn('journey-chat','目标讨论',id)}</div></section><ol class="journey-steps">${['资料与目标','能力要求','初始诊断','学习路线','每日学习','考察与复习'].map(x=>`<li>${x}</li>`).join('')}</ol><section class="panel"><h2>学习记录</h2><div class="journey-metrics"><div><strong>${resources.length}</strong><span>正式学习资料</span></div><div><strong>${sessions.filter(s=>s.status==='COMPLETED').length} / ${sessions.length}</strong><span>路线考察已完成</span></div><div><strong>${evidence.length}</strong><span>实际回答证据</span></div><div><strong>${reviews.filter(r=>r.status==='DONE').length} / ${reviews.length}</strong><span>复习已完成</span></div></div><p class="help">阅读和日程进度不代表能力掌握；考察结论保留实际回答依据。</p><div class="row">${btn('journey-plan','学习路线',id)}${btn('journey-learning','评估与缺口',id)}${btn('journey-review','复习安排',id)}${goal.status==='ACTIVE'?btn('journey-schedule','批量安排学习',id):''}</div></section>${remediationHistory(state,id)}<div class="columns"><section class="panel"><h2>本目标资料</h2>${resources.map(r=>`<article class="goalcard"><h3>${esc(r.title)}</h3><p class="help">${({PRIMARY:'主材料',SUPPLEMENTARY:'补充材料',REFERENCE:'参考资料'})[r.role]}</p><div class="row">${btn('reader-open','打开阅读',r.id)}${btn('v2-material','保存正文 / 范围',r.id)}${L.material_contents.some(c=>c.resource_id===r.id)?btn('v2-analyze','分析资料',r.id):''}</div></article>`).join('')||'<p>还未关联正式资料，可从资料库选择收藏。</p>'}<button data-view="resources">前往资料库</button></section><section class="panel"><h2>目标笔记</h2>${notes.map(n=>`<article class="goalcard"><h3>${esc(n.title)}</h3><p class="help preline">${esc(n.content.slice(0,240))}</p>${btn('detail-note','查看完整笔记',n.id)}</article>`).join('')||'<p class="help">学习记录在每日任务中保存；独立笔记可在“我的笔记”中按目标整理。</p>'}</section></div>`;
}

export function scheduleDialog(goalId,{api,dialog,toast}){
 let preview=null;const key=crypto.randomUUID();
 dialog('把学习路线安排到日历',`<p class="help">仅安排尚无有效日程的待学习任务，按主题依赖排序，并计入现有日程的预计用时。每项任务使用下方统一时长；可在日历中逐项调整。</p><label for="batch-start">开始日期</label><input id="batch-start" name="start_date" type="date" required value="${localDate()}"><label for="batch-budget">每天最多安排多少分钟</label><input id="batch-budget" name="daily_minutes" type="number" min="1" max="720" value="60" required><label for="batch-duration">每个任务预计分钟数</label><input id="batch-duration" name="session_minutes" type="number" min="1" max="240" value="30" required><fieldset><legend>学习日</legend><div class="row">${['日','一','二','三','四','五','六'].map((d,i)=>`<label class="checkrow"><input type="checkbox" name="day_${i}" ${i>0&&i<6?'checked':''}>周${d}</label>`).join('')}</div></fieldset><div id="schedule-preview" aria-live="polite"></div>`,async data=>{
  const input={goal_id:goalId,start_date:data.start_date,daily_minutes:Number(data.daily_minutes),session_minutes:Number(data.session_minutes),weekdays:Object.keys(data).filter(k=>k.startsWith('day_')).map(k=>Number(k.slice(4)))};
  if(!preview){preview=await api('calendar/preview',input);document.querySelector('#schedule-preview').innerHTML=`<h3>排期预览 · ${preview.entries.length} 项 / ${preview.total_minutes} 分钟</h3><p class="help">已跳过 ${preview.skipped} 项已有日程或非待学习任务。${preview.entries.length?'确认后才保存到日历。':'当前没有待排期任务。'}</p><ol>${preview.entries.map(e=>`<li>${esc(e.date)} · ${esc(e.title)} · ${e.duration} 分钟</li>`).join('')}</ol>`;document.querySelector('#dialog-form button[type=submit]').textContent=preview.entries.length?'确认全部排期':'重新生成预览';if(!preview.entries.length)preview=null;return false;}
  try{await api('calendar/batch',{...input,fingerprint:preview.fingerprint,request_id:key});toast('学习任务已排入日历，可从首页开始学习');}catch(e){preview=null;document.querySelector('#schedule-preview').textContent='日历或路线可能已更新，请重新生成预览。';document.querySelector('#dialog-form button[type=submit]').textContent='重新生成预览';throw e;}
 });
 const form=document.querySelector('#dialog-form');form.querySelector('button[type=submit]').textContent='生成排期预览';
 form.addEventListener('input',()=>{preview=null;document.querySelector('#schedule-preview').textContent='设置已改变，请重新生成预览。';form.querySelector('button[type=submit]').textContent='生成排期预览';});
}
