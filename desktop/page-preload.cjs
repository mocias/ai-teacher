const {ipcRenderer}=require('electron');
let timer,last='';
function location(){
 if(window.location.pathname==='/document.html')return;
 const headings=[...document.querySelectorAll('h1,h2,h3')];
 const h=headings.filter(x=>x.getBoundingClientRect().top<=180).at(-1)||headings[0];
 const value={url:window.location.href,title:document.title,location:h?.textContent?.trim().slice(0,300)||window.location.hash||'正文'};const key=JSON.stringify(value);if(key!==last){last=key;ipcRenderer.send('reader:location',value);}
}
addEventListener('DOMContentLoaded',location);
addEventListener('hashchange',location);
addEventListener('popstate',location);
addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(location,500);},{passive:true});

addEventListener('message',e=>{if(e.source===window&&e.data?.readerPosition)ipcRenderer.send('reader:location',e.data.readerPosition);});

addEventListener('DOMContentLoaded',()=>{if(window.location.pathname==='/document.html')return;new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(location,300);}).observe(document.documentElement,{childList:true,subtree:true,characterData:true});});
