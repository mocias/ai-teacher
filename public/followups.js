import {gapPlanActions} from './remediation.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,id,requirement='')=>`<button type="button" class="small" data-action="${action}" data-id="${esc(id)}"${requirement?` data-requirement="${esc(requirement)}"`:''}>${esc(label)}</button>`;
export function reviewIsCurrent(state,review){return (state.learning.requirements||[]).some(r=>r.id===review.requirement_id&&(state.learning.capability_sets||[]).some(s=>s.id===r.set_id&&s.goal_id===review.goal_id&&s.status==='ACCEPTED'));}
export function currentGaps(state,goalId){
 const L=state.learning,set=L.capability_sets.find(s=>s.goal_id===goalId&&s.status==='ACCEPTED');
 return L.gaps.filter(g=>g.goal_id===goalId&&g.status!=='RESOLVED'&&L.requirements.some(r=>r.id===g.requirement_id&&r.set_id===set?.id));
}
export function assessmentOutcome(state,id){
 const L=state.learning,a=L.assessments.find(a=>a.id===id);if(!a||!['COMPLETED','ENDED_EARLY'].includes(a.status))return null;
 const evidence=state.evidence.find(e=>e.conversation_id===a.conversation_id),set=L.capability_sets.find(s=>s.goal_id===a.goal_id&&s.status==='ACCEPTED');
 const current=L.assessment_capabilities.some(c=>c.assessment_id===a.id&&c.set_id===set?.id),goal=state.goals.find(g=>g.id===a.goal_id);
 const relations=(L.evidence_requirements||[]).filter(e=>e.evidence_id===evidence?.id).map(e=>({...e,requirement:L.requirements.find(r=>r.id===e.requirement_id),pending:L.reviews.find(r=>r.requirement_id===e.requirement_id&&['DUE','IN_PROGRESS'].includes(r.status))}));
 const gaps=current?currentGaps(state,a.goal_id).filter(g=>relations.some(r=>r.requirement_id===g.requirement_id)):[];
 return {assessment:a,evidence,current,goal,relations,gaps,canSchedule:a.status==='COMPLETED'&&current&&!['PAUSED','ABANDONED'].includes(goal?.status)};
}
export function assessmentReport(state,id,{compact=false}={}){
 const o=assessmentOutcome(state,id);if(!o)return '';const {assessment:a,evidence,current,relations,gaps,canSchedule}=o;
 const summary=compact?String(a.summary||'').slice(0,160):a.summary;
 const home=button('journey-open','返回目标进度',a.goal_id);
 let content='<div class="row">'+button('v2-results','查看结果与下一步',a.id)+home+'</div>';
 if(!compact){
  const rows=relations.map(r=>{
   let action='';
   if(canSchedule)action=r.pending?'<p class="help">已有复习：'+esc(r.pending.due_date)+(r.pending.status==='IN_PROGRESS'?' · 进行中':'')+'</p>'+button('followup-review','查看已有复习',r.pending.id):button('followup-schedule','安排下一次复习',a.id,r.requirement_id);
   const relation=({SUPPORTS:'支持该要求',CONTRADICTS:'发现相反表现',INCONCLUSIVE:'尚不足以判断'})[r.relation]||'未判断';
   return '<article class="outcome-requirement"><strong>'+esc(r.requirement?.description||'历史要求')+'</strong><p class="help">本次证据：'+relation+'</p>'+action+'</article>';
  }).join('');
  const gapRows=gaps.map(g=>'<article class="outcome-gap"><strong>'+esc(g.description)+'</strong><p class="help preline">'+esc(g.reason)+'</p>'+button('followup-gap','回看资料与强化',g.id)+'</article>').join('');
  content=(relations.length?'<h3>本次回答涉及的要求</h3>'+rows:'')+(gaps.length?'<h3>这些要求当前仍需处理的薄弱点</h3>'+gapRows:'<p class="help">'+(current?'这些要求目前没有未解决的已记录薄弱点；不代表其他要求已掌握。':'历史结果继续保留。')+'</p>')+'<div class="row">'+home+'</div>';
 }
 return '<section class="assessment-outcome '+(compact?'compact':'')+'" aria-label="考察结果与下一步"><div class="row between"><h3>'+(a.status==='COMPLETED'?'本次考察已结束':'本次考察提前结束')+'</h3><span class="badge">'+(a.mode==='OPEN_BOOK'?'开卷':'闭卷')+(!current?' · 历史要求版本':'')+'</span></div><p class="preline">'+esc(summary)+'</p><p class="help">'+(evidence?'结论对应本次实际回答，后续复习仍需重新验证。':'本次没有形成正式结论证据。')+(!current?' 当前能力要求已变化，请按新版要求继续学习。':'')+'</p>'+content+'</section>';

}
export function afterDays(days,from=new Date()){const date=new Date(from);date.setDate(date.getDate()+days);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function followupScheduleDialog(state,id,requirementId,{api,dialog,toast}){
 const o=assessmentOutcome(state,id),r=o?.relations.find(r=>r.requirement_id===requirementId);if(!o?.canSchedule||!r)throw Error('当前考察或能力要求不能安排后续复习');
 const gap=o.gaps.find(g=>g.requirement_id===requirementId),request_id=crypto.randomUUID();
 dialog('根据本次结果安排复习',`<h3>${esc(r.requirement?.description)}</h3><p class="help preline">来源：${esc(o.assessment.summary)}</p>${gap?`<p class="help">同时验证薄弱点：${esc(gap.description)}</p>`:''}<label for="followup-date">复习日期</label><input id="followup-date" name="due_date" type="date" required value="${afterDays(3)}"><div class="row date-shortcuts">${[[1,'明天'],[3,'3 天后'],[7,'一周后']].map(([n,label])=>`<button type="button" data-followup-days="${n}">${label}</button>`).join('')}</div><p class="help">日期由你确认。这些是便捷选项，不是对遗忘速度的预测。</p><label for="followup-reason">下次重点验证什么</label><textarea id="followup-reason" name="reason" required maxlength="20000" rows="3">${esc(gap?.description||'脱离材料，重新解释并应用这项能力要求')}</textarea>`,async data=>{
  const result=await api('reviews/followup',{...data,source_assessment_id:id,requirement_id:requirementId,request_id});toast(result.reused?`已有 ${result.due_date} 的复习，已保留原安排`:'后续复习已保存，可在复习页查看来源');
 });
 document.querySelectorAll('[data-followup-days]').forEach(b=>b.onclick=()=>{document.querySelector('#followup-date').value=afterDays(Number(b.dataset.followupDays));});
}
export function remediationContent(state,id){
 const L=state.learning,gap=L.gaps.find(g=>g.id===id);if(!gap)return null;
 const goal=state.goals.find(g=>g.id===gap.goal_id),current=currentGaps(state,gap.goal_id).some(g=>g.id===id);
 const details=L.session_details.filter(d=>d.requirements.includes(gap.requirement_id)&&state.sessions.some(s=>s.id===d.session_id&&s.status!=='REMOVED_FROM_PLAN'));
 const ids=new Set(details.flatMap(d=>d.resources)),resources=state.resources.filter(r=>ids.has(r.id)&&r.goal_id===goal.id);
 return `<p class="help">${esc(goal.title)}</p><h3>${esc(gap.description)}</h3><p class="preline">${esc(gap.reason)}</p><p class="help">${gap.status==='RESOLVED'?'已有新证据支持解决。':!current?'这是旧版能力要求的薄弱点，历史记录保留。':'阅读或忽略不会关闭薄弱点，需要新的回答证据验证。'}</p>${gapPlanActions(state,gap)}<h3>相关学习资料</h3><div class="row">${resources.map(r=>button('reader-open',r.title,r.id)).join('')||'<p class="help">尚无与该要求关联的路线资料，可回到目标资料继续查阅。</p>'}</div><h3>关联学习任务</h3><div class="row">${details.map(d=>button('detail-session',state.sessions.find(s=>s.id===d.session_id)?.title,d.session_id)).join('')||'<p class="help">当前路线未关联该要求。</p>'}</div><div class="row">${current&&goal.status==='ACTIVE'?button('followup-reinforce','准备好了，开始强化考察',gap.id):''}${button('journey-open','返回目标进度',gap.goal_id)}</div>`;
}
