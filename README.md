# EBSCO MUST DOI PDF 下载 CLI

通过澳门科技大学代理站登录 EBSCO，输入 DOI，自动获取第一条全文结果并下载 PDF。

## 系统要求

- Node.js 20 或更高版本
- npm
- macOS、Linux 或 Windows
- 有权访问澳门科技大学代理与相应 EBSCO 全文资源

## 从 GitHub 安装

仓库当前为私有仓库，先确保 GitHub CLI 已登录且 Git 可以访问该仓库：

```bash
gh auth login
npm install --global github:iihciyekub/ebsco-must-doi-download#v1.0.0
npx playwright install chromium
ebsco-doi --version
```

## 本地开发安装

```bash
git clone git@github.com:iihciyekub/ebsco-must-doi-download.git
cd ebsco-must-doi-download
npm install
npx playwright install chromium
npm link
npm test
```

## 升级

检查是否有新版本，但不安装：

```bash
ebsco-doi update --check
```

升级到 GitHub 最新正式 Release：

```bash
ebsco-doi update
```

私有仓库的版本查询需要 `gh auth login`。升级命令只接受正式 GitHub Release，不会自动安装未发布的分支代码。也可以手动安装指定版本：

```bash
npm install --global github:iihciyekub/ebsco-must-doi-download#v1.0.0
```

## 使用

交互模式：

```bash
ebsco-doi
```

首次运行会打开可见的 Chromium。手动完成学校代理/EBSCO 登录，确认已进入 EBSCO 后回终端按 Enter。CLI 会沿用这个浏览器完成当前任务（避免关闭窗口导致 MUST 会话 Cookie 丢失），并显示 `DOI>` 提示符。以后的有效会话默认可在无头模式恢复。

以后每次启动都会实际访问 EBSCO 验证会话，而不是只相信本地登录标记。如果学校登录会话已经过期，CLI 会自动重新打开可见浏览器要求登录。

在 macOS 上可以把账号密码分别保存到 Keychain。保存后，CLI 只在实际跳转到 MUST 登录页时读取并自动填写，源码和配置文件中不会保存明文密码：

```bash
security add-generic-password -U -s ebsco-must-doi-download.username -a ebsco -w
security add-generic-password -U -s ebsco-must-doi-download.password -a ebsco -w
```

每条命令会提示输入对应值。其他系统也可以通过 `EBSCO_USERNAME` 和 `EBSCO_PASSWORD` 环境变量提供凭据。

搜索和下载期间，终端会用同一行动态显示当前阶段和耗时，例如：

```text
⠹ [10.1287/msom.2022.1170] 正在搜索网页，等待第一条结果 (4s)
```

结果定位不依赖网页生成的随机 CSS class 或元素 `id`，并会在页面响应慢或下载请求暂时失败时自动进行有限重试。

也可以直接传入一个或多个 DOI：

```bash
ebsco-doi 10.1287/msom.2022.1170
ebsco-doi 10.1287/msom.2022.1170 10.1000/example
```

从 TXT 或 CSV 扫描所有 DOI，并使用 4 个并发 worker 下载：

```bash
ebsco-doi --file input.txt
ebsco-doi --file input.csv --concurrency 4
ebsco-doi input.csv -c 4
```

需要更高并发时可使用 8；多个文件可以重复传入 `--file`。所有来源的 DOI 会统一去重：

```bash
ebsco-doi -f part1.csv -f part2.txt -c 8
```

默认推荐并发数 4，对学校代理和 EBSCO 更温和。批量运行使用一个汇总进度行，结束后会列出失败 DOI 及原因。

PDF 默认保存到 `downloads/`，文件名中的 `/` 会替换成 `_`。例如：

```text
downloads/10.1287_msom.2022.1170.pdf
```

常用选项：

```bash
ebsco-doi --headed                       # 显示浏览器，便于排错
ebsco-doi --reset-login                  # 登录失效后重新显式登录
ebsco-doi -o /path/to/pdfs DOI           # 指定下载目录
ebsco-doi --profile /path/to/profile     # 指定登录配置目录
ebsco-doi --version                      # 查看当前版本
ebsco-doi update --check                 # 仅检查新版本
ebsco-doi update                         # 安装最新 Release
```

## 本地文件与安全

以下内容只保存在本机，并已通过 `.gitignore` 排除：

- `.ebsco-profile/`：浏览器配置、Cookie 和认证状态
- `downloads/`、`*.pdf`：下载的全文
- `*.txt`、`*.csv`：用户输入数据
- `.env*`：环境变量文件
- Playwright 调试产物和 npm 临时包

macOS 自动登录密码保存在系统 Keychain，不在项目目录。请不要提交机构账号、密码、Cookie、输入数据或下载文献。

## 版本策略

项目采用语义化版本号：

- 补丁版本 `1.0.x`：兼容性修复
- 次版本 `1.x.0`：向后兼容的新功能
- 主版本 `x.0.0`：存在不兼容变化

版本历史见 [CHANGELOG.md](CHANGELOG.md)。

请仅下载你的机构授权访问且你有权使用的内容。
