import {marked} from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
const cache=new Map();let cacheSize=0;

export const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function messageContent(message){
 if(message.role==='user')return `<div class="user-text">${escapeText(message.content)}</div>`;
 const key=String(message.content??'');
 if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
 const html=DOMPurify.sanitize(marked.parse(String(message.content??''),{gfm:true,breaks:true}),{
  FORBID_TAGS:['style','script','iframe','form','input','button','textarea','select','video','audio','img','svg','math'],
  ALLOWED_ATTR:['href','title','start','align'],ALLOW_DATA_ATTR:false,
 });
 const template=document.createElement('template');template.innerHTML=html;
 for(const table of template.content.querySelectorAll('table')){const wrap=document.createElement('div');wrap.className='markdown-table';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','回复中的表格');table.replaceWith(wrap);wrap.append(table);}
 for(const link of template.content.querySelectorAll('a')){const href=link.getAttribute('href')||'';if(!/^(https?:|mailto:|\/|#)/i.test(href)||href.startsWith('//'))link.removeAttribute('href');else{link.target='_blank';link.rel='noopener noreferrer';}}
 const result=`<div class="markdown-body">${template.innerHTML}</div>`,size=key.length+result.length;
 if(size<=500000){while(cache.size&&(cache.size>=160||cacheSize+size>2000000)){const first=cache.keys().next().value;cacheSize-=first.length+cache.get(first).length;cache.delete(first);}cache.set(key,result);cacheSize+=size;}
 return result;
}
