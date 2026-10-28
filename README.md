# AI Teacher · 本地学习工作台

AI Teacher 把目标讨论、资料阅读、学习路线、考察、复习和补学放在同一个本地工作台。学习记录保存在 SQLite 中；模型通过独立 API 连接或 Codex、Claude Code、DSH 宿主完成推理，服务端负责校验、持久化和用户确认。

**当前源码版本：V0.14.1。** 本仓库为公开仓库。GitHub [Releases](https://github.com/mocias/ai-teacher/releases) 当前最新下载包仍是 [V0.7.0 预发布版](https://github.com/mocias/ai-teacher/releases/tag/v0.7.0)，不包含这里的最新功能。V0.14.1 可从源码运行或自行打包；本次源码更新未新建二进制 Release。

维护交接见 [HANDOFF](docs/HANDOFF.md)，桌面使用与构建见 [DESKTOP](docs/DESKTOP.md)。

## 当前功能

| 功能 | 行为 |
| --- | --- |
| 目标讨论 | 从模糊想法整理可编辑草案，经用户确认后创建正式目标 |
| 资料与阅读 | 保存本地附件、链接和正文；桌面内阅读、批注、记录位置与按当前内容答疑 |
| 学习路线 | 能力要求、初始诊断、阶段和主题、显式先修关系，以及日历排期 |
| 考察与复习 | 结构化问答、回答证据、薄弱点、复习、强化与最终综合考察 |
| 进度与补学 | 保存学习进度、安排补学、预览并调整逾期待办；学习进度与能力证据分别记录 |
| 模型与分工 | 各功能独立配置 API 或宿主；主 Agent 提供项目说明和配置提案，用户确认后生效 |
| 对话体验 | Markdown、表格、代码、复制回复、自动伸缩输入、草稿与阅读位置保留 |

### V0.14.1：DSH 插件模型接入

主 Agent、目标讨论、Teacher 对话、画像对话和阅读答疑可以分别选择 DSH 模型；功能设置也可指定默认模型。模型选择按对话保存，对后续消息生效，已排队的显式选择不会被后续切换改写。

模型目录来自 **DSH 运行时注册表**，覆盖普通提供商和兼容的模型插件，包括 Qoder。发现与执行使用同一套插件来源，启动回合前验证提供商和模型是否就绪；插件缺失、停用、依赖不满足、目录读取失败或查询中途配置变化都会得到诊断，不静默改用另一模型。

查询合并并发请求、缓存 60 秒；配置变化会使缓存失效，刷新按钮可强制重查。Qoder 冷启动复用经过字段筛选的公开目录元数据，不复制登录凭据。目录查询不发送提示词，但插件可能联网同步模型目录。不同机器的模型数量取决于安装、配置和登录状态。

实现、兼容边界及验收见 [DSH 模型接入说明](docs/DSH-MODELS-V0141.md)。

### 对话界面、流式与加载

V0.14 统一了导航、消息排版和输入区，将模型选择与发送操作整合到输入框底部。侧栏显示当前服务版本，执行状态显示实际模型、已有工具调用次数和用时。

DSH 回复正文支持实时分片显示、刷新续接、取消和正式保存后的去重。**尚未展示完整思考过程和逐项工具轨迹。** 计时和调用次数不代表已经接入这些事件。

页面共享 SSE 连接，合并连续通知，只加载当前对话，避免无变化时重建内容；静态资源支持 ETag，Markdown 缓存保留安全清理。已验证的改善是请求与重绘减少，不代表云模型首字延迟或推理速度提升。

详见 [对话 UI](docs/CHAT-UI-V014.md)、[加载优化](docs/PERFORMANCE-V012.md)、[正文流式](docs/STREAMING-V011.md)。

## 从源码启动

建议使用 **Windows x64 + Node.js 24**；基础服务要求 Node.js 22.13+。先安装依赖：

```powershell
npm ci
npm start
```

打开 <http://127.0.0.1:4317/>。也可双击仓库中的 `start.cmd`。已有工作台占用端口时，请先退出旧实例。

启动 Electron 桌面窗口：

```powershell
npm run desktop
```

Electron 下载未完成时可运行 `node node_modules/electron/install.js`。桌面内置阅读与菜单能力；普通浏览器运行不等于所有桌面功能均可用。

## 配置模型

打开「模型与分工」，按功能选择连接：

- **API**：填写 Base URL、模型 ID 和 Key；当前直接 API 适配器支持 OpenAI 兼容 Chat Completions 与 function tools。
- **DSH / DeepSeek Harness**：先安装并配置 DSH。工作台自动查找 CLI 或 Desktop，也允许填写绝对路径。插件模型需要其插件与登录状态有效。
- **Codex / Claude Code**：安装对应宿主并完成配置，工作台按任务启动宿主，通过专属 MCP 写回。
- **手动 MCP**：由外部宿主领取消息并写回。MCP 本身不会自动唤醒宿主。

不同宿主使用各自的协议和能力。直接 API 连接不等于支持所有服务商原生协议。模型返回文字也不等于结构化提案已经保存：能力要求、路线、长期画像和模型配置等提案仍需用户确认。

DSH 会话由 AI Teacher 管理：同一站内对话复用同一 DSH 会话，多个对话共用学习工作区，日志与检查点按会话保存。这些 headless 会话目前不会自动出现在 DSH Desktop 的原生列表中。

参考：[DSH 配置](docs/DSH-HOST.md) · [持续会话与恢复](docs/DSH-SESSIONS-V09.md) · [功能分工](docs/AGENT-ORCHESTRATION.md) · [直接 API](docs/MODEL-ROUTING.md)。

## 数据与升级

- 开发环境默认数据目录为仓库的 `data/`；正式桌面包默认使用 `%APPDATA%\AI Teacher\data`。二者通常不是同一个学习库。
- 在「AI Teacher → 桌面设置」中查看或选择已有数据目录，也可使用 `--data-dir`。选择已有目录不会自动搬移或合并数据。
- 更新程序时，完整保留原数据目录；关闭旧窗口及其服务，再打开新版。不要只替换或搬走 EXE，整个成品文件夹共同构成应用。
- 完整备份应在退出应用后复制整个数据目录，或使用一致性 SQLite 备份。JSON 导出不包含全部附件与配置，不能代替完整备份。
- 学习数据库、密钥、Agent token、运行日志和实际生成的宿主配置均不应提交 Git；相关目录已列入 `.gitignore`。

本地成品沿用原库的启动示例：

```powershell
& ".\outputs\desktop-v0.14.1\AI Teacher-win32-x64\AI Teacher.exe" "--data-dir=$env:APPDATA\AI Teacher\data"
```

服务只监听本机，使用页面会话和独立 Agent 凭据区分权限。这是面向可信本机用户的应用，不是公网多用户服务。推理仍可能把当前任务所需内容发送给你选择的模型服务。

## 打包 Windows 桌面版

```powershell
$env:TEACHER_PACKAGE_OUT = "outputs/desktop-v0.14.1"
npm run desktop:package
```

成品入口为 `outputs/desktop-v0.14.1/AI Teacher-win32-x64/AI Teacher.exe`。打包携带执行构建的 Node 运行环境，需在 Windows x64 上构建；详细的许可证缓存、Electron 缓存与成品验证方法见 [桌面说明](docs/DESKTOP.md)。

目前没有安装向导、代码签名、自动更新、托盘或开机启动功能。桌面快捷方式需指向实际的新成品；源码版本、快捷方式目标和运行服务版本应分别核对。

## 验证

基础检查不使用真实学习库：

```powershell
npm run build
npm test
```

2026-10-29 的 V0.14.1 基线为 **139 项测试通过**。进一步验收按环境选择：

| 命令 | 验证范围 |
| --- | --- |
| `node scripts/smoke-desktop.mjs --model-picker` | 五个对话入口、功能默认模型、刷新保留与窄窗口 |
| `node scripts/smoke-desktop.mjs --chat-ui` | 聊天排版、输入、草稿与滚动交互 |
| `node scripts/smoke-desktop.mjs --performance` | 单连接、通知合并、闲时请求与切换隔离 |
| `node scripts/smoke-desktop.mjs --streaming` | 真实 DSH + 本地模拟模型的正文流式、取消与续接 |
| `node scripts/smoke-dsh-local.mjs --plugin` | 非 Qoder 测试插件的真实 DSH 执行、模型切换与会话恢复 |
| `node scripts/smoke-dsh-registry.mjs` | 本机已安装 Qoder 的目录和执行适配器就绪；需要有效安装与登录 |
| `node scripts/smoke-desktop.mjs --registry` | 本机插件模型在真实桌面中的显示、选择和保存 |

DSH 联调需先安装本机 DSH；模拟执行使用临时配置和本地服务。注册表验收会读取本机提供商及插件配置，但不发送推理提示词。结果保存在本机 `outputs/`，不随源码上传。

成品验收先设置 `TEACHER_PACKAGE_DIR`，再给桌面 smoke 增加 `--packaged`。非桌面 DSH smoke 可通过 `TEACHER_DSH_APP_ROOT` 指向成品的 `resources/app`。不要同时构建和验收同一成品目录。

已验证目录、适配器就绪与本地模拟执行；未逐一验证所有云模型的付费推理、额度、教学质量或大型真实学习库性能。

## 后续范围

- 完整思考／工具事件轨迹及其重试、取消和保留策略。
- headless 会话在 DSH Desktop 原生列表中的同步。
- 扫描资料 OCR、自动网页抓取、语义检索及跨目标知识结构。
- 更细的学习证据冲突处理、自动笔记触发与滚动复习调度。
- 长期真实学习效果与复杂数据规模下的持续验证。

## 文档索引

- [维护交接](docs/HANDOFF.md)
- [桌面使用与开发](docs/DESKTOP.md)
- [目标讨论](docs/GOAL-DISCUSSIONS.md)
- [资料到复习的学习闭环](docs/LEARNING-LOOP-V05.md)
- [复习与强化](docs/REVIEW-FOLLOWUPS-V06.md)
- [薄弱点补学](docs/REMEDIATION-V07.md)
- [逾期待办重新排期](docs/RECOVERY-V08.md)
- [早期架构与 API 路由背景](docs/ARCHITECTURE.md)
- [HTTP / MCP 接口定义](docs/openapi.json)

## 授权

原创代码采用 [Apache-2.0](LICENSE)，版权声明见 [NOTICE](NOTICE)。第三方组件及许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [维护说明](docs/LICENSING.md)。
