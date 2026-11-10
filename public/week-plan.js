const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dayNames=['日','一','二','三','四','五','六'];
export async function weekPlanDialog(startDate,{api,dialog,toast}){
 const current=await api('week-plan/settings');let preview=null;
 const weekdays=new Set(current.weekdays);
 const fields=`<p class="help">只给当前可执行、尚无有效日程的路线任务排日期。曾取消的日程保留在历史中。已有路线日期与进度、复习和补学原安排会保留并计入每天容量。</p><label for="wp-capacity">每天可用于学习的分钟数</label><input id="wp-capacity" name="daily_minutes" type="number" min="1" max="720" required value="${current.daily_minutes}"><label for="wp-session">每个路线任务预计分钟数</label><input id="wp-session" name="session_minutes" type="number" min="1" max="240" required value="${current.session_minutes}"><label for="wp-review">每项待复习预留分钟数</label><input id="wp-review" name="review_minutes" type="number" min="5" max="240" required value="${current.review_minutes}"><fieldset><legend>学习日</legend><div class="row">${dayNames.map((label,index)=>`<label class="checkrow"><input type="checkbox" name="weekday_${index}" ${weekdays.has(index)?'checked':''}>周${label}</label>`).join('')}</div></fieldset><label for="wp-priority">领域优先顺序（逗号分隔，未列领域沿用路线顺序）</label><input id="wp-priority" name="domain_priority" maxlength="1000" value="${esc(current.domain_priority.join(', '))}" placeholder="例如：数学, AI Infra"><div id="wp-preview" aria-live="polite"></div><p class="help">日期建议会保留每日容量给现有日历、到期复习和补学。提交前可查看每项日期、分钟和安排理由。</p>`;
 dialog(`安排 ${startDate} 这周的学习`,fields,async data=>{
  const value={start_date:startDate,daily_minutes:Number(data.daily_minutes),session_minutes:Number(data.session_minutes),review_minutes:Number(data.review_minutes),weekdays:Object.keys(data).filter(key=>key.startsWith('weekday_')).map(key=>Number(key.slice(8))),domain_priority:data.domain_priority.split(',').map(domain=>domain.trim()).filter(Boolean),tz_offset:new Date().getTimezoneOffset(),revision:current.revision};
  if(!preview){
   preview=await api('week-plan/preview',value);
   const fixed=preview.fixed.map(item=>`<li>${esc(item.date)} · ${esc(item.title)} · ${item.minutes} 分钟 · ${esc(item.kind)}</li>`).join('')||'<li>本周没有既有固定占用。</li>';
   const entries=preview.entries.map(item=>`<li>${esc(item.date)} · ${esc(item.domain)} / ${esc(item.title)} · ${item.duration} 分钟<br><span class="help">${esc(item.reason)}</span></li>`).join('')||'<li>没有缺少日程且可排入本周的路线任务。</li>';
   const unplaced=preview.unplaced.map(item=>`<li>${esc(item.domain)} / ${esc(item.title)}：${esc(item.reason)}</li>`).join('');
   document.querySelector('#wp-preview').innerHTML=`<h3>排期预览 · ${preview.entries.length} 项</h3><p>已有安排与到期复习（只计入负载，不复制）</p><ol>${fixed}</ol><p>建议路线日程</p><ol>${entries}</ol>${unplaced?`<p>本周无法排入</p><ul>${unplaced}</ul>`:''}`;
   const submit=document.querySelector('#dialog-form button[type=submit]');submit.textContent=preview.entries.length?'确认并排入日历':'只保存这些容量设置';return false;
  }
  if(preview.entries.length){
   try{const result=await api('week-plan/commit',{...value,fingerprint:preview.fingerprint,request_id:crypto.randomUUID()});toast(`已安排 ${result.entries.length} 项路线任务；原复习与补学安排保留`);}
   catch(error){preview=null;document.querySelector('#dialog-form button[type=submit]').textContent='重新生成预览';document.querySelector('#wp-preview').textContent='日历、容量或可执行路线已变化，请重新生成预览。';throw error;}
  }else{await api('week-plan/settings',{...value,request_id:crypto.randomUUID()});toast('容量、学习日和领域优先级已保存');}
 });
 const form=document.querySelector('#dialog-form');form.querySelector('button[type=submit]').textContent='生成排期预览';
 form.addEventListener('input',()=>{if(!preview)return;preview=null;document.querySelector('#wp-preview').textContent='设置已改变，请重新生成预览。';form.querySelector('button[type=submit]').textContent='生成排期预览';});
}
