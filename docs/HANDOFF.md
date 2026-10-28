# AI Teacher · 维护交接

- 更新日期：2026-10-29（Asia/Shanghai）
- 源码版本：0.14.1

仓库：[mocias/ai-teacher](https://github.com/mocias/ai-teacher)，公开仓库，主分支 `main`。

本文描述 V0.14.1 的交接基线；运行进程、模型目录、快捷方式和 Release 状态都可能变化，继续工作时应重新核对。源码变更和提交记录以本文件所在 Git 提交为准。

## 交付状态

- 本次将此前 V0.7 提交之后累积的 V0.8–V0.14.1 功能纳入源码提交。
- GitHub 下载页最新包核对为 `v0.7.0` 预发布版。本次推送源码与文档，未创建新的二进制 Release。
- 本地 V0.14.1 成品：`outputs/desktop-v0.14.1/AI Teacher-win32-x64/AI Teacher.exe`。
- 本机桌面快捷方式已指向该成品，启动参数继续使用原学习目录；已实际打开 V0.14.1，服务健康检查返回对应版本。
- 正式学习库已做启动前备份；启动后逐项核对既有对话、消息和目标记录保留。私人记录、配置、备份和成品均未进入 Git。

最新功能概要见 [README](../README.md)，不要从旧版本文档中的“未发布”或历史测试数量推断当前交付状态。

## 接手时先核对

1. 查看 `git status --short`、分支和远端；保留用户未提交改动。
2. 查看 `package.json` 及实际目标成品的 `resources/app/package.json`。
3. 在 Windows 检查桌面快捷方式的目标、工作目录与 `--data-dir` 参数，再核对运行进程的真实 EXE 路径。
4. 读取 `http://127.0.0.1:4317/api/health`，比较 `version`、`features` 和数据目录身份。不要把源码测试当成正在运行的桌面已更新。
5. 只有修改或调试模型配置时才查询当前 DSH 注册表；不要输出凭据文件、完整提供商配置或原始服务商错误。

开发数据默认在仓库 `data/`，正式桌面数据默认在 `%APPDATA%\AI Teacher\data`，用户可另选目录。设置保存在 `%APPDATA%\AI Teacher\desktop.json`。查清实际目录后再操作，详见 [数据与升级](../README.md#数据与升级)。

## 代码导航

| 位置 | 责任 |
| --- | --- |
| `server/index.mjs` | HTTP、MCP、鉴权、事件推送与生命周期 |
| `server/store.mjs`、`server/learning.mjs` | 消息和任务、学习状态、事务与证据 |
| `server/agents.mjs`、`server/agent-policy.mjs` | 功能路由、主 Agent 配置提案与权限 |
| `server/harness-host.mjs` | 自动宿主启动、任务凭据、取消、写回与模型选择 |
| `server/dsh-model*.mjs`、`server/dsh-provider-plugins.mjs` | 静态声明、运行时目录、插件来源、对话选择与执行前检查 |
| `scripts/dsh-model-registry.mjs` | 在 DSH 内加载模型插件、查询注册表并验证就绪 |
| `server/dsh-sessions.mjs` | 每段对话的 DSH 身份、共享工作区、日志和检查点恢复 |
| `scripts/dsh-reply-stream.mjs`、`server/reply-streams.mjs` | 受限回复正文投射与临时分片预览 |
| `public/live-events.js`、`server/static-assets.mjs` | SSE 合并、刷新调度、资源缓存 |
| `public/chat-ui.js`、`public/conversation.css` | 共用聊天交互和视觉样式 |
| `public/app.js`、`public/agent-chat.js` | 主工作台和主 Agent 页面 |
| `desktop/`、`scripts/package-desktop.mjs` | Electron 容器、阅读器、打包与桌面验收 |

核心分工：LLM 提议、解释和选择参数；服务端校验、执行确定性操作并持久化。用户确认仍控制正式目标、能力要求、路线、长期画像、配置提案和目标结束等动作。主 Agent 负责工作台说明与配置，不是所有学习功能的自动后备处理者。

## DSH 接入中必须保留的约束

- 目录发现和执行共享插件来源。不要只把模型名称加到前端，或把 Qoder 写成唯一特例。
- 当前发现读取已安装 profile bundles 与覆盖配置，查询真实 `llm.listProviders()` / `llm.listModels()`。标准模型插件可自动接入；缺少依赖、动态配置或 Desktop 专用服务时应明确诊断，不承诺任意第三方插件都能直接运行。
- 目录进程使用独立运行目录；执行进程使用会话自己的 DSH home。不得为方便复用而启动全部 Desktop 插件或混用会话身份。
- 模型插件缺失的 peer 依赖在插件模块范围内解析到正在运行的 DSH。Qoder 缓存只投射明确的公开字段，不复制整个 DSH home。
- 对话选择对后续消息生效；排队的显式模型被冻结，执行中切换不改当前请求；主动重试使用当前选择。
- 同一对话复用一个 DSH 会话；不同对话共享 `ai-teacher-workspace`，会话日志和检查点隔离。恢复失败不能静默创建新会话或重放旧工具调用。
- 生成中的正文只是内存预览；`teacher_reply` 的正式 SQLite 写回是最终依据。
- 首次目录查询可能受本机插件启动、登录读取和目录网络请求影响；缓存查询与首次冷启动应分开测量。

详见 [插件模型](DSH-MODELS-V0141.md)、[模型选择](DSH-MODELS-V013.md)、[会话恢复](DSH-SESSIONS-V09.md)、[正文流式](STREAMING-V011.md)。

## 配置丢失事件与恢复边界

本次排查发现，Agent Room 自动登记使用 BEGIN/END 标记整体替换桥接配置，而 DSH 的 `llm-pi-ai` 模型段处于这段标记内部，导致其一并丢失。用户没有主动修改模型设置。

根据自动备份恢复了模型段，并追加到管理标记之外；恢复前另存了当前配置，保留其他现有内容。重新核对普通提供商和 Qoder 均可见。此次仅修复本机配置布局，没有在本仓库中修改 Agent Room 项目的实现。不要把这一恢复记录当成未来所有外部配置写入都已得到根治。

后续若目录突变，先比较源配置、备份、管理标记和当前运行时。不能仅凭文件时间变化认定用户或其他任务改过配置，更不能将旧备份整体覆盖当前文件。详情见 [恢复记录](DSH-MODELS-V0141.md#本机配置恢复记录)。

## 验证基线与边界

V0.14.1 已完成：

- `npm run build`；`npm test` 139 项通过。
- 真实 DSH + 非 Qoder 测试插件 + 本地模拟模型：正文分片、模型切换、重启续接、取消重试、共享工作区、检查点恢复与受限 MCP 工具。
- 真实安装的 Qoder：目录与独立执行适配器就绪，查询前后 DSH 源配置不变，没有发送付费推理提示词。
- 成品桌面：运行时目录可见、Qoder 选择可保存，刷新后保留。五个对话入口的通用模型选择亦通过。
- 实机发布检查时，目录为四组共 40 个模型，其中 Qoder CN 10 个、Qoder 14 个。这是当时安装与登录状态的读数，不是写死的产品配额。

主要命令见 [README 验证](../README.md#验证)。现有本机证据（不随 Git 上传）：

| 路径 | 内容 |
| --- | --- |
| `outputs/tests-v0141.txt` | 自动测试基线 |
| `outputs/dsh-registry-ready-packaged.json` | 成品注册表与 Qoder 执行适配器就绪 |
| `outputs/desktop-registry-packaged/model-picker-result.json` | 成品 UI 的模型选择与保存 |
| `outputs/desktop-model-picker-dev/model-picker-result.json` | 五入口通用模型选择 |
| `outputs/desktop-streaming-packaged/` | 既有正文流式验收 |

V0.14 UI、阅读与性能的完整历史验收见 [UI 说明](CHAT-UI-V014.md) 和 [性能说明](PERFORMANCE-V012.md)。这些不能替代未来修改后的针对性复测。

Windows Electron 截图曾出现 `UnknownVizError` 或等待渲染不返回；注册表 UI 验收以 DOM、保存结果和运行报告为准，不把截图失败误判成模型调用失败。不要为了截图改动生产渲染参数。

## 尚未实现或尚未证明

- 完整思考过程、逐工具事件轨迹与其取消／重试／保留生命周期，先前按用户要求暂缓。
- AI Teacher headless 会话在 DSH Desktop 原生会话列表中的同步。
- 所有云模型的真实付费推理、额度、长期教学质量或大规模真实数据性能。
- 扫描 OCR、语义检索、跨目标知识结构、复杂证据冲突与自动滚动复习。
- V0.14.1 二进制 GitHub Release、签名安装包和自动更新。

按下一轮用户目标继续，不要把上述清单当作已经授权立即实现全部功能。

## 建议使用的技能

- **handoff**：继续更新本交接，引用功能文档，避免重复整段实现历史。
- **diagnose**：模型缺项、会话恢复和加载问题，先复现再区分配置、发现、执行与 UI。
- **agent-browser**：浏览器／Electron 交互复查；也可先复用仓库已有的桌面 smoke。
- **find-skills**：仅在用户希望寻找新设计或工具方案时检索相关技能。

先确认当前环境确实提供这些技能并读取其说明。普通 AI Teacher 软件开发不需要调用教学插件去修改真实学习内容。

## 提交与发布约定

`data/`、`runtime/`、`outputs/`、`node_modules/`、`.local/`、实际 `.mcp.json`、环境变量文件与日志保持忽略。测试只使用隔离库；不得将学习数据、凭据、聊天导出或带账户信息的原始日志加入公开仓库。

推送源码、上传 Release 成品、切换本机快捷方式和确认运行服务是四个不同步骤，分别报告。将来发布成品时先核对源码与打包资源一致，再运行成品验收。
