// Packaging-only exclusions. Keep the development install and lockfile intact.
// PDF.js runs in the browser (public/document.js), which already has Canvas;
// its optional Node/Skia renderer and legacy browser build are not used.
export function redundantDependency(path){
 const relative=path.replace(/^[\\/]/,'').replaceAll('\\','/');
 if(!relative.startsWith('node_modules/'))return false;
 const parts=relative.slice('node_modules/'.length).split('/');
 const name=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];
 const inner=parts.slice(name.startsWith('@')?2:1);
 if(/^@napi-rs\/canvas(?:-|$)/.test(name))return true;
 if(name==='.package-lock.json')return true;
 const file=inner.at(-1)||'';
 // Never strip copyright/license notices, including notices next to PDF fonts.
 if(/^(licen[cs]e|copying|notice|copyright)([.-]|$)/i.test(file))return false;
 if(/\.map$|\.d\.(?:ts|cts|mts)$/.test(file))return true;
 if(inner.some(part=>['test','tests','__tests__','fixtures','examples'].includes(part)))return true;
 if(name==='pdfjs-dist'){
  if(!inner.length)return false;
  if(inner.length===1&&['package.json','build','cmaps','standard_fonts','wasm'].includes(file))return false;
  if(['cmaps','standard_fonts','wasm'].includes(inner[0]))return false;
  if(inner[0]==='build'&&inner.length===2&&['pdf.mjs','pdf.worker.mjs'].includes(file))return false;
  return true;
 }
 return false;
}
