#!/usr/bin/env bash
# Đóng gói CC Motion Editor cho macOS -> release/CC-Motion-Editor-<version>-<arch>.dmg
#   bash scripts/build-mac.sh            # cả arm64 (chip M) và x64 (Intel)
#   bash scripts/build-mac.sh arm64      # chỉ một kiến trúc
# Chạy được trên macOS (electron-builder tự làm DMG + ký ad-hoc)
# hoặc Linux (cần xorriso + rcodesign: cargo install apple-codesign --bin rcodesign).
set -euo pipefail
cd "$(dirname "$0")/.."
ARCHS=("${@:-arm64 x64}")
ARCHS=(${ARCHS[@]})

npx electron-vite build
[ -f build/icon.png ] || python3 scripts/make-icon.py

for arch in "${ARCHS[@]}"; do
  # ffmpeg đúng kiến trúc Mac
  if [ ! -x "build/bin/darwin-$arch/ffmpeg" ]; then
    tmp=$(mktemp -d)
    cp -r node_modules/ffmpeg-static/. "$tmp/"
    rm -f "$tmp/ffmpeg"
    (cd "$tmp" && npm_config_platform=darwin npm_config_arch=$arch node install.js)
    mkdir -p "build/bin/darwin-$arch"
    mv "$tmp/ffmpeg" "build/bin/darwin-$arch/ffmpeg"
    chmod +x "build/bin/darwin-$arch/ffmpeg"
    rm -rf "$tmp"
  fi

  if [ "$(uname)" = "Darwin" ]; then
    npx electron-builder --mac dmg "--$arch" --config electron-builder.yml
  else
    npx electron-builder --mac dir "--$arch" --config electron-builder.yml
    dir="release/mac-$arch"; [ "$arch" = "x64" ] && dir="release/mac"
    app="$dir/CC Motion Editor.app"
    # ký ad-hoc toàn bộ app (bắt buộc để chạy trên chip Apple Silicon)
    rcodesign sign "$app"
    stage=$(mktemp -d)
    cp -a "$app" "$stage/"
    ln -s /Applications "$stage/Applications"
    version=$(node -p "require('./package.json').version")
    python3 scripts/make-dmg.py "$stage" "release/CC-Motion-Editor-$version-$arch.dmg" "CC Motion Editor"
    rm -rf "$stage"
  fi
done
ls -lh release/*.dmg
