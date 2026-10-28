# V0.14.0 · 对话界面重做

## 设计与变化

使用白色正文区、低对比灰绿色侧栏和深绿操作色。主要颜色：正文 `#24312c`、操作 `#246454`、导航 `#f4f6f4`、边界 `#e6e9e7`、次要文字 `#607065`。使用系统界面字体，避免启动时下载字体；回复行宽受控，给长文、表格和代码留出阅读空间。

- 主 Agent 从独立卡片页改为与工作台一致的导航加对话布局。页头只保留名称、用途、配置和会话信息；欢迎状态用三个真实可用的提示入口。
- 助手消息使用正文排版，用户消息使用浅色气泡；统一 Markdown、表格、引用、代码、发送者与时间样式，补充复制回复操作。
- 输入区固定在会话底部，文本框按内容自动伸缩，超过上限后内部滚动。模型选择、消息用途与发送操作集中在底部工具栏，节省垂直空间。
- 主 Agent、Teacher 对话、目标讨论、个人画像和阅读答疑共享交互与主要视觉规则，保留各自业务控件。
- 主 Agent 执行状态显示后端已有的模型、工具调用次数和本地实时计时；每秒更新计时不发送网络请求。不声称正在执行某个未收到的阶段，不展示伪造思考。
- 保留长文阅读位置、回到最新回复、失败草稿、刷新后主 Agent 草稿恢复和模型选择。对话输入区在窄窗口保持可用。
- 侧栏显示版本。主 Agent 的工作台链接支持直接打开目标页面，避免导航回首页。

## 联网参考与技能

使用 find-skills 检索并核对原始来源；以下内容作为当次设计与检查参考，未全局安装第三方技能或新增运行依赖。

- [assistant-ui Thread](https://www.assistant-ui.com/elements/thread)：正文、输入区、滚动与欢迎状态的组成。
- [AI Elements Prompt Input](https://elements.ai-sdk.dev/components/prompt-input)：伸缩输入和输入区工具栏的布局思路。
- [Anthropic frontend-design](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)：有明确意图的视觉层级、文字宽度、克制的装饰和截图复核。
- [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)：键盘、焦点、对比度、标签、窄屏与动态效果检查。

实现沿用项目原生 HTML/CSS/JavaScript；没有复制 React 示例或迁移框架。SVG 图标为本项目的简单线条实现。

## 验证

- `npm run build`：语法与资产检查。
- `npm test`：133 项自动测试通过。
- `node scripts/smoke-desktop.mjs --chat-ui`：真实 Electron 长 Markdown 回复、代码与表格、伸缩输入、复制操作、失败保留、阅读位置与输入时回写。
- `node scripts/smoke-desktop.mjs --model-picker`：五个对话入口、配置选择、保存、刷新与窄屏。
- `node scripts/smoke-desktop.mjs --streaming`：真实本机 DSH + 本地模拟服务商，模型切换、真实片段、刷新续接、取消与正式消息去重。
- `node scripts/smoke-desktop.mjs --performance`：一条 SSE、无闲时轮询、通知合并、切换隔离和输入区可见。
- `node scripts/smoke-desktop.mjs --reader`：内嵌阅读、多个标签、标记、答疑与画像流程。
- agent-browser 的 axe 检查：隔离测试的首页和主 Agent 欢迎页，WCAG 2 A/AA 检查均为 0 项违规；此结果限于这些页面与状态，不代表全应用认证。
- 成品复测聊天、模型选择与流式链路。截图保存在 `outputs/desktop-chat-ui-packaged/` 和 `outputs/desktop-streaming-packaged/`，使用隔离测试内容。

测试不修改用户学习数据，不消耗云模型额度。本版保留完整思考／工具轨迹暂缓的范围，新增的调用次数来自已有后端记录。尚未发布到 GitHub。

## 成品

`outputs/desktop-v0.14.0/AI Teacher-win32-x64/AI Teacher.exe`

退出旧版后打开，沿用原 `--data-dir` 或已保存的数据目录。桌面快捷方式是否更新以实际目标为准，旧版程序目录未删除。
