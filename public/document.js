import {getDocument,GlobalWorkerOptions,TextLayer} from '/vendor/pdf.mjs';
import {marked} from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
const id=new URLSearchParams(location.search).get('id'),root=document.querySelector('#document-body'),pageInput=document.querySelector('#page'),outline=document.querySelector('#outline');
let pdf,page=1,title='',pageText='',chapter='',busy=false,headings=[];
const api=async p=>{const r=await fetch('/api/'+p);if(!r.ok)throw Error((await r.json()).error);return r.json();};
function position(){return {title,location:pdf?'第 '+page+' 页':chapter||'正文'};}
function emit(){window.postMessage({readerPosition:position()},location.origin);}
function snapshot(){return {...position(),url:'',selection:String(getSelection()).slice(0,10000),content:pageText.slice(0,45000)};}
window.readerDocument={position,snapshot};
async function render(){if(busy||!pdf)return;busy=true;try{const p=await pdf.getPage(page),viewport=p.getViewport({scale:Math.min(1.6,(innerWidth-55)/p.getViewport({scale:1}).width)});root.replaceChildren();const wrap=document.createElement('div');wrap.className='pdf-page';wrap.style.width=viewport.width+'px';wrap.style.height=viewport.height+'px';root.append(wrap);const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;wrap.append(canvas);await drawPage(p,canvas,viewport);const text=await p.getTextContent();pageText=text.items.map(x=>x.str||'').join(' ');const layer=document.createElement('div');layer.className='textLayer';layer.style.setProperty('--scale-factor',viewport.scale);layer.style.setProperty('--total-scale-factor',viewport.scale);wrap.append(layer);await new TextLayer({textContentSource:text,container:layer,viewport}).render();pageInput.value=page;document.querySelector('#count').textContent='/ '+pdf.numPages;emit();}finally{busy=false;}}
const error=e=>document.querySelector('#error').textContent=e.message;
async function go(n){if(!pdf||busy)return;page=Math.min(pdf.numPages,Math.max(1,n||1));await render();scrollTo(0,0);}
document.querySelector('#prev').onclick=()=>go(page-1).catch(error);document.querySelector('#next').onclick=()=>go(page+1).catch(error);pageInput.onchange=()=>go(Number(pageInput.value)).catch(error);
outline.onchange=async()=>{try{if(pdf){const dest=typeof outline.value==='string'?await pdf.getDestination(outline.value):null;if(dest)await go(typeof dest[0]==='number'?dest[0]+1:(await pdf.getPageIndex(dest[0]))+1);else if(outline.selectedOptions[0]?.dataset.page)await go(Number(outline.selectedOptions[0].dataset.page));}else document.getElementById(outline.value)?.scrollIntoView();}catch(e){error(e);}};
try{
 const state=await api('state'),file=state.resource_files.find(f=>f.resource_id===id),resource=state.resources.find(r=>r.id===id);title=resource?.title||'资料';document.title=title;const old=state.study.progress.find(p=>p.resource_id===id);
 const response=await fetch('/api/reader-file?id='+encodeURIComponent(id));if(!response.ok)throw Error((await response.json()).error);
 if(/\.(md|markdown)$/i.test(file?.name||'')){
  const text=await response.text();root.innerHTML=DOMPurify.sanitize(marked.parse(text),{FORBID_TAGS:['iframe','form','input','script','style']});headings=[...root.querySelectorAll('h1,h2,h3,h4')];headings.forEach((h,i)=>{h.id='chapter-'+i;const o=document.createElement('option');o.value=h.id;o.textContent=h.textContent;outline.append(o);});
  for(const el of [pageInput,document.querySelector('#prev'),document.querySelector('#next')])el.hidden=true;
  const track=()=>{const h=headings.filter(h=>h.getBoundingClientRect().top<150).at(-1)||headings[0];chapter=h?.textContent||'正文';const next=h?headings[headings.indexOf(h)+1]:null;let text='';if(h){for(let el=h;el&&el!==next;el=el.nextElementSibling)text+=el.innerText+'\n';}else text=root.innerText;pageText=text;emit();};
  let timer;addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(track,250);},{passive:true});headings.find(h=>h.textContent===old?.location)?.scrollIntoView();track();
 }else{
  pdf=await getDocument({data:new Uint8Array(await response.arrayBuffer()),isEvalSupported:false,cMapUrl:'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/standard_fonts/',wasmUrl:'/vendor/wasm/'}).promise;page=Math.min(pdf.numPages,Number(old?.location?.match(/\d+/)?.[0])||1);const items=await pdf.getOutline();async function add(items,depth=0){for(const x of items||[]){const o=document.createElement('option');o.textContent='　'.repeat(depth)+x.title;if(typeof x.dest==='string')o.value=x.dest;else if(Array.isArray(x.dest)){o.value='page-'+outline.length;o.dataset.page=typeof x.dest[0]==='number'?x.dest[0]+1:(await pdf.getPageIndex(x.dest[0]))+1;}outline.append(o);await add(x.items,depth+1);}}await add(items);await render();
 }
 root.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&/^https?:/.test(a.href)){e.preventDefault();window.open(a.href,'_blank');}});
}catch(e){error(e);}

async function drawPage(p,canvas,viewport){
 // Chromium may suspend animation-frame callbacks for an occluded native view.
 // PDF.js print intent uses its immediate scheduler; use it only when display rendering stalls.
 const task=p.render({canvasContext:canvas.getContext('2d'),viewport});let stalled=false;
 const timer=setTimeout(()=>{stalled=true;task.cancel();},2500);
 try{await task.promise;}catch(e){if(!stalled)throw e;await p.render({canvasContext:canvas.getContext('2d'),viewport,intent:'print'}).promise;}finally{clearTimeout(timer);}
}
