const assert=require('node:assert/strict');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');

// Two pages with a standard, unembedded font. This exercises the shipped worker,
// standard font data, raster output, text layer and page navigation without Office.
function samplePdf(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 for(const text of ['Packaged PDF first page','Packaged PDF second page']){
  const stream=`BT /F1 18 Tf 30 240 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
 }
 let pdf='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
 for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
 return Buffer.from(pdf+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

exports.run=async(main)=>{
 const exec=code=>main.webContents.executeJavaScript(code);
 const until=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,75));}throw Error('PDF smoke timed out: '+label);};
 const input={title:'Packaged PDF',file:{name:'packaged.pdf',base64:samplePdf().toString('base64')}};
 const saved=await exec(`fetch('/api/resources',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(input))}}).then(async r=>{if(!r.ok)throw Error(await r.text());return r.json();})`);
 await exec(`window.teacherDesktop.openReader(${JSON.stringify(saved.id)})`);
 const view=await until(()=>main.contentView.children.find(v=>v.webContents?.getURL().includes('/document.html?id='+saved.id)),'document view');
 const page=code=>view.webContents.executeJavaScript(code);
 await until(()=>page(`window.readerDocument?.snapshot().content.includes('Packaged PDF first page')`),'first page text');
 assert.equal(await page(`document.querySelector('#error').textContent`),'');
 assert.ok(await page(`document.querySelector('.textLayer').textContent.includes('Packaged PDF first page')`));
 const ink=await page(`(()=>{const c=document.querySelector('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<d.length;i+=4)if(d[i+3]>200&&d[i]<100&&d[i+1]<100&&d[i+2]<100)dark++;return dark;})()`);
 assert.ok(ink>50,'PDF canvas contains visible text');
 for(const asset of ['/vendor/cmaps/UniGB-UCS2-H.bcmap','/vendor/standard_fonts/LiberationSans-Regular.ttf','/vendor/wasm/openjpeg.wasm']){
  assert.equal(await page(`fetch(${JSON.stringify(asset)}).then(r=>r.status)`),200,asset);
 }
 await page(`document.querySelector('#next').click()`);
 await until(()=>page(`window.readerDocument.snapshot().content.includes('Packaged PDF second page')`),'second page text');
 assert.equal(await page(`document.querySelector('#page').value`),'2');
 await until(()=>exec(`fetch('/api/state').then(r=>r.json()).then(s=>s.study.progress.some(p=>p.resource_id===${JSON.stringify(saved.id)}&&p.location==='第 2 页'))`),'saved page position');
 if(process.env.TEACHER_SMOKE_OUTPUT){const image=await page(`document.querySelector('canvas').toDataURL('image/png')`);writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'pdf-page.png'),Buffer.from(image.split(',')[1],'base64'));}
 console.log('PDF_SMOKE_OK '+JSON.stringify({pages:2,textLayer:true,rasterInk:ink,fontAndCmapAssets:true,pagePositionSaved:true}));
};
