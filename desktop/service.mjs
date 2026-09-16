import {startServer} from '../server/index.mjs';
const service=startServer({port:process.env.TEACHER_DESKTOP_SMOKE==='1'?0:4317});
service.server.on('listening',()=>process.send?.({type:'ready',url:`http://127.0.0.1:${service.server.address().port}`}));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await service.close();process.exit(0);}
process.on('message',m=>{if(m.type==='stop')stop();});
process.on('disconnect',stop);
