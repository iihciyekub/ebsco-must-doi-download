# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)；GitHub Release tag 使用 `vX.Y.Z`。

## 1.0.1 - 2026-07-11

- 修复 npm 直接从私有 Git 仓库全局安装可能产生失效临时链接的问题。
- 安装和自更新改为下载 GitHub Release 的固定 `.tgz` 附件。
- 自更新兼容已有全局安装和本地 `npm link`。

## 1.0.0 - 2026-07-11

首个正式版本：

- 首次显式登录、持久会话以及 macOS Keychain 自动登录。
- 根据 DOI 搜索 EBSCO 第一条全文结果并校验、下载 PDF。
- 从 TXT/CSV 稳健提取、清理和去重 DOI。
- 支持 4 或 8 个并发 Playwright worker 和单行批量进度。
- 支持 `ebsco-doi update` 从 GitHub Release 自更新。
