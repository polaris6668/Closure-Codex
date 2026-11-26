# 可露希尔的 Codex

## macOS 移植版

`codex/macos-port` 分支是基于 [OndoP3901/Closure-Codex v0.8.0](https://github.com/OndoP3901/Closure-Codex/tree/v0.8.0) 的非官方移植，适用于 Apple Silicon Mac。可以从源码在本机打包成 `Closure Companion.app`。

- 桌宠支持独立运行、跟随 Codex 或 DSH 窗口和登录自启。
- Codex 任务开始和完成时，桌宠可以切换动作、弹出气泡并播放语音。默认使用日语原声，播报时右键可跳过当前一句。
- 支持查看 Token 用量与已连接应用的额度和余额。可启用新版 Codex 深色主题和 DSH 主题插件。

[macOS 安装和使用说明](README-macOS.md) · [macOS 更新日志](CHANGELOG-macOS.md) · [素材与第三方许可](outputs/closure-companion/upstream/NOTICE.md)

## 上游 Windows 版说明

《明日方舟》可露希尔桌宠会说游戏里的台词，也能在任务完成时提醒你。Codex、DSH 和 WorkBuddy 还可以换上「卫戍协议」风格的深色主题。桌宠和主题可分开使用。

**v0.8.0 · Windows 64 位（x64）**　[下载发行包](https://github.com/OndoP3901/Closure-Codex/releases) · [更新日志](CHANGELOG.md) · [旧版使用方法](docs/USAGE.md#旧版怎么用)

## 下载后怎么用

在发布页选择版本，下载名称形如 `Closure-Codex-v0.8.0-win-x64.zip` 的完整包。把整个压缩包解压到准备长期保留的文件夹。

- **想用桌宠**，双击解压目录里的 `Install.cmd`。可露希尔会出现在桌面上，默认随 Windows 登录启动。
- **想用主题**，在下表找到你使用的软件。

| 软件 | 怎么开启 | 怎么恢复原外观 |
| --- | --- | --- |
| Codex（微软商店版） | 首次打开 Codex 并保存工作，再双击 `Enable-Codex-Theme.vbs`。窗口可能重启一次。以后用桌面或开始菜单里的「Codex - 可露希尔深色主题」启动。 | 保存工作，双击 `Restore-Codex-Appearance.vbs`。 |
| DSH | 安装 `plugins/dsh-theme` 文件夹里的 `.tgz` 主题插件，再打开 DSH。[安装步骤](docs/DSH-THEME.md#安装主题) | 在 DSH 的插件管理中停用 `dsh-closure-codex-theme`。 |
| WorkBuddy | 首次保存工作，从任务栏右下角的托盘退出 WorkBuddy，再双击 `Enable-WorkBuddy-Theme.vbs`。以后也用这个文件启动。 | 双击 `Restore-WorkBuddy-Appearance.vbs`，窗口和草稿会保留。 |

## 桌宠怎么操作

| 鼠标操作 | 效果 |
| --- | --- |
| 左键点一下 | 听一句可露希尔的游戏台词。 |
| 按住左键拖动 | 移动桌宠，拖到屏幕边缘附近会自动贴边。 |
| 按一下鼠标滚轮 | 查看已连接软件的余额、额度或积分。 |
| 右键点一下 | 换配音、调大小、关闭开机自启，或在菜单底部选择「退出桌宠」。 |

**想让桌宠跟随任务**，右键勾选对应软件的「联动」，首次安装时三项都关闭。Codex 可以直接勾选。DSH 还要安装 `plugins/dsh-companion` 里的插件。WorkBuddy 用主题入口启动即可，也可以用 `Start-WorkBuddy-Companion.vbs` 只开联动。多个对话同时工作时，桌宠跟随最近有活动的那一段。[联动步骤与余额说明](docs/COMPANION-INTEGRATIONS.md)

桌宠有 57 条游戏原声，可以为任务开始、完成等场景挑选不同台词。[自定义台词与气泡](docs/USAGE.md#桌宠设置)

## 升级与卸载

- **升级**时先退出旧桌宠，将新版解压到新文件夹。把旧目录的 `work/companion-profile` 复制到新版相同位置，再双击新版 `Install.cmd`。位置、个人台词和开机自启选择都会保留。使用主题时，从新版目录启用对应主题。
- **卸载**时先按上表恢复用过的主题，在 DSH 中移除装过的主题或桌宠联动插件，再双击 `Uninstall.cmd`。
- **重新打开桌宠**时，双击 `outputs/Start-Closure.cmd`。[常见问题](docs/USAGE.md#常见问题)

## 来源与许可

本项目是非官方移植。主题灵感来自 DSH 的可露希尔皮肤，桌宠沿用上游的角色模型、动作和音效。[上游主题](https://github.com/fengshiyangrouguan/dsh-closure-skin) · [上游桌宠](https://github.com/fengshiyangrouguan/dsh-closure-pet)

《明日方舟》游戏素材归各自权利人，上游限定为个人本机使用。代码、素材和字体的授权说明分别随包提供。[主题许可](outputs/closure-theme/LICENSE) · [桌宠代码许可](outputs/closure-companion/upstream/LICENSE) · [素材声明](outputs/closure-companion/upstream/NOTICE.md) · [字体许可](outputs/closure-companion/upstream/assets/fonts/OFL.txt)
