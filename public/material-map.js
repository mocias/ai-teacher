const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function materialMapView(state,goalId){
 const all=state.learning?.material_map||{},map=all.by_goal?.[goalId]||all,requirements=state.learning?.requirements||[];
 const resourceTitle=contentId=>{const content=state.learning?.material_contents?.find(c=>c.id===contentId),resource=state.resources.find(r=>r.id===content?.resource_id);return resource?.title||'资料';};
 const label={COVERED:'覆盖',PARTIAL:'部分覆盖',NOT_COVERED:'未覆盖',UNCLEAR:'尚不明确'};
 const relevant=(map.items||[]).filter(x=>x.goal_id===undefined||x.goal_id===goalId),conflicts=(map.conflicts||[]).filter(x=>x.goal_id===undefined||x.goal_id===goalId),unmapped=(map.unmapped||[]).map(x=>typeof x==='string'?x:x.requirement_id);
 const missing=unmapped.length?`<p class="help">尚无当前版本覆盖记录：${unmapped.map(id=>esc(requirements.find(r=>r.id===id)?.description||'已更新的能力要求')).join('；')}</p>`:'';
 const coverRows=relevant.map(x=>`<article class="goalcard"><strong>${esc(requirements.find(r=>r.id===x.requirement_id)?.description||'历史要求')}</strong><p>${esc(resourceTitle(x.content_id))} · ${esc(label[x.coverage]||x.coverage)}${x.current?'':' · 旧版本，需重新核对'}</p>${x.rationale?`<p class="help">${esc(x.rationale)}</p>`:''}</article>`).join('')||'<p class="help">Teacher 尚未为当前资料正文记录覆盖范围。</p>';
 const conflictRows=conflicts.map(c=>{
  const status=c.current?(c.status==='OPEN'?'待裁决':c.decision==='ADOPTED'?`已采用：${resourceTitle(c.resolution_content_id)}`:'经核对不构成冲突'):'旧正文或旧能力版本，历史裁决保留但不用于当前流程';
  const history=(c.decision_history||[]).map(d=>`<p>${esc(d.decision==='ADOPTED'?`采用 ${resourceTitle(d.source_content_id)}`:'经核对不构成冲突')} · ${esc(d.note)} · ${esc(d.decided_at)}</p>`).join('');
  const goal=state.goals.find(g=>g.id===goalId),actions=c.current&&!['COMPLETED','ABANDONED'].includes(goal?.status)?`<div class="row">${c.source_content_ids.map(source=>`<button class="small" data-action="material-conflict-adopt" data-id="${esc(c.id)}" data-content="${esc(source)}" data-goal="${esc(goalId)}">采用「${esc(resourceTitle(source))}」</button>`).join('')}<button class="small ghost" data-action="material-conflict-dismiss" data-id="${esc(c.id)}" data-goal="${esc(goalId)}">经核对不构成冲突</button></div>`:'';
  return `<article class="goalcard"><p><strong>${esc(c.description)}</strong></p><p class="help">影响要求：${c.requirement_ids.map(id=>esc(requirements.find(r=>r.id===id)?.description||'历史要求')).join('；')}</p><p class="help">来源：${c.source_content_ids.map(resourceTitle).map(esc).join(' ↔ ')||'未关联'}</p><p class="help">${status}</p>${history?`<details><summary>裁决历史 · ${c.decision_history.length}</summary>${history}</details>`:''}${actions}</article>`;
 }).join('')||'<p class="help">当前版本没有待处理的重要冲突。</p>';
 const goal=state.goals.find(g=>g.id===goalId),canUpdate=!['COMPLETED','ABANDONED'].includes(goal?.status);
 return `<section class="panel material-map"><div class="panelhead"><h2>资料覆盖与冲突</h2>${map.current_set_id&&canUpdate?`<button class="small" data-action="material-map-start" data-id="${esc(goalId)}">核对当前资料覆盖</button>`:''}</div><p class="help">这些记录用于核对资料与当前要求的关系。参考资料不计入覆盖；资料覆盖本身也不代表已掌握。</p>${missing}<h3>覆盖记录</h3>${coverRows}<h3>重要冲突</h3>${conflictRows}</section>`;
}
