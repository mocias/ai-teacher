# V0.18.1 预发布更新

2026-11-10：精简依赖分发，Windows ZIP 约 198.4 MB。完整业务回归 339/339，成品布局、PDF 和 HTTP/stdio 后端连接及持久化检查通过。详情见 [PACKAGING](PACKAGING.md)，附件见 [v0.18.1 Release](https://github.com/mocias/ai-teacher/releases/tag/v0.18.1)。以下 V0.18.0 记录保留为历史基线，其中完整学习端到端超时仍是已知限制。

# V0.18.0 公开预发布检查

日期：2026-11-10（Asia/Shanghai）。公开仓库 `mocias/ai-teacher`，发布源码与 Windows x64 免安装 ZIP。下载无需仓库邀请；这是预发布版，尚无代码签名、安装向导或自动更新。

## 下载和使用

到 [v0.18.0 发布页](https://github.com/mocias/ai-teacher/releases/tag/v0.18.0) 下载 `ai-teacher-v0.18.0-windows-x64.zip`，完整解压后运行 `AI Teacher-win32-x64/AI Teacher.exe`。程序内置 Electron 与 Node，无需另装 Node.js；不要只移动 EXE。首次使用在「模型与分工」配置自己的 API，或选择已安装、配置好的 DSH / Codex / Claude Code。应用不附带模型账号与额度。

默认学习库在 `%APPDATA%\AI Teacher\data`，自定义目录在「桌面设置」查看。升级前退出旧应用和服务并备份整个数据目录；新版放在独立文件夹，继续使用原学习库。本次发布保留此前成品、快捷方式及学习数据。

## 构建和验证

- Windows x64，Node 24.13.0，Electron 44.4.1；按当前锁文件生成生产依赖许可证。网络下载不可用时使用本机已安装的同版本 Electron 分发文件生成构建缓存，未升级运行环境。
- `npm run build` 通过；2026-11-10 完整 `npm test` 为 339/339 通过。
- 实际发布成品通过 `--packaged --layout` 与 `--packaged --choices`，包含应用启动、原生菜单、服务退出、拖动布局、路线文本与箭头端点、首页与规划入口、考察暂停/继续及提前结束、阅读答疑区域和可点击选择题等隔离检查。
- `--packaged --learning` 在“能力提案”步骤超时，未作为通过项。本次未证明完整学习闭环端到端验收全部通过。
- 业务与桌面检查使用隔离学习库、固定回复模型或手动测试宿主；真实 DSH 的提前结束评语、所有云模型的付费推理与教学质量不在本次验证范围内。
- 核对成品的 server、public、desktop 共 133 个文件与源码逐字节一致。打包器仅从 package.json 移除 private、scripts、devDependencies，运行字段一致。
- Git 与分发包排除个人学习数据库、密钥、日志及实际宿主配置；保留 Apache-2.0 和第三方许可证。发布附件提供 ZIP 完整性检查、SHA-256 和 `verification.json`。凭据模式检查不是完整安全审计。

## 发布资产

构建目录为 `outputs/desktop-v0.18.0-release/AI Teacher-win32-x64`；附件在 `outputs/release-v0.18.0`：Windows ZIP、源码 ZIP、`SHA256SUMS.txt`、`verification.json`。

仅验证 Windows x64；未验证独立干净虚拟机、macOS/Linux 成品、PPT 转换、OCR 或所有真实模型。下载包没有自动更新功能，需手动下载后续版本。
