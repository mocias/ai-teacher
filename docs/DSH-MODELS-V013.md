# V0.13.0 · 在 AI Teacher 中选择 DSH 模型

## 使用

已将功能连接为 DSH 时，主 Agent、首页目标讨论、Teacher 对话、画像对话和阅读答疑输入区上方显示「DSH 模型」。从服务商分组中选择，自动保存到本段对话。选择「沿用默认」恢复功能默认模型；功能默认为空时，沿用 DSH 全局、headless 或 Desktop 的默认选择，优先级与原版本一致。刷新按钮重新读取本机声明。

「模型与分工 → 调整」也可直接选择该功能的默认 DSH 模型。主 Agent 的 `teacher_get_agent_configuration` 会返回模型目录；`teacher_propose_agent_configuration` 现支持 `harness` 和 `model`，能够提出不同功能使用不同 DSH 模型的方案，仍需用户确认后生效。旧版本的严格工具 schema 缺少这两个字段，是主 Agent 无法提交 DSH 模型配置的原因之一。

同一对话选择对后续消息生效；已排队的显式选择被冻结，执行中的请求保持原模型。主动重试按当前选择重新分配。切换保留站内消息及同一个 DSH 会话，不重建历史，不修改 DSH Desktop 的全局选择。运行记录提供实际解析到的服务商和模型，主 Agent 执行状态也显示它，便于区分正在执行的模型和下一条消息的选择。

若该功能使用 API、Codex、Claude 或手动 MCP，不显示 DSH 选择器，也不会因选择模型自动改换宿主。

## 目录与持久化

- 只读取 DSH 本机配置中显式声明的模型及当前默认模型，不访问远程模型列表，也不读取凭据文件。未显式列出的内置模型只有在被设为默认时才加入目录。
- 返回字段仅含 provider、model、名称、来源和目录 ID；不向页面或 Agent 返回 URL、请求头、API Key 或凭据环境变量。模型 ID 内含 `/` 时保留完整内容，例如 `ustc-llm/smart/default`。
- 模型目录只代表已声明，不证明服务商可用、余额充足、具备工具调用能力或对应价格。读取和保存选择本身不消耗云模型额度。
- 新增 `dsh_conversation_models`、`dsh_job_models`、`dsh_run_models` 三张表。迁移前生成 `before-dsh-model-picker-*.sqlite` 一致性备份。旧消息、目标、资料、会话映射与凭据不变。
- `GET /api/agents/dsh-models` 读取目录，`POST /api/agents/dsh-model` 保存 `{conversation_id,model}`，均需 Web 用户会话；Agent token 不能代替用户会话直接修改对话选项。主 Agent 通过已有受限配置工具读取目录并提出方案。
- 显式模型选择在任务分配时记录；沿用 DSH 默认的空值在执行启动时解析实际默认，并记录服务商和模型。服务商适配配置仍在启动时从 DSH 读取。

## 验收

- `npm test`：133 项通过。新增目录筛选与配置优先级、凭据不泄露、含斜杠的模型 ID、不同对话隔离、重启保留、排队冻结、重试选择、真实配置工具 schema 和 HTTP 鉴权测试。
- `node scripts/smoke-desktop.mjs --model-picker`：真实 Electron 检查五个对话入口、功能设置、刷新保留与 420px 视口；整个流程没有模型请求。
- `node scripts/smoke-desktop.mjs --streaming`：真实安装的 DSH 与本地模拟服务商。选择其他服务商的 `smart/alternate`，在服务商收到的请求中确认模型；生成中切回另一个模型，当前运行继续原选择，下一条请求使用新模型；DSH 会话 ID 不变，同时复测分片、刷新续接、取消和正式消息去重。
- `node scripts/smoke-dsh-local.mjs`：同一会话切换模型后，实际请求使用新模型；重启、检查点恢复和重试继续通过。
- 成品执行相同模型选择及流式验收，报告位于 `outputs/desktop-model-picker-packaged/` 和 `outputs/desktop-streaming-packaged/`。

测试使用隔离 SQLite、独立 DSH 配置和本地模拟模型，没有调用用户的云端模型。仍不包含 DSH 完整思考与工具轨迹；本次解决模型选择与配置通路，不承诺特定模型的响应时间。

## 交付

本地包：`outputs/desktop-v0.13.0/AI Teacher-win32-x64/AI Teacher.exe`。退出旧应用后使用相同 `--data-dir` 参数打开。保留旧版包，未发布 GitHub。桌面快捷方式是否更新应以快捷方式实际目标为准。
