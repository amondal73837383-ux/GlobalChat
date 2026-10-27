# Android project setup

This source archive intentionally keeps the Flutter Dart source small and does not include generated Android/Gradle wrapper binaries. On Windows, install Flutter stable and Android Studio first, then open Command Prompt in this folder and run:

```bat
flutter doctor
flutter create --platforms=android --project-name globalchat .
flutter pub get
```

If Flutter asks whether to overwrite project files, do not overwrite `lib/main.dart`, `lib/app_config.dart`, or `pubspec.yaml`. The command should create the missing `android/` platform folder. If your Flutter version does not support adding a platform to an existing project, create a temporary Flutter project and copy its `android/` folder into this folder.

After the Android folder exists, open `android/app/src/main/AndroidManifest.xml` and ensure this permission appears directly under the `<manifest>` element:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

The microphone permission is needed for voice messages. Android will request runtime microphone permission when the user records. Then run:

```bat
flutter pub get
flutter analyze
flutter build apk --release
```

The APK should be at `build\app\outputs\flutter-apk\app-release.apk`.

## Before publishing

- Confirm `lib/app_config.dart` points to your deployed HTTPS backend.
- Test registration, login, session restore, direct chats, groups, text messages, voice recording/playback, and admin-managed logo changes on a real Android device.
- Voice notes are stored as base64 in MongoDB in this MVP. Keep recordings short and monitor database size/limits. This is a starter storage strategy, not a scalable media service.
- The app is not end-to-end encrypted. Do not advertise E2EE until a maintained protocol is implemented and audited.
