@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo GlobalChat Android release build
echo ==========================================

where flutter >nul 2>nul
if errorlevel 1 (
  echo ERROR: Flutter was not found in PATH.
  echo Install Flutter stable, add its bin folder to PATH, then reopen Command Prompt.
  echo Guide: https://docs.flutter.dev/get-started/install/windows
  pause
  exit /b 1
)

echo [1/5] Checking Flutter installation...
flutter doctor
if errorlevel 1 goto failed

if not exist "android\app\src\main\AndroidManifest.xml" (
  echo [2/5] Generating missing Android project files...
  flutter create --platforms=android --project-name globalchat .
  if errorlevel 1 goto failed
) else (
  echo [2/5] Android project files already exist.
)

echo [3/5] Ensuring required Android permissions exist...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0EnsureAndroidPermissions.ps1"
if errorlevel 1 goto failed

echo [4/5] Downloading Flutter dependencies...
flutter pub get
if errorlevel 1 goto failed

echo [5/5] Analyzing and building release APK...
flutter analyze
if errorlevel 1 goto failed
flutter build apk --release
if errorlevel 1 goto failed

echo.
echo SUCCESS. APK created at:
echo %CD%\build\app\outputs\flutter-apk\app-release.apk
echo.
explorer "%CD%\build\app\outputs\flutter-apk"
pause
exit /b 0

:failed
echo.
echo BUILD FAILED. Read the first ERROR above. Do not publish an APK from a failed build.
pause
exit /b 1
