# V0.11.0 · DSH 回复正文流式显示

本版将 DSH 的实时生成片段推送到站内聊天气泡。不是完整回复收到后播放打字动画，也不是计时器更新。

## 链路与范围

每轮 headless patch 加载项目自带 `scripts/dsh-reply-stream.mjs`。插件订阅原生 `agent/assistant-stream`，只解析 `mcp__teacher_job__teacher_reply` 工具参数的顶层 `content` 字段，增量处理 JSON 转义与 Unicode 分片。它将正文片段及尝试序号写入本轮子进程的 stdout，由持有该任务的父进程接收。不会转发 reasoning、普通模型说明、其他工具参数或 stderr。

DSH 原有 `--json` 是提交后事件，不能提供逐 token 的正文；本插件读取的是提交前的原生实时事件。无需修改本机 DSH 安装或 Desktop profile。

后端只接受当前 DSH 子进程、有效任务租约、已读取本轮上下文的片段。对话、任务、消息和 run ID 均由父进程绑定，不采用模型提供的归属。片段限长、按序处理，失败尝试清除，重试重新开始。约 40ms 合并转发一次，避免逐 token 重绘。

`/api/events` 新增命名 SSE 事件 `reply-stream`，携带有版本的完整预览快照。首次连接和重连发送现有快照，避免丢片段后继续拼接错误内容；慢连接超过缓冲上限时断开后重新取快照。`GET /api/reply-streams` 提供当前预览快照，使用 Web 用户会话 Cookie 验证，Agent Token 不授权。

主 Agent、Teacher、首页目标讨论、个人画像和阅读答疑共享前端预览组件。收到片段更新同一个气泡，Markdown 继续安全清理，保留阅读位置与输入草稿。预览标记“正在生成 · 尚未保存”。`teacher_reply` 成功后以 SQLite 中的正式内容为准，通过 message ID / reply_to 去重。取消或中断的片段标记未保存，不当作正式回复。

当前仅 DSH 的 `teacher_reply` 正文支持该链路。API 执行器、其他宿主及结构化考察工具仍按各自原有回写方式显示。模型未提供增量时，显示实际收到的完整片段，不伪造逐字输出。

## 数据与生命周期

预览只在进程内存中保存，不进入 SQLite、学习导出或 DSH 检查点。最多保留 100 项、每项正文 20,000 字符；完成/取消/中断后的快照约两分钟后过期。服务重启后未保存的预览不恢复，正式消息和 DSH 会话映射按原有机制保留。重试时旧尝试不会拼入新正文。

## 验收

- `npm test`：包括分片 JSON 转义、代理对、工具/Agent 隔离、失败尝试清除、顺序、重试重置、权威回写、取消后迟到片段和快照过期。
- `node scripts/smoke-dsh-local.mjs`：真实本机 DSH + stdio MCP + 本地流式模型，在模型暂停且尚未输出后半段时确认后端已收到正文前缀、正式消息尚未写入；继续验证多轮复用、重启与检查点恢复。
- `node scripts/smoke-desktop.mjs --streaming`：真实 Electron + 本机 DSH + 本地可暂停模型。第一段显示后仍暂停服务商输出；刷新页面恢复第一段，再输出第二段，仍不输出最后一段；最后完成后仅保存一条正式回复。另验证取消时半段回复不会保存、快照接口不接受匿名请求。
- `TEACHER_PACKAGE_DIR=... node scripts/smoke-desktop.mjs --packaged --streaming`：相同流程验证打包成品。

上述验收使用隔离数据和本地模型，不消耗云端模型额度。
