# Codex 自动唤醒 · V0.4

打开 http://127.0.0.1:4317，在“模型与分工”检查 Codex 登录并启用自动唤醒。之后在 Teacher 对话里直接发送消息。未分配模型 API 的任务由后台 Codex 处理，完整回复自动出现在原 Web 对话中。下一条消息会重新启动一次处理，无需复制提示词，也无需保持 Codex 桌面聊天处于运行状态。

需要本机安装并登录 Codex CLI，以及保持 Node 学习服务运行。复用 Codex 登录和账号额度，不需要额外 API Key。可配置 Codex 可执行文件、模型、推理强度和单条超时。空模型使用 Codex 默认模型；不会继承全局用户配置中的模型或 MCP。

## 运行方式

Web → SQLite 消息队列 → 本机调度器（约每秒检查一次）→ codex exec → 当前任务专用 MCP → SQLite 回写 → Web SSE 刷新。

调度器常驻，每次最多运行一个后台 Codex。模型不会持续空转；单条任务处理完即退出。多轮上下文从数据库重新读取。网页使用 SSE 接收更新，当前按完整消息显示，不逐 token 流式显示。

这不是向当前 Codex 桌面聊天窗口注入消息，不自动唤醒休眠电脑，也不提供 Windows 开机自启动。DeepSeek Harness 的自动启动尚未适配，仍可用原 MCP 手动接入。插件提供学习工具和指导；自动唤醒开关在 Web，未新增独立插件聊天面板。

## 控制与失败处理

- 仅领取 HOST 任务；API 模块由原有 API 执行器处理。两个开关独立。
- 任务使用租约和顺序队列。取消、暂停或租约失效后拒绝迟到回写。
- 失败、超时或服务中断后任务进入等待处理，不无限自动重试。在原对话点击“重试当前任务”。
- “暂停自动唤醒”会中止当前后台处理；已经保存的业务结果保留。重试时模型应先查看已有提案和记录，避免重复创建。
- 能力要求、学习路线和目标结束等用户确认规则保持有效。

## 数据和权限边界

设置和执行记录保存到原有独立数据库 data/teacher.sqlite 的 host_settings、host_runs 表。首次迁移前生成 data/backups/before-host-wakeup-*.sqlite 备份。记录状态、工具计数、线程标识、用量和简短错误；不保存 CLI 原始输出或内部推理。

每次子进程得到一个临时随机凭据，仅授权当前任务的教学工具。不能使用该凭据修改用户设置、读取其他目标的资料或领取其他任务。Codex 以只读文件沙箱启动，禁用 shell、应用、插件、浏览器和多代理，仅对任务专用教学工具预授权。普通对话也必须经 MCP 明确回写，工具失败不会伪装为成功。

目标、对话和相关教学材料会发送到 Codex 所使用的模型服务。学习数据库仍保存在本机。

## 接口与验证

- POST /api/host/settings：Web 会话权限，保存 enabled、executable、model、effort、timeout_seconds。
- POST /api/host/check：Web 会话权限，只检查本机 Codex 登录状态。
- GET /api/state：hostAutomation 返回设置与最近 100 条运行记录。
- /api/host/catalog 与 /api/host/tool：内部临时任务凭据，非通用用户 API。

`node scripts/check.mjs` 和 `node --test tests/*.test.mjs`：26 项通过。
`node scripts/host-smoke.mjs`：隔离临时数据库、真实 Codex 登录、连续两轮 Web 消息均自动完成，且各有一次显式 MCP 回复。此脚本会消耗账号额度；不作为普通单元测试运行。

底层使用 [Codex 非交互运行接口](https://learn.chatgpt.com/docs/non-interactive-mode)；工具预授权使用 [官方配置字段](https://learn.chatgpt.com/docs/config-file/config-reference)。
