# 主页目标讨论

用户确认的范围：从模糊想法逐步收敛到单个方向，先讨论宽泛程度和期望层级，每轮一个关键问题；五项草案由用户编辑和确认。当前基础采用用户自述，正式诊断在目标创建后进行。第一版不提供材料、笔记或历史对话选择，也不自动关联材料。

主页对话占主要空间，五字段表单改为按需打开的草案弹窗，保存后仍需明确确认才能创建目标。AI 对手动字段的建议在弹窗中展示，用户可将需要的建议填入字段后保存。主页日历读取 calendar_entries 与已有 reviews：前者是用户日程，后者继续服从原复习状态流程。POST /api/calendar 接收 title、date、可选 time/session_id/id；POST /api/calendar/done 接收 id 与布尔 done，均只接受 Web 会话。标记日程完成不改变 sessions、evidence 或学习画像。

## 状态与保存

- DISCOVERY 对话允许没有 goal_id；goal_discussions 保存草案、版本、手动字段、待接受建议、关键摘要和目标来源关联。
- discussion_inputs 保存未发送文字。浏览器短延时自动保存并在离开页面时尝试补交；网络错误会提示，不宣称失败的保存已成功。
- 草案每次更新递增 revision。AI 必须匹配当前版本；手动更新只包含编辑字段，以用户最新输入为准，合并到最新草案。AI 对手动字段的改动作为 suggestion 保存。
- 用户接受/拒绝建议需匹配版本。确认创建需五字段非空，且该讨论无待处理消息。确认在事务中创建目标、目标对话和来源关系；重复确认返回同一目标。
- 创建后探索记录只读。新目标的初始消息包含确认草案与摘要，Teacher 上下文保留 origin；探索不是考察证据。

## 模型与访问范围

API 复用 chat 路由，主页工具限于 teacher_get_context 与 teacher_propose_goal_draft；后端绑定当前对话，忽略模型伪造的 conversation_id。Codex 任务还提供 teacher_reply 以完成回复写回。草案工具不能确认、创建目标或访问材料。

背景仅提供最近 30 个目标的名称、状态和每项最多 1,200 字的画像摘要。已确认目标的常规 Teacher 流程继续沿用已有规则。

## 用户接口

全部 POST 使用 Web 会话 Cookie 与 JSON；Agent Bearer 不授权这些维护操作。

| 路径 | 请求 |
| --- | --- |
| /api/discussions | request_id |
| /api/discussions/draft | conversation_id, revision, draft（所改字段） |
| /api/discussions/input | conversation_id, content |
| /api/discussions/suggestion | conversation_id, revision, accept |
| /api/discussions/confirm | conversation_id, revision, request_id |

GET /api/state 包含 discussions；消息仍由 /api/messages 读写。草案字段为 direction（最多150字符）、background、level、outcome、exclusions（各最多1000字符）。teacher_propose_goal_draft 还接收 summary（最多2000字符）及 request_id。

## 验证

`npm test` 覆盖独立讨论、草案保护、版本冲突、单次确认、来源传递、API/宿主路径、上下文隔离、权限与迁移。`node scripts/preview-discovery.mjs` 启动 4329 端口的独立临时数据/模拟模型，供浏览器检查，不读取生产数据或调用真实模型。

模型的对话质量仍取决于所选模型；模拟验证证明调用和保存流程，不代表对真实模型的教学质量评估。
