# WorkBuddy 可露希尔深色主题

适配 Windows 64 位的 WorkBuddy `5.11.3`，主题包版本为 `0.1.1`。主窗口有紫蓝网格顶栏、洋红细线和深蓝黑侧栏，独立设置窗口的顶部为纯深色。

## 开启主题

1. 把下载的压缩包完整解压到准备长期保留的文件夹。
2. 首次使用前，保存工作，从任务栏右下角的托盘退出 WorkBuddy。
3. 在解压目录中双击下表对应的启用文件。以后也用这个文件启动，账号和会话会保留。

| 你下载的包 | 启用主题 | 恢复原外观 |
| --- | --- | --- |
| WorkBuddy 独立主题包 | `Enable-Theme.vbs` | `Restore-Theme.vbs` |
| 可露希尔完整包 | `Enable-WorkBuddy-Theme.vbs` | `Restore-WorkBuddy-Appearance.vbs` |

双击恢复文件后，当前窗口会恢复原外观，未发送的草稿也会保留。下次从原来的 WorkBuddy 图标启动，即可继续使用普通外观。

如果双击后提示 WorkBuddy 仍在运行，请从托盘退出再试。错误记录在 `%LOCALAPPDATA%\ClosureWorkBuddyTheme\launcher.log`。

## 从源码构建

在本插件目录运行以下命令。样式源文件位于 `src`，生成的文件位于 `lib`。

```powershell
node tools/build.mjs
```

直接使用源码需要 Node.js 22 或更新版本，或完整包随附的 Electron。独立主题包已经带有运行所需组件。代码及配色按 MIT 许可提供，见包内 `LICENSE`。[桌面适配与测试说明](https://github.com/OndoP3901/Closure-Codex/blob/main/docs/WORKBUDDY-THEME.md)
