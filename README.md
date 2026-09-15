# 💸 PaisaFlow — Your Money, Sorted

A complete personal finance tracker built for India. Track where every rupee goes — expenses, income, budgets, savings goals, EMIs, subscriptions and insights — plus **UPI QR money requests** and **automatic payment capture from bank SMS**. **100% free, no ads, no accounts, no third-party services.** All amounts in ₹ (INR) with Indian formatting (₹1,25,000 style).

## 📱 Android app — install & use, that's it

The APK is a **complete, standalone app**. No server, no hosting, no URLs to paste, no internet needed — everything runs on your phone and your data never leaves it.

1. **Get the APK** — open your repo on GitHub → **Actions** → *Build Android APK* → latest run → download `paisaflow-debug-apk` (or the **Releases** page for pushes to `main`).
2. **Install** — open the file, allow "Install unknown apps" if asked (Android 6.0+).
3. **Done.** PaisaFlow opens straight into your money — the app creates your profile on the device automatically.

Add your name + UPI ID in **Settings** (used for Request-Money QR codes), and optionally:

- 🔒 **PIN lock** — Settings → App lock
- 📲 **Auto-capture payments** — Settings → Auto-capture. Every UPI/card/netbanking payment makes your bank send an SMS; PaisaFlow reads **transaction SMS only** (never OTPs or personal messages) and logs the expense/income automatically — offline and free, works with every bank and every payment app (this is how Walnut-style apps work; official bank APIs in India require paid licences, so bank SMS is the free route). Works while the app is running or in recents.

### Build the APK yourself (optional)

```bash
npm run setup && npm run build        # build the web app
cd client && npx cap sync android     # copy it into the Android project
cd android && ./gradlew assembleDebug # → app/build/outputs/apk/debug/app-debug.apk
```

Requires Node 18+, JDK 17+ and the Android SDK (Android Studio works too). Or just push to `main` — **GitHub Actions builds and publishes the APK automatically, free** (see `.github/workflows/build-apk.yml`).

## 🌐 The website (optional)

The same UI also runs as a classic hosted web app with email/password login and a shared SQLite database — useful if you want your data on a server instead of (or as well as) your phone.

```bash
npm run setup   # installs everything (one time)
npm run build   # builds the web app
npm start       # → http://localhost:4000
```

On a normal host the site uses the server database; if you open the web app anywhere *without* a server, it automatically switches to the same on-device storage as the phone — so it always works.

## ✨ Features

| Area | What you get |
|---|---|
| **Transactions** | Income / expense / transfer with category, account, note, tags & date. Search, filter, sort, date-grouped history, edit & delete with optimistic updates. |
| **Auto-capture** 📲 | Bank transaction SMS → automatic entries (Android). Filter-proof: OTPs, failed & promotional SMS are ignored. |
| **Dashboard** | Monthly income, expenses, net flow & total balance; daily spending chart; category donut; budget & goal progress; upcoming recurring; recent activity. |
| **Accounts** | Cash, Bank, UPI, Credit card, Wallet — live computed balances, opening balance, archive/restore. Transfers between accounts. |
| **Request Money (UPI QR)** | Create a request → get a real **`upi://pay` QR code** scannable by GPay/PhonePe/Paytm/BHIM. Share the QR image, copy the payment link, open straight in a UPI app, track pending/overdue, and "mark received" auto-logs the income. |
| **Budgets** | Monthly per-category limits, over-budget alerts, "copy last month" rollover. |
| **Goals** | Progress rings, contributions & withdrawals, deadlines, full history. |
| **Recurring** | Rent, EMIs, subscriptions, salary — auto-posted on due date (catches up missed dates), pause/resume, post-now. |
| **Loans & EMIs** | Principal, rate, tenure → auto EMI, outstanding balance, interest paid, amortisation schedule, extra payments. |
| **Insights** | 12-month income-vs-expense trend, category & account splits, biggest expenses, monthly/yearly views. |
| **Data** | One-click CSV export (via Android share sheet); CSV import (works with bank statements — auto-creates missing categories). |
| **Extras** | Dark mode, fully responsive, empty states, loading skeletons, toasts, all in ₹. |

## 🧰 Tech stack

- **Frontend:** React 18 + Vite + Tailwind CSS + Recharts + lucide icons + `qrcode` (`client/`)
- **Mobile:** Capacitor 7 (WebView wrapper) + a tiny native SMS watcher plugin → APK via GitHub Actions
- **On-device backend:** `client/src/lib/localBackend.js` — a faithful JavaScript mirror of the server API, persisted to the phone's storage (`scripts/parity-test.mjs` proves 1:1 response parity against the Express server)
- **Web backend (optional):** Node.js + Express (`server/`) — plain JavaScript
- **Database:** SQLite via better-sqlite3 (`data/paisaflow.db`) for the hosted website; the phone app stores everything locally

```
paisaflow/
├── .github/workflows/build-apk.yml   # auto-builds & publishes the APK
├── server/           # Express API (website mode)
├── client/           # React app + local on-device backend
│   └── android/      # Capacitor Android project (+ SmsWatcherPlugin)
├── scripts/parity-test.mjs             # server vs local parity test
└── data/             # SQLite database (website mode only, git-ignored)
```

## 🔒 Notes

- Money is stored as **integer paise** — no floating-point rounding errors.
- UPI QR uses the standard NPCI deep-link (`upi://pay?pa=…&pn=…&am=…&tn=…&cu=INR`) — works with every UPI app in India.
- The Android app works fully offline; SMS permissions are used only to read bank transaction messages, and that data stays on the phone.
