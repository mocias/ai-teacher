# DSH 宿主支持 · V0.9.1

V0.9 为每段站内对话保存 DSH session ID，后续使用 `--session-id` 持续恢复，所有相关对话共用一个 AI Teacher 工作目录，同时按会话保存运行数据与检查点。会话检查、检查点恢复、明确重建与备份边界见 [DSH 持续会话说明](DSH-SESSIONS-V09.md)。

在“模型与分工”中，主 Agent 和全部学习功能均可选择“宿主 + MCP → DSH / DeepSeek Harness（站点自动启动）”。保存后，新消息由本站启动本机 DSH；等待中的旧任务需点击“按当前配置重试”。各功能保持独立路由和权限。

## 配置

1. 安装支持 `headless --json -`（从标准输入读取任务）的 DSH CLI 或 DeepSeek Harness Desktop，并配置模型。当前验证安装版为 Desktop `0.2.1-rc.3`。旧 CLI 不支持此接口时需先更新。
2. 在功能配置中选择 DSH，程序自动检测并显示版本、路径与来源。**路径留空即可自动使用，无需手填安装路径**；也可点击“重新检测本机 DSH”。检测依次检查环境变量、PATH、用户 npm / pnpm / 本地 bin 目录、常用安装目录、Windows 卸载注册表、运行中的 DSH 和开始菜单／桌面快捷方式。每个候选路径需存在且能成功返回 CLI 版本；过期或损坏的候选会跳过。自定义盘符安装可通过 Windows 安装记录找到，例如本机已自动识别 `D:\DeepSeek Harness\DeepSeek Harness.exe`（`0.2.1-rc.3`）。也支持手动指定 npm 的 `dsh.cmd` 或 CLI 的 `bin.js`。Electron Desktop 通过其 Node 模式运行随附 CLI，不会打开桌面聊天窗口。
3. 模型留空时，先使用 DSH 全局或 headless 的明确模型设置；两者未指定时，沿用 Desktop 保存的模型选择及对应服务商声明。只复用模型配置，不加载 Desktop 的 UI、插件或其他 Agent。功能内填写的模型优先：只填模型 ID 使用 `deepseek-official`，其他服务商填 `provider/model`。配置只读，不更改 DSH profile 或凭据；带动态表达式的模型配置会明确拒绝复用。
4. DSH 通过自己的凭据服务读取本机保存的 API Key，或使用启动环境中的模型凭据。仅在 DSH Desktop 登录账号不代表已经配置 headless 的 API Key；本接入未启用账号授权插件。不要将 Key 填入聊天、模型名或路径。AI Teacher 的 API 模型连接密钥不会转交 DSH。

如果功能曾使用手动 MCP，切换后旧入口 Token 失效。DSH 自动处理不需要生成手动入口，也无需在 DSH 中再安装 AI Teacher 全局插件。

自动检测只读取安装位置并执行有超时限制的 `--version` 检查，不扫描整盘、不修改 DSH 配置。检测结果短暂缓存，重新检测会刷新；缓存路径消失时重新查找。自动路径不会写死进功能配置，任务执行时按当前安装位置解析。检测接口 `/api/agents/detect-dsh` 仅供已连接的本机页面使用，Agent 凭据无权调用。

## 执行与数据

站点启动 `dsh --profile headless --patch <临时 JSON/YAML> --json -`，通过标准输入发送任务，避免用户消息成为命令行参数。所有进程使用参数数组，关闭 shell，Windows 下隐藏窗口。Windows npm 和 Desktop 启动脚本会解析为真正的 Node / Electron 入口，不拼接 shell 命令。

每条消息使用一次临时 MCP 配置和凭据，仅能读取当前功能已领取任务的上下文、调用该功能的工具。任务完成、失败或取消后凭据撤销，临时配置删除。回复必须通过 MCP 写回；终端输出不会自动入库。没有成功写回的任务阻塞，页面显示失败原因，检查后显式重试。

覆盖层关闭 DSH 内置文件、命令、浏览器搜索、子 Agent、插件管理、计划模式和 MCP 资源工具，保留 Teacher 功能工具。每段对话的运行数据使用独立 DSH_HOME，进程工作目录统一为 AI Teacher 共享工作区，只加载随附的 headless profile 和本轮生成的覆盖层；原 DSH home 仅提供允许复用的模型声明与凭据来源，不加载其任意插件。

不保存 DSH 原始 stdout / stderr 到学习库，避免混入工具参数和内部推理。DSH 持久会话现保存在学习数据目录内各对话独立的 DSH_HOME，本站保存映射和检查点；完整备份须包含整个数据目录。

## 验证

- `node --test tests/dsh-model.test.mjs tests/dsh-discovery.test.mjs tests/harness-host.test.mjs tests/agents.test.mjs`：DSH 路由、临时 MCP、上下文读取与回写、凭据撤销、配置清理、无回写失败阻塞，以及原有角色隔离。
- `node scripts/smoke-desktop.mjs --dsh`：真实 Electron 界面选择 DSH 后自动显示安装路径，重新检测、保存空路径及重载后恢复均通过；可与 `--packaged` 组合验证成品。
- `node scripts/smoke-dsh-local.mjs`：隔离的临时学习库和 DSH home，无需传入路径，自动检测并启动真实安装版 DSH，复用临时 Desktop 自定义服务商配置，与本地确定性模型端点交互，经真实 stdio MCP 读取上下文并回写回答。断言模型只收到当前功能的 Teacher 工具，不调用云模型、不消耗账号额度。
- `node scripts/smoke-harness.mjs dsh`：可选真实模型检查，需要先通过路径或 `TEACHER_DSH_EXECUTABLE` 找到 CLI，并配置可用模型凭据；会使用对应服务商额度。日常自动检测不会执行此付费检查。

本次已沿用 Desktop 的 `ustc-llm / deepseek-v4-flash-ascend`，在隔离临时学习库中完成真实主 Agent 调用和 MCP 回写（3 次工具调用）。该检查确认连接可用，不代表完整教学质量评测；没有修改 DSH 用户配置或凭据。
