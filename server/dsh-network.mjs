import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
export function dshNetwork(dataDir){
 const file=join(dataDir,'dsh-network.json');
 const validate=value=>{if(value==='')return '';let url;try{url=new URL(value);}catch{throw Error('代理地址格式无效');}if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('请填写本机 HTTP 代理，例如 http://127.0.0.1:7897');return url.origin;};
 const get=()=>{if(!existsSync(file))return {proxy_url:''};const raw=readFileSync(file,'utf8');if(raw.length>5000)throw Error('DSH 网络设置过大');return {proxy_url:validate(JSON.parse(raw).proxy_url||'')};};
 const set=value=>{const result={proxy_url:validate(String(value??''))},tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(result),{mode:0o600});renameSync(tmp,file);return result;};
 const env=()=>{const {proxy_url}=get();return proxy_url?{HTTP_PROXY:proxy_url,HTTPS_PROXY:proxy_url,http_proxy:proxy_url,https_proxy:proxy_url,NO_PROXY:'localhost,127.0.0.1,::1',no_proxy:'localhost,127.0.0.1,::1'}:{};};
 return {get,set,env};
}
