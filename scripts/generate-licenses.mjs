import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function generateLicenses(root=fileURLToPath(new URL('../',import.meta.url))){
 const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
 const rows=[],texts=[],missing=[];
 for(const [location,locked] of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b))){
  if(!location||locked.dev)continue;
  const dir=join(root,location),pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
  if(pkg.version!==locked.version)throw Error(`Installed version differs from lockfile: ${pkg.name}`);
  const files=readdirSync(dir,{withFileTypes:true}).filter(f=>f.isFile()&&/^(licen[cs]e|copying|notice)([.-]|$)/i.test(f.name)).map(f=>f.name).sort();
  if(!files.length)missing.push(pkg.name);
  rows.push(`| ${pkg.name} | ${pkg.version} | ${typeof pkg.license==='string'?pkg.license:'See package license'} |`);
  for(const file of files)texts.push(`\n${'='.repeat(72)}\n${pkg.name}@${pkg.version} / ${file}\n${'='.repeat(72)}\n\n${readFileSync(join(dir,file),'utf8')}`);
 }
 if(missing.length)throw Error('Missing package license/notice files: '+missing.join(', '));
 const nodeUrl=`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
 const response=await fetch(nodeUrl,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Could not retrieve Node license: '+response.status);
 const nodeLicense=await response.text();if(!nodeLicense.includes('Permission is hereby granted'))throw Error('Unexpected Node license response');
 const licenseDir=join(root,'licenses');mkdirSync(licenseDir,{recursive:true});
 writeFileSync(join(licenseDir,'Node-LICENSE.txt'),nodeLicense);
 writeFileSync(join(licenseDir,'npm-LICENSES.txt'),texts.join('\n'));
 const electron=JSON.parse(readFileSync(join(root,'node_modules/electron/package.json'),'utf8'));
 writeFileSync(join(licenseDir,'Electron-LICENSE.txt'),readFileSync(join(root,'node_modules/electron/LICENSE')));
 writeFileSync(join(root,'THIRD_PARTY_NOTICES.md'),`# Third-party notices\n\nAI Teacher's Apache-2.0 license applies to its original code. Third-party components retain their own copyright, licenses, and notices. This inventory does not relicense them.\n\n## Desktop runtimes\n\n- Node.js ${process.version}: exact upstream license and bundled-component notices are in [licenses/Node-LICENSE.txt](licenses/Node-LICENSE.txt), retrieved from ${nodeUrl}. The desktop build copies this alongside the bundled Node executable.\n- Electron ${electron.version}: [licenses/Electron-LICENSE.txt](licenses/Electron-LICENSE.txt). The distributed Electron runtime also carries its own LICENSE and LICENSES.chromium.html; retain both when redistributing the application folder.\n\n## Production npm dependencies\n\nGenerated from package-lock.json and installed package license/notice files. Full texts, including copyright notices, are preserved in [licenses/npm-LICENSES.txt](licenses/npm-LICENSES.txt). Build-only dependencies are not shipped with the application and are not listed below.\n\n| Package | Version | License declaration |\n| --- | --- | --- |\n${rows.join('\n')}\n\nRegenerate with \`npm run licenses:generate\` after dependency or runtime changes. Review any new license terms before distribution.\n`);
 return {packages:rows.length,node:process.version,electron:electron.version};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await generateLicenses());
