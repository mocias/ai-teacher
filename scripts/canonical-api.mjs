// User-session HTTP operations introduced with the Canonical V1 learning workflows.
const text={type:'string'}, int={type:'integer'}, flag={type:'boolean'}, list={type:'array',items:text};
const security=[{UserSession:[]}];
const responses={'200':{description:'操作结果'},'400':{description:'请求无效'},'401':{description:'需要工作台用户会话'},'409':{description:'状态已变化或不符合该操作的条件'}};
function post(summary,properties,required=Object.keys(properties)){
  return {post:{summary,security,requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties,required}}}},responses}};
}
function get(summary,parameters=[]){return {get:{summary,security,parameters,responses}};}
const weekSettings={revision:int,daily_minutes:int,session_minutes:int,review_minutes:int,weekdays:{type:'array',items:int},domain_priority:list};
const week={...weekSettings,start_date:{type:'string',format:'date'},tz_offset:int};
const sessionChange={session_id:text,reason:text};
const topic={proposal_id:text,topic_key:text,reason:text};
const openSearch={assessment_id:text,scope:{enum:['CURRENT','ALL']}};
export const canonicalPaths={
 '/api/planning-flow/start':post('从指定目标对话开始整理正式学习路线',{goal_id:text,conversation_id:text,request_id:text}),
 '/api/planning-flow/control':post('暂缓、停止或继续该对话的路线整理',{goal_id:text,conversation_id:text,action:{enum:['LATER','STOP','RESUME']},expected_revision:text,request_id:text}),
 '/api/planning-flow/diagnostic':post('从当前规划对话开始或继续本版正式初诊',{goal_id:text,conversation_id:text,capability_set_id:text,request_id:text}),
 '/api/planning-flow/decide':post('审阅这一规划对话中仍有效的指定提案',{goal_id:text,conversation_id:text,proposal_id:text,accept:flag,request_id:text}),
 '/api/planning-flow/revise':post('根据学习者的修改意见重新整理指定提案',{goal_id:text,conversation_id:text,proposal_id:text,feedback:text,expected_revision:text,request_id:text}),
 '/api/planning-flow/rework':post('按学习者明确要求重新整理未产生提案的任务',{goal_id:text,conversation_id:text,job_id:text,expected_revision:text,request_id:text}),
 '/api/planning-flow/retry':post('明确重试当前规划流程受阻的指定任务',{goal_id:text,conversation_id:text,job_id:text,expected_revision:text,request_id:text}),
 '/api/weekly-study':get('按本地自然周查看各领域与全局的计划、复习和作答证据',[{name:'start_date',in:'query',schema:text},{name:'tz_offset',in:'query',schema:int}]),
 '/api/adaptive-review/settings':post('设置整体复习强度，可启用按后续作答自动安排复习',{intensity:{enum:['LIGHT','STANDARD','INTENSIVE']},auto_enabled:flag,request_id:text}),
 '/api/adaptive-review/accept':post('采用有实际作答依据的复习建议',{goal_id:text,source_assessment_id:text,requirement_id:text,due_date:text,request_id:text},['goal_id','source_assessment_id','requirement_id','request_id']),
 '/api/week-plan/settings':{...get('读取自然周学习容量、工作日和领域优先次序'),...post('保存周排期设置',{...weekSettings,request_id:text},['revision','request_id'])},
 '/api/week-plan/preview':post('按已有日程、复习容量、领域优先级预览本周日期与理由',week,['start_date']),
 '/api/week-plan/commit':post('原子采纳未过期的周排期预览，保留既有日程及复习',{...week,fingerprint:text,request_id:text},['start_date','fingerprint','request_id']),
 '/api/rolling-plan/settings':post('设置全局近期数、领域覆盖数与目标优先级',{revision:int,global_limit:int,domain_limits:{type:'object',additionalProperties:int},goal_order:list},['revision']),
 '/api/rolling-plan/defer':post('延后近期学习任务，保留原任务与学习记录',sessionChange,['session_id']),
 '/api/rolling-plan/remove':post('从未来安排中移除单个任务',sessionChange,['session_id']),
 '/api/rolling-plan/restore':post('恢复先前延后或移除的任务',{session_id:text}),
 '/api/rolling-plan/exclude-topic':post('排除主题，保留历史与原路线记录',topic,['proposal_id','topic_key']),
 '/api/rolling-plan/restore-topic':post('恢复排除的路线主题',{proposal_id:text,topic_key:text}),
 '/api/material-map/resolve':post('采用一份来源正文或说明两份材料不构成冲突，保存理由及裁决历史',{goal_id:text,conflict_id:text,decision:{enum:['ADOPTED','NO_CONFLICT']},source_content_id:text,note:text,request_id:text},['goal_id','conflict_id','decision','note','request_id']),
 '/api/notes/verification/start':post('用户同意为当前版本笔记启动验证',{invite_id:text,request_id:text}),
 '/api/notes/verification/defer':post('暂缓本版本的可选验证邀请',{invite_id:text,days:int},['invite_id']),
 '/api/notes/verification/decline':post('忽略本版本笔记验证邀请',{invite_id:text}),
 '/api/open-book/search':post('开卷考察中检索用户输入的词，返回原文片段和来源',{...openSearch,query:text},['assessment_id','query']),
 '/api/open-book/read':post('读取开卷考察授权范围内的笔记或资料快照',{...openSearch,id:text,type:{enum:['note','material']}},['assessment_id','id','type']),
 '/api/open-book/save-draft':post('明确保存用户草稿并关联来源考察',{assessment_id:text,title:text,content:text,request_id:text,pending_draft:flag},['assessment_id','title','content']),
 '/api/knowledge-profile':get('读取长期画像；显式请求完整视图可回查原回答',[{name:'full',in:'query',schema:{type:'string',enum:['0','1']}}]),
 '/api/knowledge-profile/topic-decide':post('采纳或拒绝主题拆分或合并提案，保留历史归属',{proposal_id:text,accept:flag,request_id:text}),
 '/api/knowledge-profile/topics':post('创建领域内的知识主题',{domain:text,name:text,description:text,request_id:text},['domain','name','request_id']),
 '/api/knowledge-profile/node-topic':post('将现有知识点归入本领域主题并记录原因',{node_id:text,topic_id:text,reason:text,request_id:text}),
 '/api/knowledge-profile/decide':post('用户采纳或拒绝有依据的知识画像整理提案',{proposal_id:text,accept:flag,request_id:text}),
};
