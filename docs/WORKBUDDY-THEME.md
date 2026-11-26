# 在 WorkBuddy 使用可露希尔主题

此主题适配 Windows 64 位的 WorkBuddy `5.11.3`，主题包版本为 `0.1.1`。聊天窗口使用紫蓝网格顶栏和深蓝黑侧栏，独立的设置窗口保留纯深色顶部。

## 开启与恢复

首次使用前，保存工作，在任务栏右下角的托盘中退出 WorkBuddy。根据下载的包选择对应文件，以后也用同一个启用文件启动。

| 你下载的文件 | 启用主题 | 恢复原外观 |
| --- | --- | --- |
| 可露希尔完整包 | `Enable-WorkBuddy-Theme.vbs` | `Restore-WorkBuddy-Appearance.vbs` |
| WorkBuddy 独立主题包 | `Enable-Theme.vbs` | `Restore-Theme.vbs` |

双击恢复文件后，当前窗口会换回原外观，未发送的草稿会保留。下次想用普通外观，从原来的 WorkBuddy 图标启动即可。只想让桌宠跟随任务时，可用完整包里的 `Start-WorkBuddy-Companion.vbs`。[桌宠联动步骤](https://github.com/OndoP3901/Closure-Codex/blob/main/docs/COMPANION-INTEGRATIONS.md#workbuddy)

## 启用后外观没变

先确认打开的是 WorkBuddy 桌面版。若之前仅关闭了窗口，软件可能还在托盘里。保存任务并从托盘退出，再运行上表的启用文件。主题的启动日志位于 `%LOCALAPPDATA%\ClosureWorkBuddyTheme\launcher.log`。

## 开发与检查

主题使用 WorkBuddy 自带的本机连接加载样式，保留原有账号、会话和外观设置。源码在 `plugins/workbuddy-closure-codex-theme/src`。在仓库根目录运行以下命令。

```powershell
node plugins/workbuddy-closure-codex-theme/tools/build.mjs
node --test tests/workbuddy-theme.test.cjs
node tools/test-workbuddy-theme.cjs
.\tools\Build-WorkBuddy-Theme.ps1
```

界面测试需要本机已安装的 WorkBuddy 和项目的 Electron 运行文件。它在隐藏窗口中用测试数据检查三种窗口尺寸、折叠后的列表、设置页、草稿和恢复外观。截图与报告保存在 `work/workbuddy-theme/verification`。

独立主题包附带启动所需的 Node.js 和许可证。打包脚本默认从本机 WorkBuddy 的 `resources/vendor/node.zip` 取文件，也可用 `-NodeArchive` 指定压缩包。构建时会核对当前主题与测试报告是否一致。
