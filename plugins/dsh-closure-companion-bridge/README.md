# DSH 桌宠联动插件

让桌面上的可露希尔跟随 DSH 的任务播放动作和台词，并在你按下鼠标滚轮时显示 DSH 官方钱包余额。可以和任意 DSH 主题搭配。适配 DSH `0.2.2-rc.5`，插件版本 `0.1.2`。

## 安装并连接桌宠

1. 若还没有桌宠，解压可露希尔完整包，双击 `Install.cmd`。联动插件在 `plugins/dsh-companion` 文件夹，文件名是 `dsh-closure-companion-bridge-0.1.2.tgz`。
2. 打开 DSH 自带的终端，保存工作并从托盘退出 DSH。在终端执行下面的命令，把引号内的示例路径换成实际文件路径。

```powershell
dsh plugin --profile desktop add "C:\Downloads\dsh-closure-companion-bridge-0.1.2.tgz"
```

3. 重新打开 DSH，右键点击桌宠，勾选「DSH 联动」。在 DSH 开始一段对话后，桌宠就会跟随任务。把鼠标移到桌宠上，按一下滚轮即可分别查看充值余额和赠送余额。

## 关闭联动

在桌宠菜单中取消「DSH 联动」即可停止查询。想彻底移除插件，可在 DSH 的插件管理中卸载 `dsh-closure-companion-bridge`。

## 开发说明

桌宠通过 `%LOCALAPPDATA%\ClosureCompanion\bridges` 接收任务状态、用量和余额。这些文件不保存聊天正文或登录凭据。在本插件目录运行以下命令可重新打包。

```powershell
node tools/build.mjs
npm pack
```
