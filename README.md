# 可露希尔的 Codex

## macOS 移植版

`codex/macos-port` 分支是基于 [OndoP3901/Closure-Codex v0.6.0](https://github.com/OndoP3901/Closure-Codex/tree/v0.6.0) 的非官方移植，适用于 Apple Silicon Mac。可以从源码在本机打包成 `Closure Companion.app`。

- 桌宠支持独立运行、跟随 Codex 窗口和登录自启。
- Codex 任务开始和完成时，桌宠可以切换动作、弹出气泡并播放语音。默认使用日语原声，播报时右键可跳过当前一句。
- 支持查看 Token 用量和额度，还可以手动启用 Codex 深色配色与页面内 CRT 效果。

[macOS 安装和使用说明](README-macOS.md) · [macOS 更新日志](CHANGELOG-macOS.md) · [素材与第三方许可](outputs/closure-companion/upstream/NOTICE.md)

## 上游 Windows 版说明

把《明日方舟》的可露希尔带到 Windows 桌面。桌宠可随 Codex 工作，也可独立运行，内置 57 条游戏原声，支持自定义语音队列和随机轮换。项目仅提供 Codex 深色主题及页面内装饰，旧 CRT 覆盖层已停用。

本指南对应 `v0.6.0`。这一版将桌宠的联动、显示范围与开机自启拆为独立选项，新增对话字号与气泡大小调整，并让气泡在拖动和吸附时跟随角色。主题仅维护深色，顶部与最左侧菜单使用连续的页面内装饰，一键启用后无需手动导入配色。 [完整更新日志](CHANGELOG.md)

## 下载与安装

1. 确认电脑使用 Windows x64。使用 Codex 联动与主题时，还需安装 Microsoft Store 版 Codex。
2. 使用完整的 `Closure-Codex-v0.6.0-win-x64.zip`，包内已附带 Electron 运行时，无需另装 Node.js。发布版本下载入口见 [GitHub Releases](https://github.com/OndoP3901/Closure-Codex/releases)，源码本地构建后位于 `dist`。
3. 完整解压到当前用户可写、想长期保留的位置，然后双击解压目录里的 `Install.cmd`。不要直接在压缩包内运行，也不要只复制单个启动文件；桌宠设置保存在解压目录的 `work/companion-profile`，运行后需继续保留整个文件夹。
4. 安装后桌宠立即显示，默认随 Windows 登录自动启动。右键桌宠可分别勾选「Codex 联动」「在桌面和其他软件中显示」和「开机自启」；首次使用默认不联动 Codex，默认允许在桌面和其他软件中显示。主题通过下方的一键入口单独启用。

### 升级与卸载

- 升级时将新版解压到新目录。先退出旧桌宠，将旧目录的 `work/companion-profile` 复制到新版对应位置，再运行新版 `Install.cmd`，以沿用三个运行选项、位置、大小、帧率、对话字号、气泡大小、声音和个人语音队列。已关闭的开机自启继续保持关闭；旧运行模式迁移为联动选择，未保存过气泡选项的旧配置继续使用 24 px 与 100%。主题识别记录保存在用户本地数据目录，无需复制 Codex 账号；从新版目录再次运行 `Enable-Codex-Theme.vbs`，即可更新快捷方式和注入路径。
- 卸载主题时先保存 Codex 工作，运行 `Restore-Codex-Appearance.vbs`；它会恢复原外观及普通启动并移除主题快捷方式。再运行 `Uninstall.cmd` 停止桌宠、移除 Windows 登录启动项。两者分别管理，卸载不会清除个人配置。移动安装目录后，应从新位置重新运行 `Install.cmd` 和主题启用入口。

## 一键启用深色主题

1. 完整解压安装包到长期保留的位置。**首次使用请先正常打开 Microsoft Store 版 Codex，等待主界面出现**，保存正在编辑的内容，然后双击根目录的 `Enable-Codex-Theme.vbs`。启动过程隐藏终端，无需管理员权限，也无需另装 Node.js。
2. 程序自动识别安装位置及运行中 Codex 的真实配置目录并保存。普通窗口首次接入会重启一次，沿用原账号、聊天记录与设置；配色、字体、顶部菜单栏和页面内 CRT 一起加载，**无需再到设置中导入主题**。窗口已有主题入口时直接接入，不重启。
3. 以后使用桌面或开始菜单中的「Codex - 可露希尔深色主题」快捷方式启动；再次双击 `Enable-Codex-Theme.vbs` 也可以。**完全退出后也会使用已保存的配置直接启动主题实例，只启动一次，不再重启。**快捷方式隐藏终端，正常完成不弹提示。原版 Codex 快捷方式保留，直接从原快捷方式打开普通实例后，再接入主题仍需重启一次。

首次未打开 Codex 时脚本只提示先打开，不会代为启动、猜测账号目录。保存的配置目录被移动或删除后，先正常打开 Codex，再运行主题入口即可重新识别。

双击 `Restore-Codex-Appearance.vbs` 可隐藏终端执行恢复：停止主题、移除本项目创建的快捷方式并将该实例恢复为普通启动。原外观设置未被覆盖，之前手动导入过的配色会保留；恢复操作不会将它重置成 Codex 出厂配色。

启用或恢复失败时会弹出错误及日志位置。CMD 排错入口位于 `tools`：需要查看控制台输出时运行 `tools\Enable-Codex-Theme.cmd --debug` 或 `tools\Restore-Codex-Appearance.cmd --debug`。不加参数时转交根目录的隐藏入口；日常使用根目录 `.vbs` 或主题快捷方式。

本入口适用于 Windows x64 的 Microsoft Store 版 Codex，当前已实测 `26.1117.4957.0`。不修改官方安装目录、签名或 ASAR。找不到 Codex、原配置不明确或多个原配置实例并存时会报错，不猜测账号目录。调试端口仅绑定本机，更新后若不兼容会提示错误并尝试恢复普通启动。状态与日志保存在 `%LOCALAPPDATA%\ClosureCodexTheme`。

主题统一通过 `Enable-Codex-Theme.vbs` 启用。[深色配色数据](outputs/closure-theme/closure-dark.txt) 由主题程序自动读取，无需复制或手动导入。

| 模式 | 背景 | 正文 | 强调色 |
| --- | --- | --- | --- |
| 深色 | `#0a0b16` | `#eef0ff` | `#ff3ea5` |

主题优先使用 Cascadia Mono，中文回退到等线等系统字体。想使用像素字体，可安装 Fusion Pixel 12px，并在 Codex 的外观设置中把界面字体设为简体中文比例版、代码字体设为简体中文等宽版。 [Fusion Pixel 12px](https://github.com/TakWolf/fusion-pixel-font/releases)

## 桌宠与装饰

左键点桌宠会播放互动动作。按住角色拖动，松开后会吸附到工作区边缘。

已显示的气泡会在拖动与吸附过程中跟随桌宠，靠近屏幕顶部时自动移到角色下方。

右键菜单中的「对话字号」与「气泡大小」互相独立：字号控制文字，气泡大小控制换行宽度、留白和外框，不会缩放桌宠本身。两项调整即时生效、自动保存，不重播当前语音。屏幕空间不足时，气泡会重新换行，必要时临时缩小显示字号；空间恢复后使用保存的字号。

右键点击角色打开设置面板。

| 设置项 | 用法 |
| --- | --- |
| Codex 联动 | 勾选后启用任务动画、场景语音和额度反馈，显示范围保持原有选择。 |
| 在桌面和其他软件中显示 | 默认勾选，允许桌宠常驻桌面和其他软件上方；取消后仅在 Codex 主窗口位于前台时显示。与 Codex 联动分别控制。 |
| 开机自启 | 默认勾选，随 Windows 登录启动；取消勾选立即移除启动项，当前桌宠继续运行。 |
| 镜像、大小、透明度、气泡 | 按需调整显示效果。点「重置位置」可恢复桌宠的默认位置。 |
| 帧率 | 拖动「大小」下方的滑条，在 30–60 FPS 之间以 1 FPS 为步长调节。待机、互动和工作动画均使用所选帧率，默认 60 FPS。调整即时生效，重启后保留。 |
| 配音语言、配音音量、音效 | 切换普通话、日语、英语或韩语，字幕保持简体中文。角色配音和 UI 音效可以分别开关和调节音量。 |
| 语音队列 | 查看各场景的默认队列，或切换到个人队列试听和编辑。 |
| 预览表情 | 预览哭脸、庆祝、思考等动画。 |
| 对话字号、气泡大小 | 字号 12–36 px，默认 24 px；气泡大小 60%–160%，默认 100%，独立调整气泡宽度与留白。调整即时生效并保存，文字按屏幕空间换行。 |
| 页面装饰 | 双击根目录 `Enable-Codex-Theme.vbs` 隐藏终端、一键启用原账号下的深色主题、菜单栏与 CRT，自动创建后续启动快捷方式，无需手动导入。源码目录的 `tools/decoration-preview/Preview.cmd` 提供开发预览，不随安装包分发。 |
| 提醒与播报 | 勾选 Codex 联动后，自动额度提醒可设为关闭、每分钟或每五分钟，也可以单独关闭工具失败提示。 |

旧版扫描线、暗角、DSH 顶栏和紫色渐变的外部覆盖层已停用，桌宠右键菜单不再提供旧 CRT 设置。新的装饰直接在页面元素的背景中绘制，源码与使用说明见 [页面内主题说明](outputs/closure-decoration/README.md)。

左侧菜单与内层导航统一使用主题深色背景；主工作界面和设置之间切换时保持菜单栏装饰与 CRT 连续显示，不随工作区重新挂载而撤销整页样式。

最左侧竖向应用菜单使用与顶部菜单一致的紫蓝渐变和细网格，右侧以洋红细线分隔；左上角补齐间隙，渐变与网格使用相同坐标连续衔接，粉色横线从竖向菜单右缘开始。聊天列表继续使用深色背景，Codex / ChatGPT 字标保留原样。

### 联动、显示范围与开机自启

1. 右键点击桌宠，按需勾选「Codex 联动」。它只控制任务动画、场景语音和额度提醒，手动启动也会生效；勾选或取消均不会改变桌宠的显示范围。
2. 「在桌面和其他软件中显示」默认开启。开启时，切换应用、最小化或关闭 Codex 后仍可拖动和点击桌宠，联动保持启用时也可在其他软件上方反馈任务状态。取消后只在 Codex 主窗口位于前台时显示，切换应用、最小化、打开文件夹选择器、窗口过小或关闭 Codex 时隐藏。此显示限制在未勾选联动时同样有效。需要修改设置时，切回 Codex 主窗口后右键桌宠。
3. 「开机自启」独立于联动选项，默认开启。取消后不影响当前桌宠，手动重新打开也会记住关闭状态。
4. 桌宠不显示托盘图标。右键桌宠，在菜单底部点击「退出桌宠」即可结束当前桌宠，后台守护不会因 Codex 仍然打开而重新拉起它。退出后可双击 `outputs/closure-companion/launch.cmd` 重新启动。

三个选项会分别保存，重启后继续生效。

### 设置语音队列

1. 右键点击桌宠并展开「语音队列」。首次使用时选中「默认队列」。勾选 Codex 联动后按下表触发，未联动时左键点击会从全部 57 条语音中轮换播放。
2. 要自定义语音，切换到「个人队列」。联动时可按场景编辑，未联动时会单独保存一份左键互动队列。个人队列初始为空。
3. 在待选区按来源筛选，点击「试听」或「加入」。待选区共 57 条，包含 38 条干员语音和 19 条卫戍协议语音。同一句可加入多个场景。
4. 用「移除」删去当前队列中的台词。设置会自动保存。切回「默认队列」即可使用预设，个人队列仍会保留。

| 场景 | 触发条件 | 默认条数 |
| --- | --- | ---: |
| 任务开始 | Codex 开始处理新一轮任务时。 | 5 |
| 任务中 | 同一轮任务持续约 15 秒后自动播报一次。左键互动也会从此队列接着轮换。 | 20 |
| 任务完成 | 一轮任务成功结束时。 | 14 |
| 启动 Codex | 联动桌宠启动并显示后。 | 1 |
| 空闲五分钟 | 连续五分钟没有任务时播报一次。新任务会重置空闲计时。 | 2 |
| 工具调用错误 | 随工具失败提示播报。气泡同时显示可识别的错误原因和台词。 | 2 |
| Codex 提问 | Codex 发出带表单的结构化提问时。 | 1 |
| 用户提交回答 | 提交结构化提问的表单答案后。 | 4 |

联动与未联动时的默认队列和个人队列都采用随机轮换。每次触发播放一句，同一轮内每条播放一次，下一轮重新打乱。队列中有多条时，上一轮最后一句和下一轮第一句也会避开重复。个人队列留空即可关闭对应的台词。工具失败文字提示可在「提醒与播报」里单独开关。卫戍协议语音提供普通话和日语，选择英语或韩语时使用普通话配音。

### 活动与额度

联动桌宠读取本机 Codex 活动记录，呈现处理中、输出、完成、中断和可识别的失败。活动按本机汇总，提示可能来自后台聊天。

额度、故障和设置提示采用可露希尔口吻。报错气泡会显示可识别的原因和状态码。常见公开工具会显示工具名，自定义工具使用通用称呼。同一轮已提示的错误在任务结束时会去重。

使用官方 ChatGPT 登录时，显示各时间窗口的剩余百分比，以及接口返回的 ChatGPT 积分。已适配的第三方服务使用本机配置查询余额，气泡显示「账户余额」、金额和可识别的标准货币单位。账号数据约每分钟查询一次，有有效读数时才会显示。官方额度低于或等于 10% 时会有低额度反馈。

额度气泡同时显示最近活跃对话的本轮与累计 Token。多个对话并行时，优先显示最近上报工作事件的运行中对话。统计随本机会话记录更新，后台子任务的记录不会抢占显示。

额度、余额和 Token 用量只在自动提醒气泡中显示。在「提醒与播报」中可设为关闭、每分钟或每五分钟，默认每分钟一次。Codex 位于前台且气泡空闲时，提醒会自动弹出并收起。

### 手动启动与运行位置

- 可双击 `outputs/Start-Closure.cmd` 或 `outputs/closure-companion/launch.cmd` 手动启动桌宠，后台守护只管理桌宠，不再启动旧 CRT。桌宠会沿用上次保存的联动与自启选项，勾选联动后会自动启用活动与额度反馈，无需额外启动命令。退出入口位于桌宠右键菜单底部。
- `launch.cmd --demo` 打开测试窗口，`launch.cmd --canvas` 强制使用 Canvas 2D 渲染。手动启动时可用 `CLOSURE_ELECTRON_EXE` 指定 Electron 45 Windows x64 可执行文件，或用 `CLOSURE_STATE_DIR` 指定数据目录。默认运行数据位于 `work/companion-profile`。
- 模型、视觉和音频从本机加载，桌宠只读访问 Codex 配置与活动记录。另附原生桌宠格式和离线预览，使用前请查看随附说明。 [原生桌宠说明](outputs/closure-pet/说明.txt)
- 桌宠意外退出后会重试，主动退出后不会自动拉起。桌宠未出现时，可检查 `work/lifecycle.log`，重试耗尽后可手动重新启动。

## 目录与启动入口

| 入口或目录 | 用途 |
| --- | --- |
| `Install.cmd` / `Uninstall.cmd` | 安装或卸载桌宠登录启动项。 |
| `Enable-Codex-Theme.vbs` / `Restore-Codex-Appearance.vbs` | 隐藏终端启用主题或恢复原外观。 |
| `tools/Enable-Codex-Theme.cmd` / `tools/Restore-Codex-Appearance.cmd` | 主题排错入口，`--debug` 显示控制台输出；无参数时转交根目录 VBS。 |
| `outputs/Start-Closure.cmd` | 手动打开桌宠，沿用保存的选项。 |
| `outputs/closure-companion` / `closure-autostart` | 桌宠程序、活动与额度反馈、登录启动和守护。 |
| `outputs/closure-decoration` / `closure-theme` | 当前页面主题代码、深色配色和许可。 |
| `outputs/closure-pet` | 另附的原生宠物格式及离线预览，不是本机 Spine 桌宠的启动入口。 |
| `work/companion-profile` | 正在使用的桌宠设置；清理缓存时不要删除。 |
| `work/companion-runtime/electron` | 桌宠和隐藏主题入口共用的运行时；不要删除。 |
| `%LOCALAPPDATA%\ClosureCodexTheme` | 已识别的原 Codex 配置路径、主题状态与日志。 |
| `tools` / `tests` | 发行包的 `tools` 只附带上述两个 CMD 排错入口；其他预览、校验清单和测试仅供源码开发。 |

### 排错

- 首次启用提示先打开 Codex：先打开 Store 版，等待主界面出现后重试。多个配置实例无法确定时，关闭多余实例后重试。
- 主题没有出现：确认使用的是主题快捷方式。查看 `%LOCALAPPDATA%\ClosureCodexTheme` 中的请求结果和日志，或运行 `tools\Enable-Codex-Theme.cmd --debug`。`startup` 为 `direct` 表示直接启动，`attached` 表示直接接入，`restarted` 表示本次普通窗口发生了必要重启。
- 桌宠没有出现：检查是否关闭「在桌面和其他软件中显示」而当前未聚焦 Codex，或查看 `work/lifecycle.log`。主动退出后可双击 `outputs/Start-Closure.cmd` 重新打开。
- 设置面板显示不全：可以在右键面板内滚动。对话字太大或气泡过宽时，分别调整「对话字号」「气泡大小」；临时屏幕适配不会改变保存的数值。
- Codex 更新后若主题无法绑定页面，恢复普通启动并保留日志反馈。当前验证版本为 `26.1117.4957.0`；窗口拖动、最大化和跨屏效果仍需结合实际环境验收。

## 从源码构建

已保留并通过清单校验的 Electron 45.4.1 Windows x64 运行时位于 `work/companion-runtime/electron` 时，直接运行：

```powershell
& .\Build-Release.ps1
```

也可以下载 [官方 Electron 45.4.1 Windows x64 压缩包](https://github.com/electron/electron/releases/download/v45.4.1/electron-v45.4.1-win32-x64.zip)，显式指定：

```powershell
& .\Build-Release.ps1 -Version 0.6.0 -ElectronZip 'C:\Downloads\electron-v45.4.1-win32-x64.zip'
```

构建验证运行时 SHA-256、检查桌宠版本与发行版本一致，在 `dist` 生成 `Closure-Codex-v0.6.0-win-x64.zip` 与 `SHA256SUMS.txt`。包内不含旧 CRT、早期独立实例启动器、开发预览、个人配置或测试缓存。构建清单在 `tools/electron-v45.4.1-win32-x64.json`。

开发预览位于 `tools/decoration-preview/Preview.cmd`。Node 回归测试可运行 `node --test tests/*.test.cjs`；其他后台验证说明见 `outputs/closure-decoration/README.md`。

### 0.6.0 发行包验证

已在 Windows 11 x64 上，从实际 ZIP 解压到包含中文、空格及 `&` 的新目录，使用空配置并从 PATH 中移除外部 Node.js，完成以下验证：

- 安装脚本创建正确的登录启动快捷方式，升级保留已关闭的自启选择，卸载移除启动项并保留个人设置。
- 使用包内 Electron 验证 WebGL 与 Canvas 两种渲染、互动、语音队列、字号和气泡大小、设置重载、拖动跟随及右键退出。
- 使用 Windows PowerShell 5.1 和包内运行时验证主题入口；在官方 Codex `26.1117.4957.0` 的全新后台配置中验证首次接入、重复启用、完全退出后的直接冷启动、恢复普通外观及调试端口清理。

安装与卸载注册在独立的启动目录中执行，桌宠功能在隐藏窗口中验证，以避免替换当前用户的启动项或接管桌面。本轮为同一台电脑上的隔离验证，尚未覆盖全新 Windows 系统、实际注销后的登录自启，以及其他电脑的显卡和安全软件环境。

源码维护者可运行 `tests/release.ps1` 检查发行包完整性，再运行 `tests/release-clean-install.ps1` 复现隔离验收。后者需要已安装 Store 版 Codex，报告、独立配置和截图保存在 `work/release-clean-install`；测试文件不随发行包分发。

## 来源与许可

这是一项非官方移植，基于以下两个 DSH 项目。

- 主题沿用原版皮肤的色值和字体方案。 [dsh-closure-skin](https://github.com/fengshiyangrouguan/dsh-closure-skin)
- 桌宠复用原插件的 Spine 3.8 模型、动作、UI 音效和 Ark Pixel 气泡。 [dsh-closure-pet](https://github.com/fengshiyangrouguan/dsh-closure-pet) · [移植所用的上游版本](https://github.com/fengshiyangrouguan/dsh-closure-pet/tree/5b5aa6a2bcb5da68e9b1cab3e6a9948f0ff2266f)

游戏模型、贴图、音效和配音的权利归各自权利人。上游对随附游戏素材另有个人本机自用和二次分发声明。 [主题 MIT 许可](outputs/closure-theme/LICENSE) · [桌宠代码许可](outputs/closure-companion/upstream/LICENSE) · [素材与第三方许可](outputs/closure-companion/upstream/NOTICE.md) · [字体 OFL 许可](outputs/closure-companion/upstream/assets/fonts/OFL.txt)
