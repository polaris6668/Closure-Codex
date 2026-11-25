# 可露希尔桌宠 · macOS

这是基于 [OndoP3901/Closure-Codex v0.6.0](https://github.com/OndoP3901/Closure-Codex/tree/v0.6.0) 的非官方移植，适用于 Apple Silicon Mac。桌宠可独立使用，任务语音、窗口跟随与 CRT 等功能需要安装 Codex 桌面客户端。

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
- 「Codex 联动」控制主聊天跟随。任务开始、持续工作、完成、提问、作答、工具失败和空闲都有对应反馈。整轮失败或中断显示简短气泡。多条任务语音依次播报，仍有主聊天运行时会继续显示工作动作。
- 「语音队列」支持按场景编辑个人队列和试听。配音与音效可独立开关和调音量，默认日语原声，字幕保持简体中文。
- 播放语音时右键桌宠可停掉当前这一句。平时右键打开设置菜单。
- 在浏览器等其他应用中，鼠标靠近角色或气泡时会临时隐藏，可直接点击下面的内容。移开鼠标就会恢复。按住 `⌥ Option` 可点击、右键或拖动桌宠。在 Codex 和 Finder 中可直接操作桌宠。
- 「在桌面和其他软件中显示」关闭后，桌宠只在 Codex 主窗口处于前台时显示。显示范围和任务联动可分别选择。
- 「查看用量」显示最近活跃会话的本轮及累计 Token，以及当前可读的额度、积分或余额。「提醒与播报」可以关闭定时提醒，或设为每分钟、每五分钟一次。第三方余额沿用上游适配的 Heju API。
- 「开机自启」通过当前用户的 macOS LaunchAgent 注册。首次升级默认关闭，可在桌宠内开启或移除。

桌宠在本机读取 `$CODEX_HOME/sessions`，未设置时读取 `~/.codex/sessions`。它通过会话日志标记识别 Codex 桌面端，子代理的回合由主聊天汇总。桌宠启动前已结束的任务不会补播。

## 配色和 CRT

- **配色** ｜ 点「Codex 配色与 CRT → 复制深色配色」，再进入 Codex 的「设置 → 外观 → 深色主题」，点击「导入」。
- **页面内 CRT** ｜ 保存手上的工作，按 `⌘Q` 退出 Codex，然后在桌宠设置选择「启动 CRT 版 Codex」。进入 Codex 主界面后会加载顶栏网格、侧栏装饰、扫描线和暗角。「关闭 CRT」恢复页面样式。本机调试端口仅在这次 Codex 运行期间监听回环地址，退出 Codex 时关闭。

## 来源与许可

随附游戏模型、贴图和声音仅限个人本机使用。请将含有这些素材的 `.app` 留在本机。各部分代码和第三方资源的许可见上游说明。

[上游来源与许可说明](README.md#来源与许可) · [素材与第三方许可](outputs/closure-companion/upstream/NOTICE.md)
