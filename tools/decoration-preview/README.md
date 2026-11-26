# 预览 Codex 主题

在源码目录双击 `Preview.cmd`，可在独立样例窗口里切换装饰、对照效果。预览使用 `outputs/closure-decoration` 的当前样式，不需要登录 Codex。此工具供源码开发使用。

如果提示缺少 Electron，可把运行文件放在 `work/companion-runtime/electron`，或将 `CLOSURE_ELECTRON_EXE` 设为 `electron.exe` 的完整路径。

需要自动检查时，在项目根目录用 Electron 运行 `tests/decoration-preview.cjs`。它会在隐藏窗口里检查页面尺寸、输入和装饰开关，报告保存在 `work/decoration-preview`。
