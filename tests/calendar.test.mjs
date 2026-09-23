import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
test('daily plans persist and completing a calendar item does not change learning evidence',t=>{
 const folder=mkdtempSync(join(tmpdir(),'teacher-calendar-')),file=join(folder,'teacher.sqlite');let s=createStore(file);t.after(()=>{s.db.close();rmSync(folder,{recursive:true,force:true});});
 const event=s.calendar.save({title:'阅读缓存原理',date:'2026-09-24',time:'19:30'});assert.equal(s.overview().calendar[0].time,'19:30');s.calendar.done({id:event.id,done:true});assert.equal(s.overview().evidence.length,0);s.db.close();s=createStore(file);assert.equal(s.overview().calendar[0].done,1);
 s.calendar.save({id:event.id,title:'推导缓存',date:'2026-09-25',time:''});assert.equal(s.overview().calendar.length,1);assert.equal(s.overview().calendar[0].date,'2026-09-25');assert.equal(s.overview().calendar[0].done,1);
 for(const value of [{date:'2026-02-30'},{time:'25:00'},{session_id:'missing'},{id:'missing'},{title:''}])assert.throws(()=>s.calendar.save({title:'学习',date:'2026-09-24',...value}));
 assert.throws(()=>s.calendar.done({id:event.id,done:'true'}));
});
