# Branch Pulse mobile (Expo / React Native)

Phone app for Branch Pulse. It uses the same API, sign-in rules, roles and look as the web app (navy brand, same light/dark palette).

| Signed in as | Sees |
|---|---|
| Branch manager / staff (can submit closings) | **Today** checklist, **Sales**, **Expense** (receipt photo), **Stock** (daily count, wastage, purchases, stock on hand, transfers, variance), **Closing** (cash count + submit). From Today: **Cash** and **Staff** (attendance, advances, team). |
| Admin, Accountant, Stock Manager | **Dashboard** (period pill: Today / Yesterday / This Week / This Month / All Time / Custom range), **Approvals**, **More**, **Account** |
| Super Admin | **Companies** (new company, edit, users: edit mobile / reset password by SMS, activate / deactivate), **Data Upload** (Excel ledger + sample), **Account** |

**More** lists every back-office section the user has permission for, as on the web sidebar: Closings (review, approve, reject, reopen), Cash (daily, variance report, per-branch detail with approve / reject), Expenses (overview, ledger with approvals, categories), Purchases (overview, list + entry, suppliers with ledger and payments), Profit & Loss, Inventory (stock, count, wastage, transfers, variance, items), Recipes, Employees (staff, attendance, salary, advances), Branches (add / edit, manager, report, history), Users, Settings (general, approval limits, roles, units).

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
- **English and Tamil**, like the web: switch under Account (or at the bottom of the sign-in screen); the choice is remembered on the phone. Screens are written in English and `tr()` (`src/lib/i18n.ts`) translates them from `src/lib/ta-web.ts` (generated from the web table) and `src/lib/ta-extra.ts` (mobile-only text: add new strings there). Branch / category / item names show their Tamil form when the server has one. Server error messages and anything people type stay as they are. Tamil wording should be reviewed by a native speaker.
- On first sign-in with a default / temporary password the app asks for a new one (same rules as the web).
- Not in the app yet: CSV exports, charts (bars and tables are used instead), Tamil, and the stock / supplier analytics tables beyond the summaries above.

## Build an installable app

```bash
npm i -g eas-cli
eas build --platform android --profile preview   # APK
```
