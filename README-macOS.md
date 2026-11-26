# 可露希尔桌宠 · macOS

这是基于 [OndoP3901/Closure-Codex v0.8.0](https://github.com/OndoP3901/Closure-Codex/tree/v0.8.0) 的非官方移植，适用于 Apple Silicon Mac。桌宠可独立使用，也可跟随 Codex 和 DSH。WorkBuddy 的联动与主题入口目前用于 Windows。

[macOS 更新日志](CHANGELOG-macOS.md) · [上游 Windows 版说明](README.md#上游-windows-版说明)

## 安装与启动

准备 Node.js 和 Xcode 命令行工具，然后在终端执行以下命令。首次构建会下载并校验官方 Electron ARM64 运行时。

```sh
git clone --branch codex/macos-port --single-branch https://github.com/polaris6668/Closure-Codex.git
cd Closure-Codex
bash Build-macOS.sh
open 'dist/Closure Companion.app'
```

如果已有源码，在仓库目录运行 `bash Build-macOS.sh` 即可。也可以把生成的 `.app` 拖到 Finder 的「应用程序」里。设置和角色位置保存在 `~/Library/Application Support/Closure Companion`。

## 右键设置

- 桌宠可点击互动、拖动及贴边吸附。可调大小、透明度、镜像、帧率、气泡字号和大小，也可预览动作或退出。
- 「Codex 联动」和「DSH 联动」可分别开启。桌宠按最近活动在两款应用间切换。Codex 的多条完成语音依次播报，仍有主聊天运行时会继续显示工作动作。
- 「语音队列」支持按场景编辑个人队列和试听。配音与音效可独立开关和调音量，默认日语原声，字幕保持简体中文。
- 播放语音时右键桌宠可停掉当前这一句。平时右键打开设置菜单。
- 在浏览器等其他应用中，鼠标靠近角色或气泡时会临时隐藏，可直接点击下面的内容。移开鼠标就会恢复。按住 `⌥ Option` 可点击、右键或拖动桌宠。在 Codex、DSH 和 Finder 中可直接操作桌宠。
- 「在桌面和其他软件中显示」关闭后，桌宠只在所选联动应用的主窗口处于前台时显示。两项联动均未开启时默认跟随 Codex 窗口。
- 按下鼠标滚轮或在菜单中点「查看用量」，可查看已连接应用的额度、积分或余额，以及最近活跃会话的本轮和累计 Token。
- 「开机自启」通过当前用户的 macOS LaunchAgent 注册。首次升级默认关闭，可在桌宠内开启或移除。

桌宠在本机读取 `$CODEX_HOME/sessions`，未设置时读取 `~/.codex/sessions`。它通过会话日志标记识别 Codex 桌面端，子代理的回合由主聊天汇总。桌宠启动前已结束的任务不会补播。

## DSH 插件

在仓库目录执行以下命令，为 DSH 分别打包联动和主题插件。

```sh
mkdir -p dist
npm pack ./plugins/dsh-closure-companion-bridge --pack-destination "$PWD/dist"
npm pack ./plugins/dsh-closure-codex-theme --pack-destination "$PWD/dist"
```

退出 DSH 后，在同一个目录按需执行下面的安装命令。路径按「应用程序」中的默认安装位置填写。

```sh
dsh_cli='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
"$dsh_cli" plugin --profile desktop add "$PWD/dist/dsh-closure-companion-bridge-0.1.2.tgz"
"$dsh_cli" plugin --profile desktop add "$PWD/dist/dsh-closure-codex-theme-0.1.2.tgz"
```

重新打开 DSH。安装联动插件后，可在桌宠菜单勾选「DSH 联动」。主题可在 DSH 的插件管理中开关。

## 配色和 CRT

- **配色** ｜ 点「Codex 配色与 CRT → 复制深色配色」，再进入 Codex 的「设置 → 外观 → 深色主题」，点击「导入」。
- **页面内 CRT** ｜ 保存手上的工作，按 `⌘Q` 退出 Codex，然后在桌宠设置选择「启动 CRT 版 Codex」。新版主题在顶栏显示网格，加入会话选中标记、输入框圆角提示、像素文件夹和代码块分隔线。「关闭 CRT」恢复页面样式。本机调试端口仅在这次 Codex 运行期间监听回环地址，退出 Codex 时关闭。

## 来源与许可

随附游戏模型、贴图和声音仅限个人本机使用。请将含有这些素材的 `.app` 留在本机。各部分代码和第三方资源的许可见上游说明。

[上游来源与许可说明](README.md#来源与许可) · [素材与第三方许可](outputs/closure-companion/upstream/NOTICE.md)
