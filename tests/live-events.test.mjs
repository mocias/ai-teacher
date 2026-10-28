import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('one event connection coalesces bursts, serializes refreshes and pauses hidden views',async()=>{
 const source=await readFile(new URL('../public/live-events.js',import.meta.url),'utf8');
 let connections=0,nextTimer=1;const timers=new Map(),intervals=new Map();
 class FakeSource extends EventTarget {static OPEN=1;readyState=0;constructor(){super();connections++;}close(){this.readyState=2;}}
 const document=Object.assign(new EventTarget(),{hidden:false}),window=new EventTarget();
 const context={EventSource:FakeSource,document,window,Error,setTimeout:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),setInterval:fn=>{const id=nextTimer++;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id)};
 runInNewContext(source.replaceAll('export ','')+'\nglobalThis.result={liveEvents,watchUpdates};',context);
 const {liveEvents,watchUpdates}=context.result;let calls=0,release;
 const stop=watchUpdates(async()=>{calls++;await new Promise(r=>{release=r;});});
 const drain=async()=>{const queued=[...timers.values()];timers.clear();await Promise.all(queued.map(fn=>fn()));};
 liveEvents.readyState=1;liveEvents.dispatchEvent(new Event('open'));
 assert.equal(connections,1);assert.equal(timers.size,0,'initial SSE open must not duplicate the initial state fetch');
 for(let i=0;i<20;i++)liveEvents.dispatchEvent(new Event('message'));
 assert.equal(timers.size,1);const first=drain();assert.equal(calls,1);
 liveEvents.dispatchEvent(new Event('message'));await drain();assert.equal(calls,1,'refresh must not overlap');
 release();await first;assert.equal(timers.size,1);const second=drain();release();await second;assert.equal(calls,2);
 document.hidden=true;liveEvents.dispatchEvent(new Event('message'));assert.equal(timers.size,0);
 document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));const visible=drain();release();await visible;assert.equal(calls,3);
 for(const tick of intervals.values())tick();assert.equal(timers.size,0,'healthy SSE must not poll');
 liveEvents.readyState=0;for(const tick of intervals.values())tick();const fallback=drain();release();await fallback;assert.equal(calls,4);
 liveEvents.readyState=1;liveEvents.dispatchEvent(new Event('open'));const reconnected=drain();release();await reconnected;assert.equal(calls,5);
 stop();liveEvents.dispatchEvent(new Event('message'));assert.equal(timers.size,0);assert.equal(intervals.size,0);
 window.dispatchEvent(new Event('pagehide'));assert.equal(liveEvents.readyState,2);
});
