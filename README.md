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


## Critical fix included in this package

The backend now sets `app.set('trust proxy', 1)` before Express rate limiting. This is required on Render's reverse-proxy setup and fixes the reported `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` error that can break registration/login POST requests. The existing public `/health` and `/api/config` GET routes can work even when registration POST is failing, so those GET checks alone do not prove signup works.

## Exact Windows steps — no source-code editing

### A. Update the backend that is already deployed on Render

1. Extract this ZIP.
2. Open the `GlobalChat-main` folder.
3. In your GitHub repository `amondal73837383-ux/GlobalChat`, update the project files from this extracted folder and commit/push the changes. If you use GitHub Desktop: add the extracted files to the existing local repository, review the changed files, commit with message `Fix Render proxy handling and Android build setup`, then **Push origin**. Do not upload `.env` or any real secrets.
4. In Render, open the existing GlobalChat API service and confirm it is connected to that repository/branch. Wait for the deployment triggered by the push to finish successfully.
5. In Render → Environment, check these values exist (do not paste secret values into chat or screenshots):
   - `MONGODB_URI`: your real MongoDB connection URI
   - `JWT_SECRET`: a random secret at least 32 characters long
   - `ADMIN_API_KEY`: a different random secret
   - `NODE_ENV`: `production`
   - `CLIENT_ORIGINS`: comma-separated browser origins that use the API, e.g. `https://ichat-sand.vercel.app` plus the exact admin-site origin if it is deployed separately. No trailing slash.
6. After deployment, open these URLs in a phone browser:
   - `https://globalchat-zow3.onrender.com/health` — expect `"status":"ok"` and `"database":"connected"`.
   - `https://globalchat-zow3.onrender.com/api/config` — expect a JSON `config` object.
7. Then test the actual app's **registration POST**. Use a phone number in international format (India example: `+91` followed by the 10-digit number) and a password of at least 10 characters. Use a number you control. A successful registration should enter the app and show a GlobalChat ID. If it says the number already has an account, use Login instead. Do not repeatedly retry rapidly because the API has rate limits.

### B. Build the Android APK automatically on Windows

1. Install Flutter stable and Android Studio, including Android SDK tools. Add Flutter's `bin` folder to Windows PATH, then close and reopen Command Prompt. Flutter installation guide: https://docs.flutter.dev/get-started/install/windows
2. Extract the ZIP to a normal writable folder, for example `D:\GlobalChat`.
3. Open `GlobalChat-main\flutter_app`.
4. Double-click `BUILD_ANDROID.bat` and let it finish. It generates missing Android project files, ensures Internet/microphone permissions, fetches packages, runs `flutter analyze`, and builds the release APK. You do not need to edit Dart files.
5. If the window reports `SUCCESS`, the APK is at:
   `GlobalChat-main\flutter_app\build\app\outputs\flutter-apk\app-release.apk`
6. Copy that APK to the phone and install it. If Android blocks installation, allow installation from that source in Android settings. For release distribution, use a properly signed release and follow Android's security prompts.

### C. If registration still fails

- First confirm the Render deployment completed and the health URL reports `database: connected`.
- In Render → Logs, reproduce one registration attempt and inspect the newest log. The `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` error should no longer appear after this backend version is deployed.
- If the API returns an HTTP validation message, follow that message (international phone format and password length are validated). If it returns `500`, check the corresponding Render log and MongoDB service status.
- Share only the error text and relevant redacted log lines. Never share passwords, JWTs, `MONGODB_URI`, `JWT_SECRET`, or `ADMIN_API_KEY`.

## Verification status and limitations

The source archive was inspected and the proxy fix plus Windows build automation were added. JavaScript syntax checks and the proxy-order check pass. A full dependency-aware backend build could not be completed here because `npm install` timed out in this environment, and Flutter/Android build and real-device registration tests cannot be truthfully marked as passed until run on a machine with Flutter/Android SDK and against the live deployment. This is why the instructions above include explicit verification steps; do not treat the APK as built until the batch file reports `SUCCESS`.
