# 使用指南

首次安装、开启主题和卸载的步骤都在首页。[安装与主题开关](../README.md#下载后怎么用) · [旧版怎么用](#旧版怎么用) · [常见问题](#常见问题)

## 桌宠设置

右键点击可露希尔即可打开设置。修改会自动保存，面板可以向下滚动。

| 想做什么 | 在设置里怎么选 |
| --- | --- |
| 切到其他软件时也能看到桌宠 | 勾选「在桌面和其他软件中显示」。取消后，切到已勾选联动的软件主窗口时才会看到桌宠。如果三项联动都关闭，这时只跟随 Codex 窗口。 |
| 打开电脑后手动启动桌宠 | 取消「开机自启」。下次需要时双击 `outputs/Start-Closure.cmd`。 |
| 调整角色外观 | 拖动角色可移动位置。右键可调大小、透明度、镜像和帧率，每秒可选 30–60 帧。 |
| 让气泡更好读 | 「对话字号」调文字大小（12–36 像素），「气泡大小」调外框和换行宽度（60%–160%）。拖动角色时气泡会跟随。 |
| 换配音或调音量 | 可选普通话、日语、英语或韩语。配音和界面音效分别调音量。卫戍协议台词只有普通话与日语，选择英语或韩语时会播放普通话。 |
| 查看任务状态和余额 | 勾选对应软件的「联动」。任务会触发动作和台词，按一下鼠标滚轮可以查看已连接账号的余额、额度或积分。[各软件的联动步骤](COMPANION-INTEGRATIONS.md) |

### 自定义台词

1. 右键展开「语音队列」，选「个人队列」。
2. 选择要配音的场景，在台词旁点「试听」，喜欢就点「加入」。某个场景留空，就会跳过该场景的语音。
3. 想恢复预设时切回「默认队列」。下次选「个人队列」时，还能找到自己挑好的台词。

联动时，三款软件共用八种场景的台词，分别用于启动联动、任务开始、工作中、完成、空闲五分钟、工具报错、软件提问和提交回答。独立使用桌宠时，可以单独挑选左键互动的台词，默认从全部 57 条中随机轮换。

## 旧版怎么用

先看压缩包文件名里的版本号。以下八个旧版本都从 `Install.cmd` 安装桌宠，从 `Uninstall.cmd` 卸载。[历版下载](https://github.com/OndoP3901/Closure-Codex/releases) · [各版更新日志](../CHANGELOG.md)

### v0.1.0 至 v0.5.0

1. 完整解压，双击 `Install.cmd`，然后用原来的图标打开微软商店版 Codex。桌宠和扫描线会随 Codex 主窗口出现。
2. 要换配色，双击 `Copy-Dark-Theme.cmd`（深色）或 `Copy-Light-Theme.cmd`（浅色）。打开 Codex 的「设置 → 外观 → 高级」，把复制的内容粘贴到对应的主题导入框。
3. 想换回原来的配色，到 Codex 的外观设置里切换。想同时使用深浅两套，可勾选「分别设置浅色和深色模式」。

| 你的版本 | 这版的常用操作 |
| --- | --- |
| v0.1.0 | 左键点桌宠听台词。右键可以换四种配音、调音量，或开关扫描线与暗角。 |
| v0.2.0 | 右键打开「提醒与播报」，调整额度提醒频率，或关闭开场、完成和工具出错时的提示。 |
| v0.3.0 | 在「语音队列」里选「个人队列」，按场景试听和加入台词。余额和用量会在定时气泡里显示。 |
| v0.4.0 | 想关掉 Codex 后继续看桌宠，右键把「运行模式」切到「独立桌面」。此模式可从任务栏托盘隐藏或退出桌宠。 |
| v0.5.0 | 沿用独立桌面模式。右键拖动「帧率」滑条，可以在每秒 30 到 60 帧之间选择。 |

在这五个旧版之间升级时，可把 `work/companion-profile` 和已有的 `work/crt-settings.ini` 从旧目录复制到新目录，分别保留桌宠设置和扫描线设置。

### v0.6.0 至 v0.7.0

从 v0.6.0 起，桌宠和深色主题分开开启。要换 Codex 主题，首次打开 Codex，保存工作后双击 `Enable-Codex-Theme.vbs`。要恢复原外观，保存工作后双击 `Restore-Codex-Appearance.vbs`。

| 你的版本 | 这版的常用操作 |
| --- | --- |
| v0.6.0 | 右键分别勾选「Codex 联动」「在桌面和其他软件中显示」和「开机自启」。要退出桌宠，在右键菜单底部点「退出桌宠」。 |
| v0.6.1 | Codex 完全关闭时，也可双击「Codex - 可露希尔深色主题」快捷方式启动。恢复原外观后，想再次启用就双击 `Enable-Codex-Theme.vbs`。 |
| v0.7.0 | DSH 主题和桌宠插件分别在 `plugins/dsh-theme`、`plugins/dsh-companion`。WorkBuddy 用 `Enable-WorkBuddy-Theme.vbs` 启用主题、`Restore-WorkBuddy-Appearance.vbs` 恢复，或用 `Start-WorkBuddy-Companion.vbs` 只开联动。按鼠标滚轮查看余额。 |

升级到 v0.8.0 时，退出旧桌宠，把 `work/companion-profile` 复制到新版相同位置，再运行新版 `Install.cmd`。从旧版带过来的定时余额提醒会改为手动查看。

## 常见问题

| 遇到的情况 | 可以这样做 |
| --- | --- |
| Codex 提示先打开软件 | 正常打开微软商店版 Codex，等主界面出现，再运行主题启用文件。若同时开着使用不同配置的 Codex，先关掉其他实例。 |
| 恢复 Codex 后仍是以前导入的配色 | 恢复操作会回到你自己的外观设置。想用 Codex 默认配色，可在软件的外观设置里选择。 |
| WorkBuddy 主题没有出现 | 保存工作，从任务栏右下角的托盘完全退出，再双击解压目录里的 `Enable-WorkBuddy-Theme.vbs`。 |
| 桌宠不见了 | 先切回勾选联动的软件，或切回 Codex。若之前点过「退出桌宠」，可双击 `outputs/Start-Closure.cmd`。角色位置异常时，在右键设置里选「重置位置」。 |
| 点桌宠看不到余额 | 用鼠标中键（按下滚轮）。确认相应软件已连接并已勾选联动。[联动步骤](COMPANION-INTEGRATIONS.md) |
| 移动了解压文件夹 | 在新位置再次运行 `Install.cmd`，再从新目录启用用过的主题。个人桌宠设置在 `work/companion-profile`，请随文件夹一起移动。 |

Codex 主题出错时，弹窗会给出日志位置，也可以检查 `%LOCALAPPDATA%\ClosureCodexTheme`。桌宠启动记录在解压目录的 `work/lifecycle.log`。另附的 `outputs/closure-pet` 包含原生桌宠格式和离线预览。[原生桌宠说明](../outputs/closure-pet/说明.txt)

## 从源码构建与验证

面向开发者。请在仓库根目录运行下面的命令，需要 Node.js 22 或更新版本。供用户下载的完整包已经带有所需组件。

将 Electron 45.4.1 的 Windows x64 运行文件放在 `work/companion-runtime/electron`，或用 `-ElectronZip` 指定官方压缩包。构建脚本会校验运行文件，并生成 ZIP 和对应的 `SHA256SUMS.txt`。[官方 Electron 压缩包](https://github.com/electron/electron/releases/download/v45.4.1/electron-v45.4.1-win32-x64.zip)

```powershell
.\Build-Release.ps1 -Destination .\dist\v0.8.0
```

有官方压缩包时也可以直接运行以下命令。

```powershell
.\Build-Release.ps1 -Version 0.8.0 -ElectronZip 'C:\Downloads\electron-v45.4.1-win32-x64.zip' -Destination .\dist\v0.8.0
```

总包使用主版本 v0.8.0，DSH 和 WorkBuddy 插件按各自的版本号命名。构建完成后可以运行测试。

```powershell
node --test tests/*.test.cjs
.\tests\release.ps1
.\tests\release-clean-install.ps1
```

`release.ps1` 检查包内文件与校验和。`release-clean-install.ps1` 使用独立目录测试解压、安装、桌宠互动以及主题启用和恢复，需要已安装的微软商店版 Codex。报告在 `work/release-clean-install`。仅预览主题时，可以从源码运行 `tools/decoration-preview/Preview.cmd`。
