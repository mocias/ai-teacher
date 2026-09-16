// Local protocol fixture only. Returns deterministic text; never calls a real model.
import http from 'node:http';
http.createServer(async(req,res)=>{
 if(req.url!=='/v1/chat/completions'||req.method!=='POST'){res.writeHead(404);res.end();return;}
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw);
 res.writeHead(200,{'Content-Type':'application/json'});
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:`本机模拟模型 ${body.model} 已收到测试消息。此回复仅用于验证路由，不代表 AI 教学结果。`}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
}).listen(4319,'127.0.0.1',()=>console.log('Local mock model ready on 4319'));
