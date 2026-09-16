# 项目授权与第三方声明

本项目作者选择 Apache License 2.0。项目原创代码的完整授权文本位于根目录 `LICENSE`，版权与声明位于 `NOTICE`，npm 元数据使用 `Apache-2.0`。

Apache-2.0 允许使用、修改、商用和分发，包含明确的贡献者专利授权及终止条件。再分发须按完整许可证履行保留授权及相关声明、标明修改等义务；不意味着获得项目或第三方的商标授权。以 LICENSE 完整文本为准。

第三方组件不因本项目的授权选择而改成 Apache-2.0。`THIRD_PARTY_NOTICES.md` 记录实际生产依赖与运行时版本，`licenses/` 保留对应许可原文。每次更新依赖或构建 Node 版本后，运行 `npm run licenses:generate` 更新清单并审查变化；桌面打包脚本会执行此步骤。

后续重新打包的产物将包含本项目 LICENSE、NOTICE、第三方清单和许可文本；此前生成的桌面包须重新构建后才包含这些新增声明。Electron 自带的 LICENSE、LICENSES.chromium.html 也应保留。项目仍只参考 MindOS 的产品结构，没有复制其源码或品牌素材；将来若引入外部代码，应另行记录来源与许可。

官方授权原文：https://www.apache.org/licenses/LICENSE-2.0
