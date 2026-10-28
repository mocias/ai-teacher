// One connection per document, shared by state updates and reply previews.
export const liveEvents = new EventSource('/api/events');
let revision=0;
liveEvents.addEventListener('message',()=>revision++);

export function watchUpdates(refresh, {onError = () => {}, onOpen = () => {}, active = () => !document.hidden, delay = 100, fallbackMs = 60000} = {}) {
 let timer, running = false, pending = false, stopped = false, connected = liveEvents.readyState === EventSource.OPEN;
 const drain = async () => {
  timer = null;
  if (stopped || !active()) return;
  if (running) { pending = true; return; }
  running = true;
  try { await refresh(); } catch (error) { onError(error); }
  finally { running = false; if (pending) { pending = false; schedule(); } }
 };
 const schedule = () => { if (!stopped && active() && !timer) timer = setTimeout(drain, delay); };
 const open = () => { onOpen(); if (connected) schedule(); connected = true; };
 const error = () => { connected=true; onError(new Error('本地服务连接中断，正在重连')); };
 liveEvents.addEventListener('message', schedule);
 liveEvents.addEventListener('open', open);
 liveEvents.addEventListener('error', error);
 document.addEventListener('visibilitychange', schedule);
 // Catch changes that arrived while the page's initial requests were in flight.
 if(revision) schedule();
 // SSE is authoritative while connected; polling is only a recovery fallback.
 let day=new Date().toDateString();
 const fallback = setInterval(() => { const nextDay=new Date().toDateString();if(liveEvents.readyState!==EventSource.OPEN||nextDay!==day){schedule();if(active())day=nextDay;} }, fallbackMs);
 const stop = () => {
  stopped = true; clearTimeout(timer); clearInterval(fallback);
  liveEvents.removeEventListener('message', schedule); liveEvents.removeEventListener('open', open); liveEvents.removeEventListener('error', error);
  document.removeEventListener('visibilitychange', schedule);
 };
 window.addEventListener('pagehide', stop, {once:true});
 return stop;
}
window.addEventListener('pagehide', () => liveEvents.close(), {once:true});
