# GlobalChat update log

## Refreshed MVP

### Backend
- Added phone-number registration and phone-number login while retaining GlobalChat-ID login for legacy accounts.
- Added normalized international phone number validation and duplicate-number responses.
- Changed default JWT lifetime from one hour to 30 days for persistent sessions.
- Added authenticated current-user profile endpoints and user search by phone number or ID.
- Added public remote app configuration endpoint.
- Added voice-message storage and authorized audio retrieval; capped payload size and limited message POST frequency.
- Added admin user search and block/unblock API. Blocking an account now disconnects its active sockets and prevents subsequent authenticated API access.
- Added remote config for logo URL, APK URL, maintenance flag, name, color, and announcement.

### Flutter
- Rebuilt the auth and conversation screens with a consistent Material 3 design.
- Added phone-number sign-up/sign-in, secure persisted sessions, user ID sharing details, direct-chat search, group creation, message deduplication, and clearer loading/error states.
- Added microphone recording and voice-note playback using `record`, `path_provider`, and `audioplayers`.
- Fetches supported remote app name, logo URL, and primary theme color from the backend.

### Website and admin
- Rebuilt the admin page as a responsive control center with live metrics, configuration preview, branding settings, user search, and block/unblock controls.
- Website now fetches public remote config, supports remote name/logo/color/announcement/download URL, and shows API health status.
- Updated privacy/terms pages to describe the current MVP's actual limits more accurately.

### Deployment documentation
- Added `.env.example`, `.gitignore`, Android setup instructions, and an updated deployment/API guide.
