// Catalog-only benchmark. Reads existing DSH configuration and plugin metadata;
// no inference request or real learning database is used.
import {createDshModelDirectory} from '../server/dsh-model-directory.mjs';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root=mkdtempSync(join(tmpdir(),'teacher-catalog-speed-')),runtimeHome=join(root,'runtime');let directory=createDshModelDirectory({runtimeHome});
try{
 const start=performance.now(),first=directory.list(),firstMs=performance.now()-start;assert.equal(first instanceof Promise,false);
 const catalog=await directory.refresh(),fullMs=performance.now()-start;assert.equal(catalog.discovery,'runtime');assert.ok(catalog.models.length);
 await directory.close();let boot=performance.now();directory=createDshModelDirectory({runtimeHome});const restored=directory.list(),restartMs=performance.now()-boot;assert.equal(restored.models.length,catalog.models.length);
 const times=[];for(let i=0;i<20;i++){const t=performance.now();directory.list();times.push(performance.now()-t);}
 const report={firstImmediateListMs:Math.round(firstMs*100)/100,firstFullRegistryMs:Math.round(fullMs*100)/100,restartWithDiskCacheMs:Math.round(restartMs*100)/100,warmListMeanMs:Math.round(times.reduce((a,b)=>a+b,0)/times.length*100)/100,models:restored.models.length,noInference:true};
 mkdirSync('outputs',{recursive:true});writeFileSync('outputs/dsh-catalog-speed-v0142.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await directory.close();rmSync(root,{recursive:true,force:true});}
