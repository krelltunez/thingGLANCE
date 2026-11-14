#!/bin/sh
# Builds the Android app. With no argument: a debug APK.
#
#   ./build-android.sh              debug APK   android/app/build/outputs/apk/debug/app-debug.apk
#   ./build-android.sh --release    release APK and Play bundle (needs android/keystore.properties)
#   ./build-android.sh --webview-debug   debug APK whose WebView can be inspected and driven
#                                        (what scripts/android-check.mjs needs). Never ship one.
#
# Gradle needs JDK 21. A newer default JDK fails with "Unsupported class file
# major version", so the JDK is picked here and not left to the shell.
set -e
cd "$(dirname "$0")"

MODE=debug
for arg in "$@"; do
  case "$arg" in
    --release) MODE=release ;;
    --webview-debug) export CAP_WEBVIEW_DEBUG=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "$JAVA_HOME" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"21'; then
  if [ -x /usr/libexec/java_home ] && /usr/libexec/java_home -v 21 >/dev/null 2>&1; then
    JAVA_HOME=$(/usr/libexec/java_home -v 21); export JAVA_HOME
  else
    echo "JDK 21 is required. Install it, or set JAVA_HOME to one." >&2; exit 1
  fi
fi
: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"; export ANDROID_HOME

npm run build
npx cap sync android

cd android
if [ "$MODE" = release ]; then
  if [ ! -f keystore.properties ]; then
    echo "android/keystore.properties is missing: a release build would be unsigned." >&2; exit 1
  fi
  ./gradlew assembleRelease bundleRelease
  echo "APK:    android/app/build/outputs/apk/release/"
  echo "Bundle: android/app/build/outputs/bundle/release/"
else
  ./gradlew assembleDebug
  echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
fi
