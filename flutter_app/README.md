# GlobalChat Flutter app

This client supports phone-number registration/login (without OTP for now), secure persisted sessions, direct chats found by phone number or GlobalChat ID, group creation, saved text messages, Socket.IO live updates, voice-note recording/playback, and supported remote app branding.

## Setup

1. Install Flutter stable and Android Studio.
2. Read `ANDROID_SETUP.md` to generate the Android platform folder and add INTERNET/RECORD_AUDIO permissions.
3. Confirm `lib/app_config.dart` points to the deployed HTTPS backend.
4. Run `flutter pub get`, `flutter analyze`, and `flutter build apk --release`.

The app is not end-to-end encrypted and phone ownership is not verified because OTP is not enabled. Voice notes are stored in MongoDB in this MVP, so keep them short and monitor database quotas.
