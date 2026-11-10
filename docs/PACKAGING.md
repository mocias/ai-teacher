# 桌面包体积与验证

## V0.18.1（2026-11-10）

本版只精简分发内容，不更改教学业务、数据目录或模型宿主的运行方式。过滤规则位于 `scripts/desktop-package-content.mjs`，由 `scripts/package-desktop.mjs` 调用；源码和开发用 node_modules 保持完整。

| 项目（十进制 MB） | v0.18.0 | v0.18.1 |
| --- | ---: | ---: |
| Windows ZIP | 221.7 | 约 198.4 |
| 完整解压文件合计 | 568.3 | 约 493.9 |
| 生产依赖目录 | 90.8 | 16.3 |

ZIP 约减少 23.3 MB（10.5%），依赖目录约减少 74.5 MB（82%）。最终附件的精确字节数和哈希见 Release 的 verification.json 与 SHA256SUMS.txt；目录总量不含文件系统簇开销。

## 删除的冗余

- PDF.js 可选的 Node Canvas/Skia 原生渲染器（@napi-rs/canvas 及平台包）。当前 PDF 阅读在受隔离的 Chromium 页面中使用原生 Canvas，后端仅提供文件和静态资源，不导入 PDF.js 做服务端渲染。
- PDF.js 的 legacy、web、image_decoders、types 等未使用构建。保留程序实际使用的 build/pdf.mjs、build/pdf.worker.mjs，以及 cmaps、standard_fonts、wasm 和许可证。
- 依赖的 source map、TypeScript 类型声明、测试、fixture、示例，以及安装时的 node_modules/.package-lock.json。

Electron 自带 Chromium，所以桌面核心仍占较大体积。独立 Node 还用于 SQLite 本地服务和 Codex/Claude/DSH 的 MCP 桥接；本版保留该运行环境，避免将打包优化变成宿主兼容性改造。所有语言、图形运行库和媒体支持也保留。

## 验证

- npm run build 与 339 项业务测试通过。
- 实际精简成品通过布局、PDF 冒烟检查；PDF 检查覆盖两页真实显示、非空画布、文本层、翻页、阅读位置持久化，以及 CMap、标准字体、WASM 资源可访问。
- 使用成品内置 Node 和成品依赖运行后端检查：HTTP/stdio MCP 工具发现、领取任务、获取上下文、回复写回及 SQLite 重启恢复均通过。不会通过开发 node_modules 补齐缺失依赖，也不调用付费模型。
- V0.18.0 的完整学习端到端脚本在“能力提案”处超时，本版未修改该流程，也没有将其标为通过。未重新验证真实云模型、DSH 评语、PPT/Office 转换或独立干净虚拟机。

```powershell
$env:TEACHER_PACKAGE_DIR = 'outputs/desktop-v0.18.1-release/AI Teacher-win32-x64'
node scripts/smoke-desktop.mjs --packaged --pdf
node scripts/smoke-desktop.mjs --packaged --layout
& "$env:TEACHER_PACKAGE_DIR/resources/app/runtime/node.exe" scripts/smoke-package-backend.mjs
```

以后若加入服务端 PDF 渲染、使用依赖示例代码或更换 PDF 入口，必须重新核对过滤规则并执行成品验证，不能仅依赖开发环境测试。
