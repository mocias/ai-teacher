import {stat,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Revalidate on every request so source edits and desktop upgrades are visible.
// The bounded cache holds public assets only, never API responses or documents.
export function staticAssets({maxBytes=32*1024*1024}={}) {
 const cache=new Map();let bytes=0;
 return async function serve(req,res,file,type) {
  const key=String(file),info=await stat(file),stamp=info.mtimeMs+':'+info.ctimeMs+':'+info.size;
  let asset=cache.get(key);
  if(!asset||asset.stamp!==stamp){
   const body=await readFile(file);
   asset={stamp,body,etag:'"'+createHash('sha256').update(body).digest('base64url')+'"'};
   if(cache.has(key)){bytes-=cache.get(key).body.length;cache.delete(key);}
   if(body.length<=maxBytes){
    while(bytes+body.length>maxBytes&&cache.size){const first=cache.keys().next().value;bytes-=cache.get(first).body.length;cache.delete(first);}
    cache.set(key,asset);bytes+=body.length;
   }
  }
  res.setHeader('Content-Type',type);res.setHeader('Cache-Control','private, no-cache');res.setHeader('ETag',asset.etag);
  if((req.headers['if-none-match']||'').split(',').some(tag=>tag.trim().replace(/^W\//,'')===asset.etag||tag.trim()==='*')){res.writeHead(304);res.end();return;}
  res.setHeader('Content-Length',asset.body.length);res.end(asset.body);
 };
}
