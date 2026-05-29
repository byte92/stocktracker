#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SVG_PATH="$PROJECT_ROOT/app/icon.svg"
BUILD_DIR="$PROJECT_ROOT/build"

mkdir -p "$BUILD_DIR"

echo "Generating PNG from SVG..."
if command -v convert &> /dev/null; then
  convert -background none -density 300 -resize 1024x1024 "$SVG_PATH" "$BUILD_DIR/icon.png"
  echo "PNG generated: $BUILD_DIR/icon.png"
else
  echo "Warning: ImageMagick not found. Install with: brew install imagemagick"
  echo "Alternatively, manually place a 1024x1024 PNG at: $BUILD_DIR/icon.png"
  exit 1
fi

echo "Generating macOS .icns..."
if [[ "$(uname)" == "Darwin" ]]; then
  mkdir -p "$BUILD_DIR/icon.iconset"
  for size in 16 32 64 128 256 512; do
    sips -z "$size" "$size" "$BUILD_DIR/icon.png" --out "$BUILD_DIR/icon.iconset/icon_${size}x${size}.png" > /dev/null 2>&1
    double=$((size * 2))
    sips -z "$double" "$double" "$BUILD_DIR/icon.png" --out "$BUILD_DIR/icon.iconset/icon_${size}x${size}@2x.png" > /dev/null 2>&1
  done
  iconutil -c icns "$BUILD_DIR/icon.iconset" -o "$BUILD_DIR/icon.icns"
  rm -rf "$BUILD_DIR/icon.iconset"
  echo "ICNS generated: $BUILD_DIR/icon.icns"
else
  echo "Skipping .icns generation (requires macOS)"
fi

echo "Generating Windows .ico..."
if command -v png2icons &> /dev/null; then
  png2icons "$BUILD_DIR/icon.png" "$BUILD_DIR/icon.ico" -ico
  echo "ICO generated: $BUILD_DIR/icon.ico"
else
  echo "Warning: png2icons not found. Install with: npm install -g png2icons"
fi

echo ""
echo "Done! Generated files:"
ls -la "$BUILD_DIR/"
