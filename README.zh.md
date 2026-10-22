# dsh-open-in-ide

[English](README.md) | **中文**

点击 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 对话中
回答里的文件引用，用你选择的 IDE（**默认 Visual Studio Code**，也支持 VS Code
家族与 JetBrains 系列）打开对应文件并定位到引用的行，替代内置的文档预览。

一个 DeepSeek Harness 插件（bundle + 浏览器半）。已在 DeepSeek Harness
`0.2.1-rc.2`（桌面版 / Web profile）上测试。

支持的编辑器（在宿主机器上自动检测）：

* **VS Code 家族**（`--goto <path>:<line>:<column>`）：Visual Studio Code、
  VS Code Insiders、Cursor、Windsurf。
* **JetBrains 家族**（`--line <line> <path>`）：IntelliJ IDEA、PyCharm、
  WebStorm、GoLand、CLion、PhpStorm、Rider、RubyMine、DataGrip、RustRover。

## 在界面中的位置

安装 bundle 后，刷新一次 Harness 页面。

### 1. 启用插件 —— 设置 → 插件 → 已安装插件

![插件管理页中的插件](docs/plugins-installed.png)

插件在已安装列表中显示为 **「在 IDE 中打开文件链接」**，右侧开关用于启用/停用。

### 2. 选择 IDE —— 设置 → 通用设置 →「打开文件的 IDE」

![通用设置中的 IDE 选择器](docs/settings-general.png)

下拉只列出本机检测到的 IDE；**默认 Visual Studio Code**，未安装 VS Code 时使用
扫描到的第一个。已保存的选择如果后来被卸载，也会自动回退到 VS Code 或第一个
检测到的 IDE。

## 功能

* **单击**回答中的文件引用 chip，用所选 IDE 打开对应文件并定位到引用的行。
* **连同项目一起打开**：VS Code 家族会沿路径向上找项目根（`.git`/`.hg`，否则
  `package.json`、`Cargo.toml`、`pom.xml` 等标记），把项目目录作为文件夹参数传
  给 CLI，于是 VS Code 会**打开或复用项目窗口**，而不是把文件变成散落标签塞进最近
  使用的窗口。没有任何项目标记的文件仍按原方式打开。
* 打开后会把 IDE 窗口**提到最前**（窗口最小化时先恢复）。Windows 通过一个小型
  Win32 助手绕过“后台进程无前台权限”的限制；macOS 用 `osascript` 激活应用；
  Linux 尝试 `wmctrl` / `xdotool`。
* **两个编辑器家族**：VS Code / Insiders / Cursor / Windsurf 用 `--goto` 启动；
  JetBrains（IntelliJ IDEA、PyCharm、WebStorm、GoLand、CLion、PhpStorm、Rider、
  RubyMine、DataGrip、RustRover）用 `--line <行> <路径>` 启动。浏览器只发送固定
  集合里的编辑器 id。
* **设置 → 通用设置 →「打开文件的 IDE」**只列出宿主真正能启动的 IDE（每次请求
  都会扫描已知安装位置和 `PATH`）。默认 VS Code；没有 VS Code 则用扫描到的第一
  个；已保存的选择失效时同样自动回退。
* 点击**目录**引用会在 IDE 中打开该文件夹。
* **Alt / Shift / Ctrl + 单击**保留内置预览（侧栏文档预览）。
* 顶部 toast 提示目标与 IDE，失败时给出原因（文件不存在、IDE 未安装、启动失败）。
* 无构建步骤、无依赖、无遥测。浏览器半以包的 `./client` 导出提供，宿主半只使用
  Node 内置模块。

## 环境要求

* 一个 DeepSeek Harness Web GUI（桌面版或 `web` profile）。宿主组合需要提供
  `webServer`、`connection`、`subprocess`、`fs`、`sessions` 服务；桌面版与 web
  profile 都满足。
* 至少安装一款受支持的 IDE：
  * **VS Code 家族**：Visual Studio Code、VS Code Insiders、Cursor、Windsurf。
  * **JetBrains 家族**：IntelliJ IDEA、PyCharm、WebStorm、GoLand、CLion、
    PhpStorm、Rider、RubyMine、DataGrip、RustRover。
* 兼容性说明：浏览器半依赖当前聊天 UI 的文件引用 chip 结构（`_fileMention_*`
  按钮，作者路径在 `title` 属性里）。Harness 未来的 UI 改动可能需要适配；提
  issue 时请附上 Harness 版本。

## 安装

本插件是标准 DSH bundle，通过 Plugin Manager（设置 → 插件）或 `plugin_manager`
工具安装。本地目录安装会把源码目录链接进 profile，改代码即时生效。

1. 克隆仓库：

   ```bash
   git clone https://github.com/harrithy/dsh-open-in-ide.git
   ```

2. 从这个目录安装 bundle。可在 Harness 中打开 **设置 → 插件 → 安装**，或让
   agent 用 `plugin_manager` 工具执行 `action: install_bundle`，`target` 填这个
   目录的绝对路径。也可以用 profile 的包管理器做 `link:` 安装：

   ```bash
   dsh plugin --profile <profile> add link:/path/to/dsh-open-in-ide
   ```

3. **刷新 Harness 页面**（F5）。Plugin Manager 中会出现 bundle `dsh-open-in-ide`
   和行 `open-in-ide`，通用设置里会出现新的一行（见[在界面中的位置](#在界面中的位置)）。

## 使用

* 点击回答里的文件引用（如 `src/app.ts:42`），文件会在所选 IDE 中打开并定位到
  第 42 行。
* 在 **设置 → 通用设置 →「打开文件的 IDE」** 中选择 IDE；下拉只列出宿主检测到
  的 IDE。
* 选择保存在浏览器（`localStorage`，键 `dsh.open-in-ide.editor`）；插件改名前的
  旧键会被读取一次以完成迁移。
* 行号/列号取自 chip 文字末尾的 `:42` / `:42:7`。Harness 只把路径暴露在 DOM 的
  `title` 属性中，所以链接文字是行号的通道。绝对路径和相对工作区的路径都支持，
  相对路径由宿主按 Session 的工作目录解析。
* 列号只会传给 VS Code 家族启动器；JetBrains 启动器只接收行号。
* 目录引用会作为工作区文件夹打开。

## 配置

行配置在 `cordis.patch.yml` 中；在 profile 自己的 `cordis.patch.yml` 里覆盖即可
（用户 patch 层在插件升级后仍保留）：

```yaml
- id: open-in-ide
  config:
    command: 'C:\Users\me\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd'
    reuseWindow: true
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `command` | `''` | 显式指定编辑器 CLI：PATH 名（`code`）或绝对路径（`...\bin\code.cmd`）。设置后优先于设置页选择；留空则设置页选择生效。 |
| `commandKind` | `vscode` | 配置了 `command` 时使用的启动约定：`vscode`（`--goto`）或 `jetbrains`（`--line`）。`command` 为空时忽略。 |
| `editor` | `vscode` | 请求未携带选择时的回退 IDE：任意受支持的 id，如 `vscode`、`cursor`、`idea`、`pycharm`、`webstorm`。 |
| `reuseWindow` | `false` | 追加 `--reuse-window`，在最近窗口打开（仅 VS Code 家族）。VS Code 本身会把文件路由到已打开该目录的窗口。 |
| `openProjectFolder` | `true` | 把文件所属项目根作为文件夹参数传入，让 VS Code 打开/复用项目窗口（仅 VS Code 家族）。设为 false 交给 VS Code 决定。 |
| `projectMarkers` | 内置列表 | 覆盖项目根标记：不带路径分隔符的文件/目录名，例如 `['.git', 'package.json', 'Cargo.toml']`。 |
| `focusWindow` | `true` | 打开后把 IDE 窗口提到最前（最小化时先恢复）。设为 false 则交给系统决定。 |
| `focusDelayMs` | `350` | 首次置前尝试的延迟；冷启动的编辑器窗口还没出现时会自动重试几次。 |
| `extraArgs` | `[]` | 放在目标参数之前的额外参数，例如 `["-n"]`。 |
| `launchWatchMs` | `2000` | 分离启动器的早期失败观察窗口；窗口结束时仍在运行的启动器视为启动成功。 |

## 检测与启动解析

宿主提供两个路由，均先经过组合的 connection 信任检查（Host/Origin 防跨站 + 浏览器
认证）：

* `GET /open-in-ide/editors` —— 每次请求都探测支持的编辑器 id（路径存在性检查 +
  进程内 `PATH` 解析），返回本机能启动哪些。
* `POST /open-in-ide/open` —— 校验 `{ sessionId, path, line, column, editor }`，
  按 Session 工作目录解析路径，然后按家族约定分离启动所选编辑器，子进程使用凭据
  清理后的环境。

检测顺序：

* **Windows**：
  * VS Code 家族：`%LOCALAPPDATA%` / `%ProgramFiles%` 下的已知安装目录，然后是
    `PATH` 上的 CLI 名。即使 Cursor 把 `code` 注册成自己的命令，`vscode` id 仍会
    解析到真正的 VS Code 安装，因为已知目录先于 `PATH` 尝试。
  * JetBrains：Toolbox 启动脚本
    （`%LOCALAPPDATA%\JetBrains\Toolbox\scripts\<cli>.cmd`）、Toolbox 应用目录
    （`…\Toolbox\apps\<app>\ch-<n>\<version>\bin\<exe>`）、独立安装
    （`%ProgramFiles%\JetBrains\<Product 2024.x>\bin\<exe>`），最后是 `PATH`
    上的 CLI 名。
* **macOS**：VS Code 家族用 `.app` 内的
  `Contents/Resources/app/bin/<cli>`；JetBrains 用 `<App>.app/Contents/MacOS/<cli>`；
  两者都回退到 `PATH`。
* **Linux**：常见安装路径（`/opt/...`、`/usr/bin/...`、snap 路径）和
  `~/.local/share/JetBrains` 下的 Toolbox 脚本目录，最后是 `PATH`。

浏览器从不发送命令行：它只发送固定集合里的编辑器 id，宿主把它解析为自己验证过的
可执行文件。

## 限制

* 只重定向内置 Markdown 文件引用 chip。工具调用卡片里的文件名、交付文件卡片和
  文档预览保持各自的打开方式。
* 支持的编辑器与启动约定：VS Code 家族（`--goto <path>:<line>:<col>`）与
  JetBrains 家族（`--line <行> <路径>`）。自定义 `command` 必须接受
  `commandKind` 指定的约定。
* 检测覆盖上面列出的编辑器 id；不在 `PATH` 上的便携版或列表之外的编辑器需要
  `command`。
* 列号只会传给 VS Code 家族；JetBrains 启动器只接收行号。
* 置前是尽力而为：Windows 通过 Win32 助手实现（极特殊的前台策略或安全软件仍可能
  拒绝），macOS/Linux 依赖 `osascript` / `wmctrl` / `xdotool` 是否可用。
* 项目文件夹注入是启发式且仅用于 VS Code 家族：向上找最近的 `.git`/`.hg` 或
  manifest 标记。JetBrains 保持自己的项目管理，只接收文件/行号，不传文件夹。
* 行号/列号来自可见的 chip 文字；链接文字没有行号时只打开文件、不定位。
* 编辑器选择按浏览器保存（`localStorage`）；不同浏览器或 origin 各自独立。

## 开发

```text
index.js               宿主半：检测 + 打开路由、启动逻辑
client.js              浏览器半：设置行、点击桥、toast
cordis.patch.yml       bundle 行声明 + 默认配置
locale/{en,zh}.json    Plugin Manager 标题/描述
icon.svg               插件图标
docs/                  本 README 使用的截图
```

没有构建步骤：`index.js` 由 Loader 加载，`client.js` 作为包的 `./client` 导出
提供给浏览器。本地目录安装会链接进 profile，因此修改文件可通过 HMR 生效（浏览器
半立即生效；宿主半在插件行重载后生效）。

## 许可证

MIT，见 [LICENSE](LICENSE)。
