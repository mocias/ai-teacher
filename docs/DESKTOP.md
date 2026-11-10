# AI Teacher 桌面版

本版参考 MindOS 的桌面客户端、本地服务及 MCP 接入结构，复用现有教学工作台。参考：https://github.com/GeminiLight/MindOS 。未复制 MindOS 源码、界面或品牌素材。

## 打开应用

当前版本为 V0.18.1 预发布版。从公开的 [GitHub 发布页](https://github.com/mocias/ai-teacher/releases/tag/v0.18.1) 下载 `ai-teacher-v0.18.1-windows-x64.zip`，完整解压后双击 `AI Teacher-win32-x64/AI Teacher.exe`；无需另装 Node.js。应用不附带模型账号或额度，首次使用到「模型与分工」配置 API 或已安装的模型宿主。

本地发布成品位于 `outputs/desktop-v0.18.1-release/AI Teacher-win32-x64/AI Teacher.exe`；默认打包目录仍是 `dist`。关闭旧版后打开新版 EXE，沿用原学习数据目录。整个文件夹构成应用，不能只拷贝其中的 EXE，也不要在压缩包里直接运行。V0.14 的对话界面见 [说明](CHAT-UI-V014.md)，V0.14.1 的插件模型接入见 [说明](DSH-MODELS-V0141.md)。

V0.8 的 `node scripts/smoke-desktop.mjs --recovery` 验证重新排期与完整学习闭环，可与 `--packaged` 组合。规则和验收记录见 [V0.8 说明](RECOVERY-V08.md)。

应用内置 Electron 与 Node 运行环境；模型 API 仍需自行配置。选择 Codex、Claude Code 或 DSH 自动处理时，需在本机安装并配置相应宿主。DSH 支持本机 CLI 和 DeepSeek Harness Desktop，配置见 [DSH 宿主支持](DSH-HOST.md)。每条任务由桌面服务启动宿主，并通过任务专属 MCP 写回。这是可运行的免安装桌面版本，尚未提供安装向导、代码签名、自动更新、托盘或开机启动。

使用 `node scripts/smoke-desktop.mjs --canonical` 可在独立临时库运行双目标验收。成品模式先设置 `TEACHER_PACKAGE_DIR` 为本版应用目录，再加 `--packaged`。该流程通过桌面界面验证跨目标作答、材料裁决、滚动队列、周排期、笔记邀请、阶段自测与开卷检索，推理来自本机固定回复模型。

网页阅读默认沿用系统网络。如果加载失败，检查「模型与分工 → DSH 联网」中的本机代理地址，在阅读器点击「阅读器使用本机代理并重试」。选择对所有网页标签页生效，重启后保留。点击「阅读器切回系统网络并重试」可恢复。网页加载失败期间不会记录阅读进度。

阅读器右上角可收起或展开答疑侧栏，显示偏好会保存。工具栏始终显示系统网络或本机代理及加载状态，网络按钮可直接展开相应设置。

顶部「收起导航」控制左侧主导航，对话标题旁「收起会话列表」控制当前目标的对话列表。两个开关独立保存；点击展开可恢复。折叠保持草稿、当前阅读位置与阅读器正文。窄屏首次打开时，会话列表默认收起。

首页右侧可切换「今天」与「目标与日历」。Teacher 对话列表按目标规划、任务学习和正式考察分组。阅读侧栏提供「答疑、标记、目标」三个页签；切换保留输入草稿和提问引用，待处理答疑及网络提示仍可见。页签支持左右方向键、Home 和 End。

普通对话的输入区有「＋ 附件」，也可直接把文件拖入对话。拖入后检查附件列表，再发送消息；文件副本会保存在资料库，不会自动设为主材料。每条消息最多 5 个文件，合计 20 MB。Markdown/TXT 可供 Teacher 读取限额内的文字摘录，其他格式若未提取正文，会提示提供文字内容。

从任务或资料库打开阅读器后，顶部的「返回…」回到刚才位置；网页工具栏的后退箭头继续只控制网页历史。

Teacher 对话中的新选择题会随问题显示选项。单选点击一个选项即提交；多选选好后点击「提交选择」。已提交的选项保留供回看，不重复作答。简答题仍使用输入框。旧的纯文字题目和不支持结构化工具的模型回复不会被猜测为选择题。

选择题的教学偏好是先给简洁选项，再视实际回答追问理由、辨析错误；用户需要直接讲解时可以调整。该偏好通过模型提示词提供，不会由程序强制增加题数或拦截带解释的选项。

出题提示词同时建议检查题干里的答案暗示：后续小问、括号和反问尽量不替前一问作答；需要依赖用户判断的推演通常在回答后继续。用户主动求提示或本轮已有明确前提时可灵活处理。

## 设置与数据

- 菜单「AI Teacher → 桌面设置」可查看服务与数据目录、打开数据目录、选择已有学习库；变更目录在重启后生效。
- 左侧「模型与分工」按功能配置模型 API、Codex、Claude Code、DSH 或手动 MCP；「提示词与连接」保留学习提示词和宿主连接说明。
- 正式包首次启动默认使用 Electron 用户数据目录下的 `data` 子目录（通常为 `%APPDATA%/AI Teacher/data`）。开发启动默认使用项目 `data`。
- 可在「桌面设置」中选择已有数据目录；命令行也支持 `"AI Teacher.exe" "--data-dir=<已有数据目录>"`。占位符须替换为实际路径，选择会被记住。已有库须包含 `teacher.sqlite`；直接使用原目录，不移动、不复制、不合并。
- 窗口大小和数据目录选择保存在用户数据目录的 `desktop.json`；关闭窗口退出应用。应用启动的服务随之停止；连接到已有同库服务时，不会替用户停止它。
- 本地服务监听 `127.0.0.1:4317`。已有同库且支持宿主路由、学习闭环、复习反馈和补学计划的服务可复用；端口被旧版服务、其他库或其他程序占用时会明确提示。更新桌面包后请先退出旧版窗口和服务，再打开新版。

学习库仍为 SQLite，凭据和模型密钥文件也在数据目录；备份需保留整个目录。应用包不包含个人学习数据。原插件仍在源码 `plugins/ai-teacher` 中，连接当前项目学习库时可继续使用；切换到其他数据目录后，手动宿主的 token/连接配置也须相应调整。桌面内 Codex 自动唤醒使用任务专用适配器，不依赖安装该插件。

## 开发与验证

```
npm install
node node_modules/electron/install.js
npm run desktop
npm run desktop:package
node scripts/smoke-desktop.mjs
node scripts/smoke-desktop.mjs --packaged
node scripts/smoke-desktop.mjs --learning
node scripts/smoke-desktop.mjs --followups
node scripts/smoke-desktop.mjs --remediation
```

打包脚本携带运行该脚本的 Node，因此在 Windows x64、Node 22.13+ 环境构建。现验证使用 Node 24。打包完成后再运行 packaged smoke，勿同时进行。

默认打包会更新运行环境许可证。网络不可用时可设置 `TEACHER_OFFLINE_LICENSES=1`；只接受与当前 Node 版本、来源 URL 和 SHA-256 均匹配的已缓存许可证，缺失或不匹配会停止构建。

如果 Electron 下载缓存位于其他目录，可用 `TEACHER_ELECTRON_ZIP_DIR` 指定存放当前版本 `electron-v<版本>-win32-x64.zip` 的目录，打包器直接读取该文件，无需重复下载。

Smoke 使用独立临时数据库和 Electron 用户目录，检查真实桌面渲染、API 会话、原生菜单和退出后服务停止，截图与结果保存至 `outputs/desktop-*`。普通业务 smoke 使用本地模拟模型；`--registry` 及 `scripts/smoke-dsh-registry.mjs` 会读取本机 DSH 配置与插件登录并可能同步目录，但不发送推理提示词。业务回归运行 `npm test`，语法和必需资源检查运行 `npm run build`。

`--reader` 验证阅读、笔记、章节恢复及任务重试；`--learning` 使用本机模拟模型，通过真实桌面界面跑完整的资料导入、目标关联、诊断、路线确认、排期、学习考察、复习及最终完成。`--followups` 扩展完整学习验收，加入答错、结果页安排复习、取消与来源保留、回看原资料、复习仍失败和强化后解决的流程。指定成品目录可设置 `TEACHER_PACKAGE_DIR` 后运行 `--packaged --followups`。不同流程应分别运行，避免混用各自的隔离数据假设。详见 [V0.6 验收说明](REVIEW-FOLLOWUPS-V06.md)。

V0.6 首次打开已有目标的旧库时，新增复习来源表之前在同库 `backups/` 内创建 `before-review-followups-*.sqlite` 一致性备份。旧复习保留，不推测其来源；只有新版从结果页创建的复习记录实际来源。

V0.7 的 `--remediation` 在完整学习与复习流程中继续验证补学排期、资料选择、进度保存与重载恢复、取消和强化衔接；可与 `--packaged` 组合。首次打开已有目标的旧库时，新增补学来源表之前创建 `backups/before-remediation-*.sqlite` 备份。详见 [V0.7 说明](REMEDIATION-V07.md)。

V0.10.0 的 `--chat-ui` 验证 Markdown 清理、固定输入区、窄窗口、草稿恢复、发送失败保留、阅读滚动位置与首页输入时的回复更新，可和 `--packaged` 组合。详见 [V0.10.0 界面说明](UI-V010.md)。DSH 的独立 headless 会话目前不在原生 Desktop 列表中显示。

V0.11.0 使用 `--streaming` 验证真实本机 DSH 的回复正文在模型生成结束前进入页面，并覆盖刷新续接、最终保存去重和取消。可与 `--packaged` 组合；使用独立 DSH 配置、本地模型和临时学习库，不调用云端模型。详见 [流式说明](STREAMING-V011.md)。

V0.14.1 补齐 DSH 插件模型目录与 headless 执行，详见 [DSH-MODELS-V0141.md](DSH-MODELS-V0141.md)。

V0.14.2 允许主 Agent 直接调用配置工具，模型目录使用跨重启缓存和后台刷新；见 [直接设置与列表提速](DIRECT-CONFIG-V0142.md)。

V0.14.3 的交互与联网诊断见 [说明](FEEDBACK-WEB-V0143.md)，验收命令为 `node scripts/smoke-desktop.mjs --feedback`。

## V0.18.1 打包精简

发布时排除浏览器 PDF 阅读不需要的 Node Canvas/Skia、PDF 旧版构建、调试映射、类型声明和依赖测试/示例；开发安装保持完整。Node 运行环境、浏览器 PDF worker、字体、字符映射、WASM 和许可证保留。体积测量与成品后端/PDF 验证见 [PACKAGING](PACKAGING.md)。
