import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomaticSearch,createPublicSearch,parseSearchRss,publicSourceUrl,searchProxy,requestSearchPage,publicSearchProviderId,PublicSearchError} from '../server/search-public.mjs';
import {teacherSearchPatches} from '../server/search-config.mjs';
import {registerTeacherSearch} from '../scripts/teacher-web-public.mjs';

const item=(url,title='A &amp; B',snippet='Source description')=>`<item><title>${title}</title><link>${url}</link><description>${snippet}</description><pubDate>Thu, 05 Nov 2026 08:45:00 GMT</pubDate></item>`;
const rss=items=>`<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`;

test('public RSS preserves actual source attribution, decodes text, deduplicates and caps',()=>{
 const result=parseSearchRss(rss(item('https://docs.python.org/3/?a=1&amp;b=2','Python &#x6587;&#26723;','<![CDATA[<b>Official</b> reference]]>')+item('https://docs.python.org/3/?a=1&amp;b=2')+item('https://www.python.org/')),1);
 assert.deepEqual(result,{sources:[{url:'https://docs.python.org/3/?a=1&b=2',title:'Python 文档',snippet:'Official reference'}],truncated:true});
 assert.equal('publishedAt' in result.sources[0],false,'feed dates must not claim document publication dates');
});

test('public search reports blocked, empty and malformed responses without invented sources',()=>{
 for(const [body,code] of [['<html><title>Captcha</title></html>','WEB_SEARCH_BLOCKED'],[rss(''),'WEB_SEARCH_EMPTY'],['<html>changed upstream</html>','WEB_SEARCH_UNEXPECTED_RESPONSE'],['<!DOCTYPE rss SYSTEM "file:///secret">'+rss(''),'WEB_SEARCH_UNEXPECTED_RESPONSE']])assert.throws(()=>parseSearchRss(body),e=>e.code===code);
 assert.throws(()=>parseSearchRss(rss(item('http://127.0.0.1/admin'))),e=>e.code==='WEB_SEARCH_EMPTY');
});

test('search sources reject local addresses, userinfo, active schemes and unusual numeric hosts',()=>{
 for(const url of ['file:///secret','javascript:alert(1)','http://localhost/a','https://a.local/a','http://192.168.1.1/a','http://2130706433/a','http://[::ffff:127.0.0.1]/a','https://user:secret@example.org/','https://intranet/a'])assert.equal(publicSourceUrl(url),null,url);
 assert.equal(publicSourceUrl('https://docs.python.org/3/#part'),'https://docs.python.org/3/');
});

test('public request bounds query, uses only fixed endpoint and app proxy, never follows sources',async()=>{
 const calls=[];const search=createPublicSearch({env:{HTTPS_PROXY:'http://127.0.0.1:7897'},requestPage:async(url,options)=>{calls.push({url,options});return rss(item('https://docs.python.org/3/'));}});
 const signal=new AbortController().signal;await search({query:'Python & web',maxResults:2},signal);
 assert.equal(calls.length,1);assert.equal(calls[0].url.origin,'https://www.bing.com');assert.equal(calls[0].url.pathname,'/search');assert.equal(calls[0].url.searchParams.get('q'),'Python & web');assert.equal(calls[0].url.searchParams.get('format'),'rss');assert.equal(calls[0].options.proxy.origin,'http://127.0.0.1:7897');assert.equal(calls[0].options.signal,signal);
 for(const query of ['', 'x'.repeat(2001),'private\nquery'])await assert.rejects(search({query}),e=>e.code==='WEB_SEARCH_QUERY_INVALID');
 await assert.rejects(search({query:'Python'},AbortSignal.abort()),e=>e.code==='WEB_ABORTED');assert.equal(calls.length,1);
 await assert.rejects(requestSearchPage(new URL('http://127.0.0.1/')),e=>e.code==='WEB_SEARCH_URL_BLOCKED');
 for(const proxy of ['http://remote.example/','http://user:secret@localhost/','socks5://127.0.0.1:7897','http://localhost/path'])assert.throws(()=>searchProxy({HTTPS_PROXY:proxy}),e=>e.code==='WEB_SEARCH_PROXY_INVALID');
});

test('automatic search uses native readiness and preserves configured credential failures',async()=>{
 let native=0,publicCalls=0,credentialReady=false,receivedRoute;
 const expected={sources:[{url:'https://native.example/'}],truncated:false};
 const provider={id:'deepseek-official',available:()=>true,ready:async route=>{receivedRoute=route;return credentialReady;},search:async()=>{native++;return expected;}};
 const web={searchProviders:new Map([[provider.id,provider]])};
 const auto=createAutomaticSearch(web,{route:()=> 'qoder-cn',searchPublic:async()=>{publicCalls++;return {sources:[{url:'https://public.example/'}],truncated:false};}});web.searchProviders.set(auto.id,auto);
 await auto.search({query:'Python'});assert.equal(native,0);assert.equal(publicCalls,1);assert.equal(receivedRoute,'qoder-cn');
 credentialReady=true;assert.equal(await auto.search({query:'Python'}),expected);assert.equal(native,1);assert.equal(publicCalls,1);
 provider.search=async()=>{throw Object.assign(Error('authentication rejected'),{code:'WEB_PROVIDER_ERROR'});};
 await assert.rejects(auto.search({query:'Python'}),e=>e.code==='WEB_PROVIDER_ERROR');assert.equal(publicCalls,1);
 web.searchProviders.set('another',{id:'another',available:()=>true,ready:async()=>true});
 await assert.rejects(auto.search({query:'Python'}),e=>e.code==='WEB_PROVIDER_AMBIGUOUS');assert.equal(publicCalls,1);
 await assert.rejects(auto.search({query:'Python'},AbortSignal.abort()),e=>e.code==='WEB_ABORTED');
});

test('search composition respects explicit selection and disabled configuration without mutation',()=>{
 for(const rows of [[{id:'web',config:{searchProvider:'native'}}],[{id:'web',disabled:true}],[{id:'web-search-deepseek',disabled:true}]])assert.equal(teacherSearchPatches(rows,{env:{}}),rows);
 const rows=[{id:'web',config:{fetchProvider:'http'}}],before=JSON.stringify(rows);
 assert.equal(teacherSearchPatches(rows,{env:{DSH_WEB_SEARCH_PROVIDER:'native'}}),rows);
 const patch=teacherSearchPatches(rows,{env:{}});assert.equal(JSON.stringify(rows),before);assert.equal(patch[0].config.searchProvider,publicSearchProviderId);assert.equal(patch[0].config.fetchProvider,'http');assert.match(patch[1].insert[0].name,/teacher-web-public\.mjs$/);
 assert.equal(teacherSearchPatches([],{env:{}})[0].config.searchProvider,publicSearchProviderId);
});

test('plugin translates only public adapter errors into the host native WebError identity',async()=>{
 class NativeWebError extends Error {constructor(message,code){super(message);this.code=code;}}
 const registry=new Map(),ctx={get:()=>undefined,web:{searchProviders:registry,registerSearchProvider(provider){registry.set(provider.id,provider);return()=>registry.delete(provider.id);}}};
 registerTeacherSearch(ctx,{WebError:NativeWebError,searchPublic:async()=>{throw new PublicSearchError('WEB_SEARCH_BLOCKED','需要人工验证');}});
 const automatic=registry.get(publicSearchProviderId);
 await assert.rejects(automatic.search({query:'Python'}),error=>error instanceof NativeWebError&&error.code==='WEB_SEARCH_BLOCKED'&&error.message==='需要人工验证');
 const nativeError=Object.assign(Error('native authentication failed'),{code:'WEB_PROVIDER_ERROR'});
 registry.set('native',{id:'native',available:()=>true,ready:async()=>true,search:async()=>{throw nativeError;}});
 await assert.rejects(automatic.search({query:'Python'}),error=>error===nativeError,'native errors must retain exact original identity');
});
