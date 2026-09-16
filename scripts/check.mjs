import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
for(const dir of ['server','public','scripts','desktop','plugins/ai-teacher/scripts'])for(const file of readdirSync(dir)){if(!/\.(mjs|cjs|js)$/.test(file))continue;const result=spawnSync(process.execPath,['--check',join(dir,file)],{stdio:'inherit'});if(result.status)process.exit(result.status);}
for(const file of ['public/index.html','public/style.css','docs/openapi.json','plugins/ai-teacher/.mcp.template.json'])if(!existsSync(file))throw new Error('Missing '+file);
JSON.parse(readFileSync('plugins/ai-teacher/.mcp.template.json','utf8'));
JSON.parse(readFileSync('docs/openapi.json','utf8'));
console.log('Syntax and required assets verified. No frontend build step is needed.');
