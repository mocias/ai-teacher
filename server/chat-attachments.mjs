import {createHash} from 'node:crypto';

export const ATTACHMENT_TEXT_LIMIT=12000,ATTACHMENT_CONTEXT_LIMIT=24000;
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function chatAttachmentService(db){
 db.exec(`CREATE TABLE IF NOT EXISTS message_attachments(
  message_id TEXT NOT NULL REFERENCES messages(id),resource_id TEXT NOT NULL REFERENCES resources(id),
  position INTEGER NOT NULL,content_id TEXT REFERENCES material_contents(id),extraction_reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(message_id,resource_id),UNIQUE(message_id,position))`);
 if(!db.prepare('PRAGMA table_info(message_attachments)').all().some(column=>column.name==='extraction_reason'))db.exec("ALTER TABLE message_attachments ADD COLUMN extraction_reason TEXT NOT NULL DEFAULT ''");
 const one=(sql,...values)=>db.prepare(sql).get(...values);
 function validate(ids){
  if(ids===undefined)return [];
  if(!Array.isArray(ids)||ids.length>5||ids.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(ids).size!==ids.length)fail('每条消息最多添加 5 个不同附件');
  let total=0;
  return ids.map(resource_id=>{
   const file=one('SELECT name,content,length(content) AS size FROM resource_files WHERE resource_id=?',resource_id);if(!file)fail('对话附件文件不存在');total+=file.size;if(file.size>20*1024*1024||total>20*1024*1024)fail('每条消息的附件总大小不能超过 20 MB');
   let content_id=null,extraction_reason='此文件格式未提取正文；当前支持 UTF-8 的 Markdown / TXT，请提供文字摘录。';
   if(/\.(md|markdown|txt)$/i.test(file.name))try{
    const decoded=new TextDecoder('utf-8',{fatal:true}).decode(file.content).trim();
    if(decoded&&decoded.length<=150000){const hash=createHash('sha256').update(decoded).digest('hex');content_id=one('SELECT id FROM material_contents WHERE resource_id=? AND hash=? ORDER BY rowid LIMIT 1',resource_id,hash)?.id||null;extraction_reason=content_id?'':'未找到与原文件一致的已导入正文，请提供文字摘录。';}
    else extraction_reason=decoded?'正文超过 15 万字，未导入可读内容，请拆分文件或提供文字摘录。':'原文件没有非空文字内容。';
   }catch{extraction_reason='文件不是有效 UTF-8 文本，未提取正文，请转换编码或提供文字摘录。';}
   return {resource_id,content_id,extraction_reason};
  });
 }
 function attach(messageId,refs){refs.forEach((ref,position)=>db.prepare('INSERT INTO message_attachments(message_id,resource_id,position,content_id,extraction_reason) VALUES(?,?,?,?,?)').run(messageId,ref.resource_id,position,ref.content_id,ref.extraction_reason));}
 function metadata(messageId){return db.prepare(`SELECT a.resource_id,a.content_id,a.extraction_reason,f.name,length(f.content) AS size,length(c.content) AS characters
  FROM message_attachments a JOIN resource_files f ON f.resource_id=a.resource_id LEFT JOIN material_contents c ON c.id=a.content_id
  WHERE a.message_id=? ORDER BY a.position`).all(messageId).map(row=>({...row,characters:row.characters||0,download_url:'/api/resource-file?id='+encodeURIComponent(row.resource_id),content_status:row.content_id?'READABLE':'UNAVAILABLE',...(!row.content_id?{unavailable_reason:'原文件已保存；未提取可读正文。'+(row.extraction_reason||'请提供文字摘录。')}:{})}));}
 function hydrate(messages,throughMessageId){
  const index=throughMessageId?messages.findIndex(message=>message.id===throughMessageId):-1;
  if(throughMessageId&&index<0)fail('本轮消息不属于当前对话');
  const scoped=throughMessageId?messages.slice(0,index+1):messages;let remaining=ATTACHMENT_CONTEXT_LIMIT;
  for(const message of [...scoped].reverse())for(const attachment of message.attachments||[]){
   if(!attachment.content_id)continue;
   const limit=Math.min(remaining,ATTACHMENT_TEXT_LIMIT);let body=(one('SELECT substr(content,1,?) AS content FROM material_contents WHERE id=?',limit,attachment.content_id)?.content||'').slice(0,limit);
   // SQLite counts Unicode code points; JavaScript and request limits count UTF-16 units.
   // Keep both limits bounded without cutting an emoji's surrogate pair in half.
   if(/[\uD800-\uDBFF]$/.test(body))body=body.slice(0,-1);
   attachment.content=body;attachment.truncated=Array.from(body).length<attachment.characters;attachment.omitted=limit===0;remaining-=body.length;
   if(attachment.truncated)attachment.content_note=limit===0?'附件正文因本轮上下文限额省略，请缩小范围或单独重新发送。':'附件正文仅提供开头摘录，完整内容请下载原文件；不得声称已读全文。';
  }
  return scoped;
 }
 return {validate,attach,metadata,hydrate};
}
