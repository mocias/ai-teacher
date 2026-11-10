import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import {isIP} from 'node:net';

export const publicSearchProviderId='teacher-search-auto';
const endpoint='https://www.bing.com/search';
const maxBytes=512*1024;
export class PublicSearchError extends Error {
 constructor(code,message){super(message);this.name='PublicSearchError';this.code=code;}
}
const failure=(code,message)=>new PublicSearchError(code,message);
const abortError=()=>failure('WEB_ABORTED','搜索已取消');

// Search only contacts this fixed public endpoint. Returned source URLs are
// references, never fetched here. The local HTTP(S) proxy is an explicit app
// network setting; CONNECT keeps TLS verification against Bing's hostname.
export function searchProxy(env=process.env){
 const value=env.HTTPS_PROXY||env.https_proxy||env.HTTP_PROXY||env.http_proxy||'';
 if(!value)return null;
 let url;try{url=new URL(value);}catch{throw failure('WEB_SEARCH_PROXY_INVALID','搜索代理地址无效');}
 if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw failure('WEB_SEARCH_PROXY_INVALID','搜索仅支持应用设置中的本机 HTTP(S) 代理');
 return url;
}

export function requestSearchPage(url,{signal,proxy=null,timeoutMs=20000,limitBytes=maxBytes}={}){
 if(url.origin!=='https://www.bing.com'||url.pathname!=='/search')return Promise.reject(failure('WEB_SEARCH_URL_BLOCKED','搜索地址不在允许范围内'));
 if(signal?.aborted)return Promise.reject(abortError());
 return new Promise((resolve,reject)=>{
  let settled=false,request,tunnel,secure;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);request?.destroy();tunnel?.destroy();secure?.destroy();error?reject(error):resolve(value);};
  const abort=()=>finish(abortError()),timer=setTimeout(()=>finish(failure('WEB_TIMEOUT','搜索超时，请检查网络或代理后重试')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  const failed=error=>finish(Object.assign(failure('WEB_PROVIDER_ERROR','公开搜索连接失败，请检查网络或代理后重试'),{cause:error}));
  function send(agent){
   if(settled)return;
   request=https.request(url,{method:'GET',agent,headers:{accept:'application/rss+xml, application/xml, text/xml','accept-encoding':'identity','user-agent':'AI-Teacher-Public-Search/1.0'}},response=>{
    let bytes=0;const chunks=[];
    if(response.statusCode===403||response.statusCode===429){response.resume();finish(failure('WEB_SEARCH_BLOCKED','公开搜索服务暂时限制访问，请稍后重试'));return;}
    if(response.statusCode!==200){response.resume();finish(failure('WEB_PROVIDER_ERROR','公开搜索服务未返回成功结果'));return;}
    if(!/^(?:application\/(?:rss\+xml|xml)|text\/xml)(?:;|$)/i.test(response.headers['content-type']||'')){response.resume();finish(failure('WEB_SEARCH_UNEXPECTED_RESPONSE','公开搜索服务未返回可解析的搜索结果'));return;}
    if(Number(response.headers['content-length'])>limitBytes){response.resume();finish(failure('WEB_RESPONSE_TOO_LARGE','搜索响应超过大小限制'));return;}
    response.on('data',chunk=>{bytes+=chunk.length;if(bytes>limitBytes){finish(failure('WEB_RESPONSE_TOO_LARGE','搜索响应超过大小限制'));return;}chunks.push(chunk);});
    response.on('end',()=>finish(null,Buffer.concat(chunks).toString('utf8')));
    response.on('error',failed);
   });
   request.on('error',failed);request.end();
  }
  if(!proxy){send(undefined);return;}
  const transport=proxy.protocol==='https:'?https:http;
  tunnel=transport.request(proxy,{method:'CONNECT',path:'www.bing.com:443',headers:{host:'www.bing.com:443'},agent:false});
  tunnel.on('error',failed);
  tunnel.on('connect',(response,socket,head)=>{
   if(settled){socket.destroy();return;}
   if(response.statusCode!==200||head.length){socket.destroy();finish(failure('WEB_SEARCH_PROXY_FAILED','本机代理未建立搜索连接'));return;}
   secure=tls.connect({socket,servername:'www.bing.com',rejectUnauthorized:true});
   secure.once('error',failed);
   secure.once('secureConnect',()=>{
    if(settled)return;
    const agent=new https.Agent({keepAlive:false});
    agent.createConnection=()=>secure;
    send(agent);
   });
  });
  tunnel.end();
 });
}

function xmlText(value){
 return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(all,entity)=>{
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(entity[0]!=='#')return named[entity.toLowerCase()]||all;
  const point=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
  return point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):'';
 }).replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
}
export function publicSourceUrl(value){
 let url;try{url=new URL(value);}catch{return null;}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(value.length>4096||!['http:','https:'].includes(url.protocol)||url.username||url.password||isIP(host)||host.startsWith('[')||!host.includes('.')||/(?:^|\.)(?:localhost|local|internal|onion|test|invalid)$/.test(host))return null;
 url.hash='';return url.href;
}

// Bing's public RSS response uses a small, flat item vocabulary. This parser
// deliberately does not process DTDs, external entities, HTML, or active content.
export function parseSearchRss(xml,maxResults=6){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw failure('WEB_SEARCH_UNEXPECTED_RESPONSE','公开搜索响应包含不支持的内容');
 if(/anomaly-modal|challenge-form|<title>[^<]*(?:captcha|verify|challenge)/i.test(xml))throw failure('WEB_SEARCH_BLOCKED','公开搜索需要人工验证，请稍后重试');
 if(!/^\s*(?:<\?xml[^>]*>\s*)?<rss\b/i.test(xml)||!/<channel\b[^>]*>[\s\S]*<\/channel>\s*<\/rss>\s*$/i.test(xml))throw failure('WEB_SEARCH_UNEXPECTED_RESPONSE','公开搜索响应格式发生变化');
 const sources=[],seen=new Set();let count=0;
 for(const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
  if(++count>100)throw failure('WEB_SEARCH_UNEXPECTED_RESPONSE','公开搜索响应条目过多');
  const field=name=>xmlText(match[1].match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]||'');
  const url=publicSourceUrl(field('link'));if(!url||seen.has(url))continue;seen.add(url);
  sources.push({url,...field('title')?{title:field('title').slice(0,300)}:{},...field('description')?{snippet:field('description').slice(0,1200)}:{}});
 }
 if(!sources.length)throw failure('WEB_SEARCH_EMPTY','公开搜索未返回可用来源，请换一个查询后重试');
 // RSS pubDate is Bing's feed timestamp, not a verified publication date.
 return {sources:sources.slice(0,maxResults),truncated:sources.length>maxResults};
}

export function createPublicSearch({env=process.env,requestPage=requestSearchPage}={}){
 return async function search(request,signal){
  if(signal?.aborted)throw abortError();
  const query=typeof request?.query==='string'?request.query.trim():'';
  if(!query||query.length>2000||/[\x00-\x1f\x7f]/.test(query))throw failure('WEB_SEARCH_QUERY_INVALID','搜索词必须为 1 到 2000 个字符');
  const max=request.maxResults??6;if(!Number.isInteger(max)||max<1||max>20)throw failure('WEB_SEARCH_QUERY_INVALID','搜索结果数量必须为 1 到 20');
  const url=new URL(endpoint);url.search=new URLSearchParams({format:'rss',q:query}).toString();
  const xml=await requestPage(url,{signal,proxy:searchProxy(env)});
  return parseSearchRss(xml,max);
 };
}

// The native registry considers a resolver's existence "available" even when
// its credential is absent. Ask ready() first, without reading/logging keys.
// Configured credentials keep priority; their network/auth errors stay visible.
export function createAutomaticSearch(web,{searchPublic=createPublicSearch(),route=()=>undefined}={}){
 return {id:publicSearchProviderId,available:()=>true,ready:async()=>true,async search(request,signal){
  if(signal?.aborted)throw abortError();
  const ready=[];
  for(const provider of web.searchProviders.values()){
   if(provider.id===publicSearchProviderId||!provider.available())continue;
   if(await provider.ready?.(route())??true)ready.push(provider);
  }
  if(ready.length>1)throw failure('WEB_PROVIDER_AMBIGUOUS','多个已配置的搜索服务可用，请在 DSH 中明确选择搜索服务');
  return ready.length?ready[0].search(request,signal):searchPublic(request,signal);
 }};
}
