# GlobalChat — refreshed free-first messaging MVP

GlobalChat is a free-first messaging MVP with a Flutter Android client, Node.js/TypeScript API, MongoDB persistence, Socket.IO updates, a public website, and a separate admin control center. This revision changes the actual registration flow, API behavior, admin functions, website branding hooks, and mobile UI rather than simply repackaging the starter files.

## What is implemented in this revision

- Phone-number registration and login using international format (for example `+919876543210`), with no OTP provider required yet.
- Password hashing with bcrypt and 30-day JWT sessions by default.
- Persistent app login using Flutter secure storage and a `/api/me` session check.
- Direct conversations found by phone number or GlobalChat ID.
- Group creation using member phone numbers or IDs.
- Persisted text messages, Socket.IO live updates, and short voice messages recorded in the app and stored as base64 in MongoDB.
- Admin metrics, user search, block/unblock controls, app name/color/logo URL, APK URL, announcement, and maintenance flag configuration.
- Public `/api/config` endpoint so the website and Flutter client can fetch supported branding settings.
- Redesigned mobile screens, responsive website hooks, and a more complete admin control center.

## Important limitations

- Phone numbers are **not verified** because OTP is not enabled. An account can be registered using a number the registrant does not own.
- Messages are **not end-to-end encrypted**. The backend can read stored text and voice data.
- Voice notes are stored in MongoDB documents to avoid a separate media-storage bill. This is only suitable for short MVP testing and can fill a free database quickly. Monitor limits and keep recordings short.
- The admin dashboard accepts an API key in the browser. The key is not hard-coded in the repository, but a public static admin page is still not a strong production admin-auth design. Restrict the admin site and migrate to server-side admin sessions before a public launch.
- Free hosting providers can sleep, cap traffic/storage, or change their terms. A free tier cannot guarantee production uptime.
- The project has not been deployed to your accounts or independently security-audited.

## Backend deployment

1. Create a MongoDB database and copy its connection URI.
2. Deploy `backend/` as a Node service on a host that supports WebSockets. Build: `npm install && npm run build`; start: `npm start`; health check: `/health`.
3. Set `MONGODB_URI`, `JWT_SECRET` (at least 32 random characters), `ADMIN_API_KEY` (a separate random secret), `CLIENT_ORIGINS` (comma-separated website/admin origins), and `NODE_ENV=production` in the hosting dashboard. Do not commit real secrets.
4. Use `backend/.env.example` as a local template only. Never deploy its placeholder values.

## Website and admin deployment

- Deploy `website/` as one static site. `website/config.js` already points to the current GlobalChat API URL; change it if your API URL changes.
- Deploy `admin/` as a separate static site/project. `admin/config.js` contains only the public API URL. Enter the `ADMIN_API_KEY` manually in the admin UI; do not paste it into `config.js`, commit it, or share it in screenshots.
- Set `CLIENT_ORIGINS` on the backend to the exact website and admin origins, separated by commas and without trailing slashes.
- Logo changes require a public HTTPS image URL. APK links must also be HTTPS.
- Maintenance mode is currently a remote configuration flag; it does not automatically disable API access.

## Flutter Android setup (Windows)

This source archive does not include Flutter's generated Android/Gradle wrapper folder. Read `flutter_app/ANDROID_SETUP.md` and run `flutter create --platforms=android --project-name globalchat .` inside `flutter_app/` to generate it, preserving `lib/` and `pubspec.yaml`. Add INTERNET and RECORD_AUDIO permissions to the generated Android manifest, then:

```bat
cd flutter_app
flutter pub get
flutter analyze
flutter build apk --release
```

APK output: `flutter_app\build\app\outputs\flutter-apk\app-release.apk`.

## API endpoints

- `GET /health` — API/database status.
- `GET /api/config` — public branding/configuration.
- `POST /api/auth/register` — `{ "displayName": "Name", "phoneNumber": "+919876543210", "password": "at least 10 characters" }`.
- `POST /api/auth/login` — `{ "phoneNumber": "+919876543210", "password": "..." }`. Legacy numeric `userId` login remains available for existing accounts without a phone number.
- `GET /api/me`, `PATCH /api/me` — authenticated profile retrieval/update.
- `GET /api/users/search?q=...` — find a user by phone number or GlobalChat ID.
- `GET /api/conversations` — conversations for the current user.
- `POST /api/conversations/direct` — `{ "otherUserId": "..." }`.
- `POST /api/conversations/group` — `{ "name": "Group", "memberIds": ["..."] }`.
- `GET /api/conversations/:id/messages` — saved messages (newest page of 50, returned oldest-first).
- `POST /api/conversations/:id/messages` — text `{ "text": "Hello" }` or voice `{ "audioBase64": "...", "audioMimeType": "audio/mp4" }`.
- `GET /api/conversations/:id/messages/:messageId/audio` — authorized voice playback bytes.
- `GET /api/admin/stats`, `GET /api/admin/config`, `PUT /api/admin/config`, `GET /api/admin/users`, `PATCH /api/admin/users/:userId/block` — protected by `x-admin-api-key`.

## Verification status

JavaScript syntax and TypeScript transpilation syntax were checked in the editing environment. Package installation timed out in this environment, and Flutter/Dart SDK was unavailable, so dependency-aware TypeScript typechecking and an Android build could not be completed here. Run the commands above locally and fix any version-specific warnings before publishing. Do not treat a successful source archive as proof of a deployed or production-tested app.
