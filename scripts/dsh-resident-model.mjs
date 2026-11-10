// Enforce the site's frozen per-job route before ACP inspects the resumed
// Session's old model. This appends native model-selection history; no replay
// records or transcript contents are rewritten.
export const name='teacher-resident-model';
export const inject=['agents'];
export function apply(ctx,config={}){
 ctx.on('agent/created',({agent})=>{
  if(agent?.session?.header?.origin==='subagent'||!config.selection)return;
  const current=agent.model.current(),selected=config.selection;
  if(current?.provider!==selected.provider||current?.model!==selected.model||current?.reasoningEffort!==selected.reasoningEffort)agent.model.select(selected);
 });
 ctx.provide('teacherResidentModelReady',true);
}
