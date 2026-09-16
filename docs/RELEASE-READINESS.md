# 首次 GitHub Release 检查

检查日期：2026-09-17。范围：当前源码、Windows x64 桌面产物、发布准备情况；未创建仓库、提交、标签或 Release，未上传任何文件。未升级依赖或修改产品代码。

后续本地准备进展：已按作者选择补齐 Apache-2.0 LICENSE、NOTICE、元数据及第三方许可证清单；桌面打包脚本会将其加入后续产物。配置已改为版本控制中的通用模板与 Git 忽略的本机生成文件，已初始化本地 Git（main，尚无提交和远端）。测试更新为 28/28 通过。fast-uri 尚未升级，现有桌面产物仍是此前检查版本，需在依赖修复后重新构建。以下条目保留首次检查时的状态，已处理项以本段为准。

## 结论

有条件可发布为 Windows x64 预发布版，但不建议直接发布当前产物为稳定版。先修复生产依赖告警、清理本机配置、确定授权并补齐分发声明，再构建 ZIP 和校验文件。源码上传与二进制 Release 是两个交付物，应分别准备。

已有内部版本号 0.4.0；首次公开版本建议沿用版本序列，使用 `v0.4.1-beta.1`（提议，尚未更改版本）。适合定位为“本地单用户学习工作台 / Windows 桌面测试版”，不声明跨平台、完整 MindOS 功能或生产级稳定性。

## 已验证

| 项目 | 结果与范围 |
| --- | --- |
| 业务与生命周期测试 | `npm test`，27/27 通过 |
| 语法与资源检查 | `npm run build` 通过 |
| 正式包运行 | `node scripts/smoke-desktop.mjs --packaged` 通过；真实 Electron 渲染、API 会话、原生菜单、退出后服务停止 |
| 可迁移性 | 将完整包复制到项目外的带空格目录，独立用户配置与空数据库，PATH 仅保留 Windows System32；仍成功启动，无需系统 Node |
| 源码与产物 | server、desktop、public 文件内容相同，未发现产物落后于这些源码 |
| 私人数据排除 | 产物内未发现 SQLite/WAL/SHM、agent-token、model-vault.key、desktop.json 或 .env 文件；扫描文本未匹配现有 Agent token |
| 凭据模式检查 | 源码未发现典型密钥模式；产物唯一命中为 jose 的 PEM 格式判断字符串，不是实际私钥。此项是有限模式扫描，不等于完整安全审计 |
| GitHub 连接 | `gh api user --jq .login` 成功，当前账号身份已验证；不代表已选定或创建远端仓库 |

产物共约 3502 个文件、467 MiB（未压缩）；必须分发整个目录，不能单独上传 EXE。当前目录没有 `.git`，也没有关联 remote。

## 发布前应处理

### 1. 生产依赖告警

`npm audit --omit=dev --json` 和完整 audit 均报告 1 个 high 级别依赖包：`fast-uri@3.1.2`，依赖链为 MCP SDK → ajv → fast-uri；已确认同版本存在于桌面产物中。一个依赖包对应多条 advisory，并非仅一个漏洞。

官方公告 https://github.com/advisories/GHSA-f65p-4m7j-42xc 将 3.1.6 列为 3.x 修复版本。发布前更新锁文件到满足全部当前公告的版本，重新 audit、回归、打包和 smoke。当前尚未证明这些漏洞在本应用路径中可被利用，不把依赖告警表述成已验证的应用漏洞。

审计原始结果：`outputs/release-dependency-audit.json`。

### 2. 授权与第三方声明

项目根目录没有 LICENSE，package.json 也没有 license 字段。需先确定希望提供给他人的使用、修改与分发授权，再填写相应文件；不擅自替作者选择许可证。

Electron 顶层许可证文件已在产物中，但单独携带的 `runtime/node.exe` 旁没有对应 Node 许可证文件，也没有项目层第三方声明。发布前需核对并补齐所分发运行时和依赖的许可证材料。

### 3. 本机配置与新用户指引

- `plugins/ai-teacher/.mcp.json` 和 `docs/deepseek-harness.yaml` 写死当前项目绝对路径；应改为模板/生成流程，避免把本机生成结果当通用配置。
- `docs/DESKTOP.md` 含当前项目路径示例，且该文档随包分发；建议改用通用路径。
- 已有模型配置与登录检查，但尚无首次启动引导。README 应明确：桌面运行不需要 Node；AI 功能需要自行配置 API，或安装、登录兼容的 Codex CLI。
- 本机自动唤醒使用真实 codex.exe。对仅有 npm 的 codex.cmd 入口、干净 Windows 用户环境以及不同 CLI 版本的兼容性，本轮没有完成验证；需要明确受支持版本/安装方式并补测。
- 无 Codex/API 时应明确提示配置，不应宣传“下载即自动回答”。

### 4. 版本与交付物

创建或关联 Git 仓库、清理待提交文件、形成确定的 commit/tag；统一应用、插件及展示版本。GitHub Release 基于 Git tag，参见 https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases 。

至少准备 Windows x64 ZIP、SHA256SUMS、首次 Release 说明、已知限制和启动指引。目前没有发布 ZIP、完整资产校验和、CI 发布工作流；本地手动发布测试版不以 CI 为硬性前提。

## 可以随测试版说明的限制

- EXE 的 Authenticode 状态为 NotSigned；未提供安装器、自动更新、托盘、开机启动。
- 仅验证 Windows x64。独立配置测试发生在同一台电脑，不是独立干净虚拟机测试。
- 本轮没有重新调用付费模型，也没有在搬迁后的包内验证真实 Codex 两轮教学；先前记录不代替新产物在新机器上的验证。
- 端口固定为 4317；设置损坏、端口冲突和异常退出尚缺系统化桌面回归。
- 本地数据库保存不代表模型推理完全离线；相关目标、对话和材料会发送到用户选择的模型服务。
- 现有 PDF/OCR、全文检索等能力边界仍以 README 为准。

## 本轮留下的检查材料

- `outputs/desktop-packaged/result.json` 与 `desktop.png`
- `outputs/release-portability/audit.json` 与截图
- `outputs/release-dependency-audit.json`

临时迁移测试副本的递归清理命令被自动审批策略拦截（只返回 blocked by policy，未给出更具体原因），因此测试副本仍在系统临时目录。路径记录于 `outputs/release-audit-temp-path.txt`；另有本轮第一次复制尝试生成的空临时目录。未绕过拦截，也未删除任何项目或学习数据。
