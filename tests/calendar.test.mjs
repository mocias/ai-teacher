import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import {startServer} from '../server/index.mjs';
test('daily plans persist and completing a calendar item does not change learning evidence',t=>{
 const folder=mkdtempSync(join(tmpdir(),'teacher-calendar-')),file=join(folder,'teacher.sqlite');let s=createStore(file);t.after(()=>{s.db.close();rmSync(folder,{recursive:true,force:true});});
 const event=s.calendar.save({title:'阅读缓存原理',date:'2026-09-24',time:'19:30'});assert.equal(s.overview().calendar[0].time,'19:30');s.calendar.done({id:event.id,done:true});assert.equal(s.overview().evidence.length,0);s.db.close();s=createStore(file);assert.equal(s.overview().calendar[0].done,1);
 s.calendar.save({id:event.id,title:'推导缓存',date:'2026-09-25',time:''});assert.equal(s.overview().calendar.length,1);assert.equal(s.overview().calendar[0].date,'2026-09-25');assert.equal(s.overview().calendar[0].done,1);
 for(const value of [{date:'2026-02-30'},{time:'25:00'},{session_id:'missing'},{id:'missing'},{title:''}])assert.throws(()=>s.calendar.save({title:'学习',date:'2026-09-24',...value}));
 assert.throws(()=>s.calendar.done({id:event.id,done:'true'}));
});

test('route scheduling, progress, reordering and cancellation preserve learning state',t=>{
 const folder=mkdtempSync(join(tmpdir(),'teacher-schedule-')),file=join(folder,'teacher.sqlite');let s=createStore(file);t.after(()=>{s.db.close();rmSync(folder,{recursive:true,force:true});});
 const g=s.createGoal({title:'推理学习',domain:'AI',scope:'缓存'}).goal.id;
 const p=s.propose({goal_id:g,title:'路线',summary:'基础',items:[{title:'缓存原理',objective:'解释 KV'}],request_id:randomUUID()});s.decide(p.proposal_id,true);
 const session=s.overview().sessions[0],input={title:session.title,date:'2026-09-24',duration:45,session_id:session.id},a=s.calendar.save(input).id,b=s.calendar.save({title:'笔记整理',date:input.date}).id;
 assert.throws(()=>s.calendar.save(input),/已有待完成/);s.calendar.move({id:b,direction:'up'});assert.equal(s.calendar.state()[0].id,b);
 s.calendar.progress({id:a,progress:60,notes:'理解了保存内容，待学习内存布局'});s.calendar.save({...input,id:a,date:'2026-09-25'});assert.equal(s.calendar.state().find(e=>e.id===a).progress,60);
 s.calendar.progress({id:a,progress:100,notes:'学习完成'});assert.equal(s.overview().sessions[0].status,'PLANNED');assert.equal(s.overview().evidence.length,0);
 s.calendar.cancel({id:a});assert.equal(s.calendar.state().find(e=>e.id===a).cancelled,1);assert.throws(()=>s.calendar.progress({id:a,progress:0,notes:''}),/已取消/);
 const again=s.calendar.save(input);assert.ok(again.id);assert.equal(s.calendar.state().length,3);
 for(const duration of [0,1441,1.5,'30'])assert.throws(()=>s.calendar.save({title:'非法',date:input.date,duration}));
 for(const progress of [-1,101,0.5,'50'])assert.throws(()=>s.calendar.progress({id:again.id,progress,notes:''}));
 s.db.close();s=createStore(file);assert.equal(s.calendar.state().find(e=>e.id===a).notes,'学习完成');assert.equal(s.calendar.state().find(e=>e.id===a).cancelled,1);
});

test('legacy calendar schema upgrades without losing completed entries',t=>{
 const folder=mkdtempSync(join(tmpdir(),'teacher-calendar-upgrade-')),file=join(folder,'teacher.sqlite');let s=createStore(file);s.db.close();const db=new DatabaseSync(file);
 db.exec("DROP TABLE calendar_entries; CREATE TABLE calendar_entries(id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT NOT NULL,time TEXT NOT NULL DEFAULT '',session_id TEXT,done INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL); INSERT INTO calendar_entries VALUES('old','旧计划','2026-09-24','',NULL,1,'2026-09-24');");db.close();s=createStore(file);t.after(()=>{s.db.close();rmSync(folder,{recursive:true,force:true});});
 const e=s.calendar.state()[0];assert.equal(e.title,'旧计划');assert.equal(e.progress,100);assert.equal(e.duration,30);assert.equal(e.cancelled,0);
});

test('calendar user endpoints require a browser session and persist the daily workflow',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'teacher-calendar-api-')),app=startServer({port:0,dataDir:folder});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(folder,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
 const post=(route,data,headers={Cookie:cookie})=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 const created=await post('calendar',{title:'每日计划',date:'2026-09-24',duration:50});assert.equal(created.status,200);const {id}=await created.json();
 for(const [route,data] of [['progress',{id,progress:80,notes:'继续学习'}],['move',{id,direction:'up'}],['cancel',{id}]]){
  assert.equal((await post('calendar/'+route,data,{})).status,401);
  assert.equal((await post('calendar/'+route,data,{Authorization:'Bearer '+app.token})).status,401);
  assert.equal((await post('calendar/'+route,data,{Cookie:cookie,Authorization:'Bearer '+app.token})).status,403);
  assert.equal((await post('calendar/'+route,data)).status,200);
 }
 const e=app.store.calendar.state()[0];assert.equal(e.progress,80);assert.equal(e.cancelled,1);assert.equal(e.duration,50);
});
