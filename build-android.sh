#!/bin/sh
# Builds the Android app. With no argument: a debug APK.
#
#   ./build-android.sh                  debug APK   android/app/build/outputs/apk/debug/app-debug.apk
#   ./build-android.sh --webview-debug  debug APK whose WebView can be inspected and driven
#                                       (what scripts/android-check.mjs needs). Never ship one.
#   ./build-android.sh --release        signed release: the Play bundle and an APK, in outputs/
#                                         outputs/thingglance.aab     what Play takes
#                                         outputs/thingglance.apk     the same build, installable
#                                         outputs/SHA256SUMS.txt
#                                       Needs android/keystore.properties (see the .example beside it).
#   ./build-android.sh --release --build N
#                                       the same with a test version code, N from 1 to 99.
#
# The version name always comes from package.json, and the version code
# follows from it (android/app/build.gradle: 0.1.0 is 10000). Play refuses an
# upload whose code is not higher than every one before it, on any track, so
# each test upload of the same version takes the next N: 0.1.0 build 2 is
# 10002. Promote the bundle that passes; do not rebuild it under a lower code.
#
# Gradle needs JDK 21. A newer default JDK fails with "Unsupported class file
# major version", so the JDK is picked here and not left to the shell.
# (docs/release.md has the whole release, Play Console included.)
set -e
cd "$(dirname "$0")"
ROOT=$(pwd)

MODE=debug
BUILD_NUM=
while [ $# -gt 0 ]; do
  case "$1" in
    --release) MODE=release; shift ;;
    --webview-debug) export CAP_WEBVIEW_DEBUG=1; shift ;;
    --build)
      [ $# -ge 2 ] || { echo "--build needs a number, as in --build 3" >&2; exit 2; }
      BUILD_NUM=$2; shift 2 ;;
    --build=*) BUILD_NUM=${1#--build=}; shift ;;
    *) echo "unknown option: $1 (--release, --build N, --webview-debug)" >&2; exit 2 ;;
  esac
done

# A WebView that can be inspected hands the app's storage to anyone with a
# cable. A release is never built with one, whatever the environment says.
if [ "$MODE" = release ] && [ "${CAP_WEBVIEW_DEBUG:-}" = 1 ]; then
  echo "A release build cannot have an inspectable WebView. Drop --webview-debug (or unset CAP_WEBVIEW_DEBUG)." >&2
  exit 2
fi

VERSION=$(node -e 'console.log(require(process.argv[1]).version)' "$ROOT/package.json")
BASE_CODE=$(node -e 'const [a, b, c] = process.argv[1].split(".").map(Number); console.log(a * 1000000 + b * 10000 + c * 100)' "$VERSION")
VERSION_CODE=$BASE_CODE
if [ -n "$BUILD_NUM" ]; then
  [ "$MODE" = release ] || { echo "--build N is for release builds: add --release." >&2; exit 2; }
  case "$BUILD_NUM" in
    ''|*[!0-9]*) echo "--build N must be a whole number from 1 to 99." >&2; exit 2 ;;
  esac
  if [ "$BUILD_NUM" -lt 1 ] || [ "$BUILD_NUM" -gt 99 ]; then
    echo "--build N must be from 1 to 99. Past that, raise the version: npm version patch." >&2; exit 2
  fi
  VERSION_CODE=$((BASE_CODE + BUILD_NUM))
fi

if [ -z "$JAVA_HOME" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"21'; then
  if [ -x /usr/libexec/java_home ] && /usr/libexec/java_home -v 21 >/dev/null 2>&1; then
    JAVA_HOME=$(/usr/libexec/java_home -v 21); export JAVA_HOME
  else
    echo "JDK 21 is required. Install it, or set JAVA_HOME to one." >&2; exit 1
  fi
fi
: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"; export ANDROID_HOME

if [ "$MODE" = release ] && [ ! -f android/keystore.properties ]; then
  echo "android/keystore.properties is missing: a release build would be unsigned." >&2
  echo "Copy android/keystore.properties.example and fill it in." >&2
  exit 1
fi

# Every web build has new file names. Gradle's packaging keeps the old ones
# in this folder and then trips over them; it is rebuilt each time anyway.
rm -rf android/app/build/intermediates/compressed_assets

npm run build:android

if [ "$MODE" != release ]; then
  (cd android && ./gradlew assembleDebug)
  echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
  exit 0
fi

# Checked on what will actually be packaged, not on what was asked for.
if grep -q '"webContentsDebuggingEnabled"[[:space:]]*:[[:space:]]*true' android/app/src/main/assets/capacitor.config.json; then
  echo "The synced app has WebView debugging on. Not building a release from it." >&2; exit 1
fi

echo "==> thingGLANCE $VERSION, version code $VERSION_CODE"
(cd android && ./gradlew assembleRelease bundleRelease -PappVersionCode="$VERSION_CODE")

OUT=outputs
mkdir -p "$OUT"
cp android/app/build/outputs/bundle/release/app-release.aab "$OUT/thingglance.aab"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT/thingglance.apk"

# A wrong or half-filled keystore.properties shows here, not when someone
# tries to install it or Play refuses the upload.
APKSIGNER=$(command -v apksigner || true)
[ -n "$APKSIGNER" ] || APKSIGNER=$(ls "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort | tail -1)
[ -n "$APKSIGNER" ] || { echo "apksigner was not found (Android build-tools): cannot check the signature." >&2; exit 1; }
echo "==> Checking the signatures"
"$APKSIGNER" verify --print-certs "$OUT/thingglance.apk" | grep -E "certificate (DN|SHA-256)"
"$JAVA_HOME/bin/jarsigner" -verify "$OUT/thingglance.aab" | grep -q "jar verified" || { echo "The bundle is not signed." >&2; exit 1; }
echo "    bundle: signed"

(
  cd "$OUT"
  if command -v sha256sum >/dev/null 2>&1; then sha256sum thingglance.aab thingglance.apk > SHA256SUMS.txt
  else shasum -a 256 thingglance.aab thingglance.apk > SHA256SUMS.txt; fi
)

echo "==> Release $VERSION ($VERSION_CODE)"
echo "    Bundle for Play: $OUT/thingglance.aab"
echo "    APK:             $OUT/thingglance.apk"
echo "    Checksums:       $OUT/SHA256SUMS.txt"
