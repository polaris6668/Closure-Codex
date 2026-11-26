#!/bin/bash
set -euo pipefail

if [[ $(uname -s) != Darwin || $(uname -m) != arm64 ]]; then
  echo '请在 Apple Silicon Mac 上构建。' >&2
  exit 1
fi

root=$(cd "$(dirname "$0")" && pwd)
version=45.4.1
runtime_sha256=d080c3b05a01bd16137f2c12ab9ebf083c577757fe846844ba325bafa8e8bdf4
runtime_dir="$root/work/macos-runtime"
archive="electron-v$version-darwin-arm64.zip"
bundle_name='Closure Companion.app'
bundle_id='local.closure-codex.companion'
mkdir -p "$runtime_dir" "$root/dist"

stage=$(mktemp -d "$runtime_dir/build.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
verify_archive() {
  printf '%s  %s\n' "$runtime_sha256" "$1" | shasum -a 256 -c
}
if [[ ! -f "$runtime_dir/$archive" ]]; then
  curl -fsSL --retry 2 "https://github.com/electron/electron/releases/download/v$version/$archive" -o "$stage/$archive"
  verify_archive "$stage/$archive"
  mv "$stage/$archive" "$runtime_dir/$archive"
else
  verify_archive "$runtime_dir/$archive"
fi

ditto -x -k "$runtime_dir/$archive" "$stage"
bundle="$stage/$bundle_name"
mv "$stage/Electron.app" "$bundle"
resources="$bundle/Contents/Resources"
mkdir "$resources/app"
for file in activity.cjs bridge.js dsh.cjs error-summary.cjs index.html integrations.cjs main.cjs mac-runtime.cjs mac-theme.cjs package.json preload.cjs quota.cjs runtime-settings.cjs; do
  cp "$root/outputs/closure-companion/$file" "$resources/app/"
done
ditto "$root/outputs/closure-companion/upstream" "$resources/app/upstream"
xcrun swiftc -O "$root/outputs/closure-companion/mac-window-tracker.swift" -o "$resources/app/mac-window-tracker"
mkdir "$resources/closure-decoration" "$resources/closure-theme"
for file in cdp.cjs decoration.css decoration.mjs palette.cjs renderer-payload.cjs; do
  cp "$root/outputs/closure-decoration/$file" "$resources/closure-decoration/"
done
cp "$root/outputs/closure-theme/closure-dark.txt" "$root/outputs/closure-theme/LICENSE" "$resources/closure-theme/"
rm -f "$resources/default_app.asar"

plist="$bundle/Contents/Info.plist"
app_version=$(node -p 'require(process.argv[1]).version' "$resources/app/package.json")
mv "$bundle/Contents/MacOS/Electron" "$bundle/Contents/MacOS/Closure Companion"
plutil -replace CFBundleExecutable -string 'Closure Companion' "$plist"
plutil -replace CFBundleIdentifier -string "$bundle_id" "$plist"
plutil -replace CFBundleName -string 'Closure Companion' "$plist"
plutil -replace CFBundleDisplayName -string '可露希尔 · Codex 桌宠' "$plist"
plutil -replace CFBundleShortVersionString -string "$app_version" "$plist"
plutil -replace CFBundleVersion -string "$app_version" "$plist"
plutil -replace LSUIElement -bool YES "$plist"
for helper in "$bundle/Contents/Frameworks/"*.app; do
  helper_plist="$helper/Contents/Info.plist"
  identifier=$(plutil -extract CFBundleIdentifier raw "$helper_plist")
  plutil -replace CFBundleIdentifier -string "$bundle_id${identifier#com.github.Electron}" "$helper_plist"
done

codesign --force --deep --sign - "$bundle"
codesign --verify --deep --strict "$bundle"

target="$root/dist/$bundle_name"
if [[ -e "$target" ]]; then
  existing_id=$(plutil -extract CFBundleIdentifier raw "$target/Contents/Info.plist")
  if [[ "$existing_id" != "$bundle_id" ]]; then
    echo "目标位置已有另一个应用：$target" >&2
    exit 1
  fi
  mv "$target" "$stage/previous.app"
fi
if ! mv "$bundle" "$target"; then
  [[ ! -e "$stage/previous.app" ]] || mv "$stage/previous.app" "$target"
  exit 1
fi
printf '已生成 %s\n' "$target"
