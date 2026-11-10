import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createAutomaticSearch,PublicSearchError} from '../server/search-public.mjs';

export const name='teacher-public-web-search';
export const inject=['web'];
// Resolve against the running installed DSH, so the thrown WebError shares the
// exact HarnessError identity its tool pipeline recognizes. Do not bundle or
// recreate the native error class in the Teacher application.
export async function loadNativeWebError(entry=process.argv[1]){
 const require=createRequire(entry),url=pathToFileURL(require.resolve('@deepseek-ai/dsh-web')).href;
 const {WebError}=await import(url);return WebError;
}
export function registerTeacherSearch(ctx,{WebError,searchPublic}={}){
 const provider=createAutomaticSearch(ctx.web,{searchPublic,route:()=>ctx.get('agents')?.currentInitiator()?.session.requestContext()?.provider});
 const search=provider.search;
 provider.search=async(request,signal)=>{try{return await search(request,signal);}catch(error){
  // Native authentication/provider failures must retain their original object,
  // cause and code. Only failures owned by this public-search adapter translate.
  if(error instanceof PublicSearchError)throw new WebError(error.message,error.code);
  throw error;
 }};
 return ctx.web.registerSearchProvider(provider);
}
export async function apply(ctx){
 return registerTeacherSearch(ctx,{WebError:await loadNativeWebError()});
}
