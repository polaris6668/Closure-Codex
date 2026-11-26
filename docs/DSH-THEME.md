# 在 DSH 使用可露希尔主题

适配 Windows 64 位的 DSH `0.2.2-rc.5`。主题插件版本为 `0.1.2`，可以单独使用。如果想让桌宠在任务完成时播报，还可安装另一个联动插件。[桌宠联动步骤](COMPANION-INTEGRATIONS.md#dsh)

## 安装主题

1. 在完整包的 `plugins/dsh-theme` 文件夹找到 `dsh-closure-codex-theme-0.1.2.tgz`。独立主题包解压后也有这个文件。
2. 在 DSH 插件管理中停用正在使用的其他全局主题。打开 DSH 自带的终端，保存工作，然后从任务栏右下角的托盘退出 DSH。
3. 在刚才的终端运行下面的命令。把引号里的示例路径换成你找到的 `.tgz` 文件的完整路径。

```powershell
dsh plugin --profile desktop add "C:\Downloads\dsh-closure-codex-theme-0.1.2.tgz"
```

重新打开 DSH。顶栏应出现紫蓝网格，左侧会话列表呈深蓝黑色。项目文件夹展开时，灰紫色图标里会露出一角浅色纸张。

## 恢复或更换版本

在 DSH 的插件管理中停用 `dsh-closure-codex-theme`，就会恢复之前选择的外观。要用新版安装包替换已安装的同名插件，可以先移除旧插件，再按上面的步骤安装新版文件。

```powershell
dsh plugin --profile desktop remove dsh-closure-codex-theme
```

## 开发与检查

在项目根目录运行以下命令。第一条重新生成 DSH 加载的主题文件，最后一条打包出可安装的 `.tgz`。[插件源码](https://github.com/OndoP3901/Closure-Codex/tree/main/plugins/dsh-closure-codex-theme)

```powershell
node plugins/dsh-closure-codex-theme/tools/build.mjs
node --test tests/dsh-theme.test.cjs
node tools/test-dsh-theme.cjs
.\tools\Build-Dsh-Theme.ps1
```

界面测试使用独立的 DSH 和 Electron 运行文件，可分别用 `CLOSURE_DSH_RUNTIME` 和 `CLOSURE_ELECTRON_EXE` 指定。它在临时配置里检查顶栏和侧栏、折叠、设置页、刷新以及恢复原外观。截图和报告保存在 `work/dsh-theme/verification`。
