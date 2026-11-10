import {z} from 'zod';
import {createHash} from 'node:crypto';

export const messageChoiceSchema=z.object({type:z.enum(['SINGLE','MULTIPLE']),options:z.array(z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),text:z.string().trim().min(1).max(2000)}).strict()).min(2).max(8)}).strict().superRefine((v,ctx)=>{if(new Set(v.options.map(o=>o.id)).size!==v.options.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'选项标识不能重复'});});
const answerSchema=z.object({question_message_id:z.string().min(1).max(100),option_ids:z.array(z.string().min(1).max(32)).min(1).max(8)}).strict();
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
export function messageChoicesService(db,{tx,assertSession}){
 db.exec(`CREATE TABLE IF NOT EXISTS message_choices(question_message_id TEXT PRIMARY KEY REFERENCES messages(id),definition TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS message_choice_answers(question_message_id TEXT PRIMARY KEY REFERENCES message_choices(question_message_id),option_ids TEXT NOT NULL,answer_message_id TEXT NOT NULL REFERENCES messages(id),result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS message_choice_requests(request_id TEXT PRIMARY KEY REFERENCES receipts(request_id),fingerprint TEXT NOT NULL);`);
 const one=(q,...p)=>db.prepare(q).get(...p),run=(q,...p)=>db.prepare(q).run(...p);
 function publish(mid,input){if(input===undefined)return;const parsed=messageChoiceSchema.safeParse(input);if(!parsed.success)fail('选择题结构无效',400);const m=one('SELECT m.*,c.kind,g.status AS goal_status FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN goals g ON g.id=c.goal_id WHERE m.id=?',mid);if(m?.role!=='assistant'||!['PLANNING','SESSION_LEARNING','ASSESSMENT_V2'].includes(m.kind))fail('此对话不支持选择题');if((m.kind==='ASSESSMENT_V2'?['PAUSED','ABANDONED']:['PAUSED','COMPLETED','ABANDONED']).includes(m.goal_status))fail('此对话当前只读');if(m.kind==='SESSION_LEARNING')assertSession(m.conversation_id);run('INSERT INTO message_choices VALUES(?,?)',mid,JSON.stringify(parsed.data));}
 function state(mid){const row=one('SELECT * FROM message_choices WHERE question_message_id=?',mid);if(!row)return null;const definition=JSON.parse(row.definition),answer=one('SELECT * FROM message_choice_answers WHERE question_message_id=?',mid),round=one('SELECT r.*,a.status FROM assessment_rounds r JOIN assessments a ON a.id=r.assessment_id WHERE r.question_message_id=?',mid);if(answer||round?.answer_message_id)return {...definition,status:'ANSWERED',selected_option_ids:answer?JSON.parse(answer.option_ids):[],answer_message_id:answer?.answer_message_id||round.answer_message_id};
  const m=one('SELECT m.rowid AS position,m.conversation_id,c.kind,g.status AS goal_status FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN goals g ON g.id=c.goal_id WHERE m.id=?',mid);
  let disabled=(round?['PAUSED','ABANDONED']:['PAUSED','COMPLETED','ABANDONED']).includes(m.goal_status);if(m.kind==='SESSION_LEARNING'){try{assertSession(m.conversation_id);}catch{disabled=true;}}
  const stale=round?round.status!=='WAITING_ANSWER':!!one("SELECT 1 FROM messages WHERE conversation_id=? AND rowid>? AND role IN ('user','assistant')",m.conversation_id,m.position);
  return {...definition,status:disabled?'DISABLED':stale?'STALE':'OPEN',selected_option_ids:[],answer_message_id:null};
 }
 function submit(c,input,key,send){const parsed=answerSchema.safeParse(input);if(!parsed.success)fail('选择答案结构无效',400);if(typeof key!=='string'||!key.trim()||key.length>100)fail('request_id 无效',400);
  return tx(()=>{const {question_message_id:mid,option_ids:ids}=parsed.data,m=one('SELECT * FROM messages WHERE id=? AND conversation_id=? AND role=?',mid,c,'assistant');if(!m)fail('问题不属于当前对话');const choice=state(mid);if(!choice)fail('该消息不是选择题');if(new Set(ids).size!==ids.length||ids.some(v=>!choice.options.some(o=>o.id===v))||choice.type==='SINGLE'&&ids.length!==1)fail('选择答案无效',400);
   const selected=choice.options.filter(o=>ids.includes(o.id)),ordered=selected.map(o=>o.id),fingerprint=createHash('sha256').update(JSON.stringify([c,mid,choice.type,choice.options,ordered])).digest('hex'),oldRequest=one('SELECT * FROM message_choice_requests WHERE request_id=?',key),oldReceipt=one('SELECT * FROM receipts WHERE request_id=?',key);
   if(oldRequest){if(oldRequest.fingerprint!==fingerprint)fail('request_id 已用于其他选择');return JSON.parse(oldReceipt.result);}if(oldReceipt)fail('request_id 已用于其他操作');
   const prior=one('SELECT * FROM message_choice_answers WHERE question_message_id=?',mid);if(prior){if(prior.option_ids!==JSON.stringify(ordered))fail('此题已回答，不能更改选择');run('INSERT INTO receipts VALUES(?,?,?)',key,'choice-answer:'+c,prior.result);run('INSERT INTO message_choice_requests VALUES(?,?)',key,fingerprint);return JSON.parse(prior.result);}
   if(choice.status!=='OPEN')fail('此题已失效或当前只读，请回答最新问题');
   const result=send(selected.map(o=>o.id+'. '+o.text).join('\n'));run('INSERT INTO message_choice_answers VALUES(?,?,?,?)',mid,JSON.stringify(ordered),result.message_id,JSON.stringify(result));run('INSERT INTO message_choice_requests VALUES(?,?)',key,fingerprint);return result;
  });
 }
 return {publish,state,submit};
}
