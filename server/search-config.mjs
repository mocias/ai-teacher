import {pathToFileURL,fileURLToPath} from 'node:url';
import {publicSearchProviderId} from './search-public.mjs';

// Compose this into either a resident or isolated DSH host. Never write the
// user's global settings or override their explicit search selection/disable.
export function teacherSearchPatches(webConfig=[],{env=process.env}={}){
 const web=webConfig.find(row=>row.id==='web'),search=web?.config?.searchProvider;
 if(web?.disabled||typeof search==='string'&&search.length||env.DSH_WEB_SEARCH_PROVIDER||webConfig.some(row=>['web-search-deepseek','web-deepseek-api'].includes(row.id)&&row.disabled))return webConfig;
 const rows=webConfig.map(row=>row.id==='web'?{...row,config:{...row.config,searchProvider:publicSearchProviderId}}:row);
 if(!web)rows.push({id:'web',config:{searchProvider:publicSearchProviderId}});
 rows.push({insert:[{id:'teacher-public-web-search',name:pathToFileURL(fileURLToPath(new URL('../scripts/teacher-web-public.mjs',import.meta.url))).href}]});
 return rows;
}
