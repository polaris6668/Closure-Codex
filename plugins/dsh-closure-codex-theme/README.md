# DSH 可露希尔深色主题

给 DSH 加上紫蓝网格顶栏、深蓝黑会话列表和洋红色选中标记。适配 Windows 64 位的 DSH `0.2.2-rc.5`，插件版本 `0.1.2`。只用 DSH 也可以安装。

## 安装

1. 解压下载的文件，找到 `dsh-closure-codex-theme-0.1.2.tgz`。如果下载的是可露希尔完整包，它在 `plugins/dsh-theme` 里。
2. 在 DSH 插件管理中停用其他全局主题。打开 DSH 自带的终端，保存工作，然后从任务栏托盘退出 DSH。
3. 在刚才的终端执行下面的命令，把引号内的示例路径换成自己找到的文件。

```powershell
dsh plugin --profile desktop add "C:\Downloads\dsh-closure-codex-theme-0.1.2.tgz"
```

重新打开 DSH 即可看到主题。左侧当前会话旁有一小段洋红竖线，展开项目时，像素文件夹会露出一角浅色纸张。使用 DSH 网页版的用户可将命令里的 `--profile desktop` 换成 `--profile web`。

## 恢复与卸载

在插件管理中停用 `dsh-closure-codex-theme` 即可恢复原来的外观，包括浅色或跟随系统的选择。要彻底移除桌面版插件，可在 DSH 终端运行下面的命令。更换同名主题包时，也可以先移除旧包，再安装新文件。

```powershell
dsh plugin --profile desktop remove dsh-closure-codex-theme
```

## 从源码构建

在本插件目录运行以下命令。源码在 `src`，打包后得到可安装的 `.tgz`。

```powershell
node tools/build.mjs
npm pack
```

代码与样式使用 MIT 许可，原始配色的署名保存在包内 `LICENSE`。主题使用系统已安装的字体。
