# GlobalChat — deployment-ready starter

This repository is a deployable foundation for a global messaging app. It includes a Node/TypeScript API with MongoDB, Socket.IO messaging, a Flutter client, a public download website, and a small protected admin console.

**Important security status:** this starter does **not** implement end-to-end encryption (E2EE), media uploads, push notifications, or translation. Do not advertise it as end-to-end encrypted or use it for sensitive communications until those features are implemented and independently reviewed. Messages in this starter are stored as server-readable text. OTP is intentionally absent.

## Deploy services (no local production dependency)

1. Create a managed MongoDB database (for example MongoDB Atlas free tier, if currently available) and copy its connection URI. Restrict network access to the hosting provider where practical.
2. Create a Node web service on a provider that supports persistent WebSockets (for example Render; verify current free-tier limits). Root directory: `backend`. Build command: `npm install && npm run build`. Start command: `npm start`.
3. Set backend environment variables using `backend/.env.example` as a guide. Use a long random `JWT_SECRET` and `ADMIN_API_KEY`. Set `CLIENT_ORIGINS` to your website/admin URLs, comma-separated. Do not use the sample values.
4. Deploy `website/` as a static site (for example Vercel or Netlify). Set `API_BASE_URL` in `website/config.js` to the deployed API URL before deployment.
5. Deploy `admin/` as a separate static site. Set `API_BASE_URL` and `ADMIN_API_KEY` in `admin/config.js`. **Do not expose the admin key in a public static site for a real production service.** This starter uses a browser-provided admin key only to keep the demo simple. Before public launch, replace it with proper admin login and server-issued short-lived sessions. Until then, restrict the admin site or do not publish it publicly.
6. Set the API URL in `flutter_app/lib/app_config.dart`, then run `flutter pub get` and `flutter build apk --release`. Sign and publish the APK using the official Android signing process. Never publish your signing key.

## API endpoints
- `GET /health` — health check
- `POST /api/auth/register` — `{ "displayName": "Name", "password": "long password" }`
- `POST /api/auth/login` — `{ "userId": "123456789012", "password": "..." }`
- `GET /api/users/:userId` — authenticated user lookup
- `GET /api/conversations` — current user's conversations
- `POST /api/conversations/direct` — `{ "otherUserId": "123456789012" }`
- `POST /api/conversations/group` — `{ "name": "Group", "memberIds": ["..."] }`
- `GET /api/conversations/:id/messages` — conversation messages
- Socket.IO event `message:send` — `{ conversationId, text, clientMessageId? }`; server emits `message:new` to members.
- `GET /api/admin/stats` — header `x-admin-api-key`
- `GET /api/admin/config` and `PUT /api/admin/config` — header `x-admin-api-key`

## Windows CMD build
```bat
cd path\to\GlobalChat_DeployReady\backend
copy .env.example .env
npm install
npm run dev
```
Flutter:
```bat
cd path\to\GlobalChat_DeployReady\flutter_app
flutter pub get
```

## Before production
- Replace static admin key demo with real admin authentication; never embed a secret in a publicly hosted web page.
- Implement and test E2EE using a maintained protocol/library; do not roll your own crypto.
- Add secure media storage, malware scanning, push notifications, translation consent, abuse workflows, account recovery, privacy policy, terms, data deletion/export, backups, monitoring and incident response.
- Review current provider pricing/quotas. Free tiers can sleep, cap usage, change, or be discontinued.
- This generated source has not been deployed to your accounts; you must configure providers and verify live URLs.
