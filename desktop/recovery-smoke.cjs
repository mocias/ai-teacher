const assert=require('node:assert/strict');
exports.run=async({main,exec,post,click,set,submit,closeWait,until,capture,state,today})=>{
 const before=await state(),original=before.calendar;
 const yesterday=await exec(`(()=>{const d=new Date();d.setDate(d.getDate()-1);return d.toLocaleDateString('sv-SE')})()`);
 for(const e of original)await post('calendar',{...e,date:yesterday});
 await post('calendar/progress',{id:original[0].id,progress:40,notes:'重新排期前的学习记录'});
 const open=async()=>{await click('[data-view="home"]');await click('[data-action="calendar-recovery"]');await until(()=>exec(`!!document.querySelector('#recovery-start')`),'重新排期设置');await exec(`document.querySelectorAll('#dialog-form input[name^="weekday_"]').forEach(x=>{x.checked=true;x.dispatchEvent(new Event('input',{bubbles:true}));})`);};
 const preview=async()=>{await submit();await until(()=>exec(`document.querySelector('#recovery-preview')?.textContent.includes('确认新日期 · 2 项')`),'重新排期预览');};
 await open();await preview();assert.ok((await state()).calendar.every(e=>e.date===yesterday));
 await click('#editor [data-action="close-dialog"]');assert.ok((await state()).calendar.every(e=>e.date===yesterday),'关闭预览不能更改日期');
 await open();await preview();await set('#recovery-budget','90');assert.equal(await exec(`document.querySelector('#dialog-form button[type=submit]').textContent`),'预览新日期');await preview();
 await post('calendar/progress',{id:original[0].id,progress:50,notes:'预览后补充的学习记录'});await submit();
 await until(()=>exec(`document.querySelector('#recovery-preview')?.textContent.includes('请重新预览')`),'过期预览拦截');assert.ok((await state()).calendar.every(e=>e.date===yesterday));
 await preview();main.setSize(960,700);await exec(`document.querySelector('#recovery-preview').scrollIntoView({block:'end'})`);await capture('recovery-preview');assert.ok(await exec(`document.querySelector('#editor').scrollWidth<=document.querySelector('#editor').clientWidth+2`));main.setSize(1380,900);
 await submit();await closeWait();const saved=await state();assert.equal(saved.calendar.length,original.length);
 for(const e of original){const next=saved.calendar.find(x=>x.id===e.id);assert.equal(next.date,today);assert.equal(next.session_id,e.session_id);assert.equal(next.duration,e.duration);}
 assert.equal(saved.calendar.find(e=>e.id===original[0].id).progress,50);assert.equal(saved.calendar.find(e=>e.id===original[0].id).notes,'预览后补充的学习记录');assert.deepEqual(saved.evidence,before.evidence);
 await main.webContents.reload();await until(()=>exec(`!!document.querySelector('.today-learning')`),'重新排期重载');assert.deepEqual((await state()).calendar,saved.calendar);await capture('recovery-today');
 return {previewWithoutWrites:true,cancelWithoutWrites:true,settingsInvalidatePreview:true,stalePreviewRejected:true,idsAndProgressPreserved:true,evidenceUnchanged:true,reloadPreserved:true};
};
