# 功能 AI 接入与主 Agent 配置引导

## 职责与首次使用

每个功能直接使用各自的 API 模型或 MCP Agent。主 Agent 当前负责项目介绍、解释功能、引导和协助配置，不接收学习任务、不调度或委派任务，也不作为未配置功能的默认模型。主 Agent 的其他职责尚未确定，后续再扩展。

首次在“模型与分工”连接主 Agent，即可进入项目介绍与配置引导。仅配置主 Agent 不等于已配置学习功能。用户可以让它提出各功能的配置方案，经确认后生效；也可以直接手动设置。已有模型连接可以被多个功能明确选用，包括与主 Agent 相同的 API 连接，但不会自动继承。

- **API**：本站直接调用该功能选定的模型。选择已有连接，或填写名称、Base URL、准确模型名及 Key，支持 OpenAI 兼容 Chat Completions 和 function tools。
- **宿主 + MCP**：选 Codex 或 Claude Code 时，本站为每条消息启动已登录的本机宿主，任务专属 MCP 提供上下文和回写工具。也可以选手动 MCP，让外部 Agent 主动领取任务。
- **暂不配置**：功能的 AI 任务保留在等待队列，提示配置。不会自动调用主 Agent 或其他功能的模型。

主 Agent 能读取不含凭据的连接信息、查看哪些功能未配置、提出配置方案及新 API 连接的名称／模型／地址。它不能确认自己的提案，不能读取学习资料或学习对话。Key 由用户在专用表单中输入，不应放进聊天。

## 按功能直接执行

例如，资料分析指定 API 模型 A，考察指定 MCP Agent B：

```text
资料分析任务 → 资料分析的 API 连接 → 模型 A → 原对话
考察任务     → 考察的 MCP 入口     → Agent B → 原对话
配置引导对话 → 主 Agent 的 API 或 MCP
```

普通对话、目标探索使用 chat；资料分析按用户选择的正文版本执行；正式考察按类型进入 assessment、review 或 final；阅读、首次画像、修改追问分别进入 reading、onboarding、change_review。能力、路线和画像的用户确认流程不变。

同一会话逐条处理，不同会话可以由不同宿主处理。API 执行器仍串行运行。没有主 Agent 中转、任务委派、自动兜底或多专家汇总步骤。

## 站点自动启动宿主

Codex 使用官方非交互 CLI `codex exec`，Claude Code 使用 `claude -p`。站点把本条用户消息送入宿主进程，并附上只适用于该任务的 MCP stdio 适配器。宿主必须调用 `teacher_get_context`，再调用相应工具写回；普通回答必须由 `teacher_reply` 入库。终端最终文本不会被当成学习回复。MCP 在这里提供工具能力，并不作为通用的“向任意宿主投递对话”协议。

每个功能可单独选择宿主、可选模型和可执行文件路径。Codex 在 Windows 桌面应用中会查找本机 Codex 安装目录；Claude Code 默认从 PATH 查找，可填写绝对路径。两者均使用各自的本机登录状态。自动任务的凭据仅在该任务运行时有效，工具隐藏并由服务端绑定 `job_id`、租约和请求 ID。站点不会把 API Key 传给宿主。执行退出而未成功写回时，任务阻塞，页面显示失败原因，用户可在检查后显式重试。

Claude Code 的 CLI 启动和任务专属 MCP 配置已用模拟进程检查；本机尚未安装 Claude Code，因此真实 Claude 登录与推理需在安装后验证。

未配置和执行失败的任务可在“模型与分工”的等待任务区域找到。配置完成后，点击“按当前配置重试”。重试保持任务所属功能，不允许将学习任务交给主 Agent。运行中的任务不切换连接，失败任务不无限自动重试。

## 独立 MCP 入口

手动 MCP 使用 `/mcp/agents/master`，仅处理介绍与配置引导对话。功能入口为 `/mcp/agents/{role}`：

| role | 功能 |
| --- | --- |
| chat | 普通对话／目标探索 |
| material | 资料分析 |
| capabilities | 能力要求 |
| roadmap | 学习路线 |
| assessment | 诊断与学习考察 |
| review | 复习与强化 |
| final | 最终综合面试 |
| reading | 阅读答疑 |
| onboarding | 首次画像引导 |
| change_review | 修改后的追问 |

每个入口使用独立 Bearer Token，数据库只保存哈希。生成时一次显示原文；重新生成或切换接入方式会撤销旧凭据。宿主可以分别启动 `scripts/agent-mcp.mjs` stdio 进程，通过 `TEACHER_URL`、`TEACHER_AGENT_ROLE`、`TEACHER_TOKEN` 连接。页面生成的配置包含实际路径与端口。

这些入口共享学习后端及数据库。工具目录按角色过滤，调用时继续校验任务归属、租约、会话、资料与证据范围。主 Agent 不拥有资料分析、考察等学习工具。

宿主执行步骤：

1. 调用 `teacher_claim_message`，只领取当前入口所属功能的任务。可指定会话；无任务返回 `job: null`。
2. 使用返回的上下文处理任务；后续工具带上 `job_id`、`lease_token`。目标、会话、考察 ID 由服务端绑定。
3. 必要时调用 `teacher_get_context`、`teacher_renew_lease`。写操作使用稳定的 `request_id`。
4. 普通回复使用 `teacher_reply`；正式考察使用出题或结束工具，完成本条消息后结束处理。

主 Agent 除领取、上下文、续期和回复外，只有 `teacher_get_agent_configuration` 与 `teacher_propose_agent_configuration` 两个配置工具。没有委派工具，也不能调用用户确认接口。手动 MCP 本身不唤醒模型；宿主离线时任务保持等待。

## 兼容与迁移

旧版模型路由和 Codex 设置保留。在新功能配置中明确保存任意连接后启用按功能直接路由；已有 API 模块配置可继续作为该功能的连接。未进入新模式的旧任务沿用旧入口。

从先前的“主 Agent 中转”实现升级时，自动备份为 `backups/before-direct-agent-routing-*.sqlite`，将待处理学习任务改为所属功能的连接。旧的默认继承变成“尚未配置”，待确认旧方案标记为已过期。中断的运行任务保留等待与阻塞状态，必须显式重试；学习数据及历史记录保留。

旧 `/mcp` 与旧插件仍是可信本机的全局兼容入口，访问范围较广，不能代替功能隔离入口分发给专属 Agent。模块隔离需要使用专属入口与独立凭据。

JSON 学习导出排除 Agent 配置与凭据。SQLite 备份保留功能连接、配置提案和 Token 哈希；模型 Key 沿用本机加密凭据库。API 主 Agent 与功能模型共用 API 执行开关，但路由及工具权限分开。

## 验证边界

`node --test tests/*.test.mjs` 覆盖功能直接调用、主 Agent 仅处理配置引导、未配置任务无兜底、显式共享 API 连接、独立 MCP 队列、自动宿主通过任务专属 stdio MCP 回写、失败阻塞与重试、配置确认、权限与租约、旧中转数据迁移，以及真实 HTTP／stdio MCP 客户端通信。`node scripts/check.mjs` 检查语法和资源。`node scripts/smoke-harness.mjs codex` 会使用独立临时库调用本机已登录的真实 Codex，本机已验证通过。

模型调用测试使用模拟响应，不代表已验证真实模型的功能质量或所有外部 Agent 软件的配置格式。
