# Branch Pulse mobile (Expo / React Native)

Phone app for Branch Pulse. It uses the same API, sign-in rules, roles and look as the web app (navy brand, same light/dark palette).

| Signed in as | Sees |
|---|---|
| Branch manager / staff (can submit closings) | Today checklist, Sales, Expense (with receipt photo), Cash count, Closing |
| Admin, Accountant, Stock Manager | Dashboard (date stepper, KPI tiles, branches, alerts), expense Approvals, Account |
| Super Admin | Companies (new company, edit, activate / deactivate, **Users**: edit name / mobile / email, reset password by SMS), Data Upload (Excel ledger + sample download), Account |

Sign-in is the same as the web: mobile number, then password + OTP for Admin, OTP only for everyone else, username + password for the Super Admin. In development the OTP is `123456` (API `OTP_FIXED_CODE`).

## Run it

This folder is **not** an npm workspace (the web app uses React 19, Expo SDK 52 needs React 18), so install here:

```bash
cd apps/mobile
npm install
cp .env.example .env     # set EXPO_PUBLIC_API_URL
npm run start            # scan the QR code with Expo Go, or press a for the Android emulator
```

`EXPO_PUBLIC_API_URL` is the API origin without `/api/v1`:

- Android emulator → `http://10.0.2.2:4000`
- Real phone on the same Wi-Fi → `http://<your-pc-lan-ip>:4000` (the API listens on all interfaces)
- Default (unset) → `https://api-branchpulse.antstockpulse.pro`

## How it differs from the web app

- The web keeps the refresh token in an HttpOnly cookie. The app sends `X-Client: native`, gets the refresh token in the response body and keeps it in the device keystore (`expo-secure-store`); the access token stays in memory.
- Every save goes to the server straight away. There is **no offline queue** yet (the web's outbox), so entries need a connection.
- English only for now (the web also has Tamil).
- On first sign-in with a default / temporary password the app asks for a new one (same rules as the web).
- Not in the app yet: Admin's Users / Settings screens, inventory, purchases, recipes, employees, P&L, closing approval.

## Build an installable app

```bash
npm i -g eas-cli
eas build --platform android --profile preview   # APK
```
