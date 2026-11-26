# Codex 可露希尔深色主题

适用于 Windows 上的微软商店版 Codex。主题包含紫蓝网格顶栏、深蓝黑侧栏和屏幕扫描线。当前对话旁有一段洋红短线，点击输入框时会沿圆角显示淡紫细线。

## 开启与恢复

1. 首次打开 Codex，等到主界面出现，保存手头的工作。
2. 在完整包的最外层双击 `Enable-Codex-Theme.vbs`。普通 Codex 窗口可能重启一次，原账号和聊天记录会保留。
3. 以后用桌面或开始菜单中的「Codex - 可露希尔深色主题」快捷方式启动。软件完全关闭后也可以直接用它打开。

要恢复原外观，保存工作后双击 `Restore-Codex-Appearance.vbs`，主题快捷方式会一并移除。若之前在 Codex 里手动导入过配色，恢复后会回到那套配色。再次开启时，直接双击启用文件即可。

## 启动遇到问题

- 提示找不到 Codex 配置时，先用原来的图标打开 Codex，再次运行启用文件。同时使用多个配置时，请先关掉其他配置的窗口。
- 启用或恢复失败时，弹窗会给出日志位置。日志保存在 `%LOCALAPPDATA%\ClosureCodexTheme`。需要查看详细过程时，在完整包最外层运行以下命令之一。

```powershell
.\tools\Enable-Codex-Theme.cmd --debug
.\tools\Restore-Codex-Appearance.cmd --debug
```

## 开发与预览

`palette.cjs` 读取深色配色，`decoration.css` 绘制顶栏网格、侧栏、项目文件夹、代码块和输入框装饰。主题通过 Codex 的本机调试连接加载，刷新或新开窗口后会重新应用。[接入方式参考 Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin/tree/6fc42df48a6a5365011f55cc349e20c038e56d1d)

在源码中双击 `tools/decoration-preview/Preview.cmd` 可打开独立样例。需要在自己的页面中使用装饰时，将实际的顶栏、工作区和侧栏元素传给 `mountDecoration`。

```js
import { mountDecoration } from './decoration.mjs'
const decoration = mountDecoration({ document, titlebar, workspace, sidebar })
decoration.setEnabled(false)
decoration.dispose()
```

`tests/decoration-preview.cjs` 检查样例的开关和恢复，`tests/decoration-cdp.cjs` 检查主题在页面刷新、切换和关闭后的表现。启动流程由 `tests/theme-entry.test.cjs` 和 `tests/theme-entry-official.cjs` 检查。[源码构建与测试](../../docs/USAGE.md#从源码构建与验证)
