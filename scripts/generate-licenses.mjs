import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export async function nodeLicense(root,{offline=false,fetcher=fetch}={}){
 const url=`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
 let content;
 if(offline){
  const meta=JSON.parse(readFileSync(join(root,'licenses/Node-LICENSE.meta.json'),'utf8'));
  content=readFileSync(join(root,'licenses/Node-LICENSE.txt'),'utf8');
  if(meta.version!==process.version||meta.url!==url||meta.sha256!==createHash('sha256').update(content).digest('hex'))throw Error('Cached Node license does not match this runtime or file hash');
 }else{
  const response=await fetcher(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Could not retrieve Node license: '+response.status);
  content=await response.text();
 }
 if(!content.startsWith('Node.js is licensed')||!content.includes('Permission is hereby granted'))throw Error('Unexpected Node license response');
 return {content,meta:{version:process.version,url,sha256:createHash('sha256').update(content).digest('hex')}};
}

export async function generateLicenses(root=fileURLToPath(new URL('../',import.meta.url))){
 const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
 const rows=[],texts=[],missing=[];
 for(const [location,locked] of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b))){
  if(!location||locked.dev)continue;
  const dir=join(root,location);if(locked.optional&&!existsSync(join(dir,'package.json')))continue;const pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
  if(pkg.version!==locked.version)throw Error(`Installed version differs from lockfile: ${pkg.name}`);
  const files=readdirSync(dir,{withFileTypes:true}).filter(f=>f.isFile()&&/^(licen[cs]e|copying|notice)([.-]|$)/i.test(f.name)).map(f=>f.name).sort();
  if(!files.length&&pkg.name.startsWith('@napi-rs/canvas-')){
   // The platform binary package and parent wrapper are published together from the same repository.
   const parentDir=join(root,'node_modules/@napi-rs/canvas'),parent=JSON.parse(readFileSync(join(parentDir,'package.json'),'utf8'));
   if(parent.version===pkg.version&&parent.repository?.url===pkg.repository?.url&&parent.license===pkg.license){texts.push(`\n${pkg.name}@${pkg.version} / upstream @napi-rs/canvas LICENSE (same version and repository)\n\n${readFileSync(join(parentDir,'LICENSE'),'utf8')}`);}else missing.push(pkg.name);
  }else if(!files.length)missing.push(pkg.name);
  rows.push(`| ${pkg.name} | ${pkg.version} | ${typeof pkg.license==='string'?pkg.license:'See package license'} |`);
  for(const file of files)texts.push(`\n${'='.repeat(72)}\n${pkg.name}@${pkg.version} / ${file}\n${'='.repeat(72)}\n\n${readFileSync(join(dir,file),'utf8')}`);
 }
 if(missing.length)throw Error('Missing package license/notice files: '+missing.join(', '));
 const cached=process.env.TEACHER_OFFLINE_LICENSES==='1',node=await nodeLicense(root,{offline:cached}),nodeUrl=node.meta.url;
 if(cached)console.log('Using cached Node license verified against runtime version and SHA-256.');
 const licenseDir=join(root,'licenses');mkdirSync(licenseDir,{recursive:true});
 writeFileSync(join(licenseDir,'Node-LICENSE.txt'),node.content);
 writeFileSync(join(licenseDir,'Node-LICENSE.meta.json'),JSON.stringify(node.meta,null,2)+'\n');
 writeFileSync(join(licenseDir,'npm-LICENSES.txt'),texts.join('\n').replace(/[ \t]+$/gm,''));
 const electron=JSON.parse(readFileSync(join(root,'node_modules/electron/package.json'),'utf8'));
 writeFileSync(join(licenseDir,'Electron-LICENSE.txt'),readFileSync(join(root,'node_modules/electron/LICENSE')));
 writeFileSync(join(root,'THIRD_PARTY_NOTICES.md'),`# Third-party notices\n\nAI Teacher's Apache-2.0 license applies to its original code. Third-party components retain their own copyright, licenses, and notices. This inventory does not relicense them.\n\n## Desktop runtimes\n\n- Node.js ${process.version}: exact upstream license and bundled-component notices are in [licenses/Node-LICENSE.txt](licenses/Node-LICENSE.txt), retrieved from ${nodeUrl}. The desktop build copies this alongside the bundled Node executable.\n- Electron ${electron.version}: [licenses/Electron-LICENSE.txt](licenses/Electron-LICENSE.txt). The distributed Electron runtime also carries its own LICENSE and LICENSES.chromium.html; retain both when redistributing the application folder.\n\n## Production npm dependencies\n\nGenerated from package-lock.json and installed package license/notice files. Full texts, including copyright notices, are preserved in [licenses/npm-LICENSES.txt](licenses/npm-LICENSES.txt). Build-only dependencies are not shipped with the application and are not listed below.\n\n| Package | Version | License declaration |\n| --- | --- | --- |\n${rows.join('\n')}\n\nRegenerate with \`npm run licenses:generate\` after dependency or runtime changes. Review any new license terms before distribution.\n`);
 return {packages:rows.length,node:process.version,electron:electron.version};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await generateLicenses());
