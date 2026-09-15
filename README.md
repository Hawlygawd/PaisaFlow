# 💸 PaisaFlow — Your Money, Sorted

A complete personal finance tracker built for India, inspired by FOLD. Track where every rupee goes — expenses, income, budgets, savings goals, EMIs, subscriptions and insights — plus **UPI QR money requests** and a **weekly email digest**. **100% free, no ads, no third-party services.** All amounts in ₹ (INR) with Indian formatting (₹1,25,000 style).

## ✨ Features

| Area | What you get |
|---|---|
| **Transactions** | Income / expense / transfer with category, account, note, tags & date. Search, filter, sort, date-grouped history, edit & delete with optimistic updates. |
| **Dashboard** | Monthly income, expenses, net flow & total balance; daily spending chart; category donut; budget & goal progress; upcoming recurring; recent activity. |
| **Accounts** | Cash, Bank, UPI, Credit card, Wallet — live computed balances, opening balance, archive/restore. Transfers between accounts. |
| **Request Money (UPI QR)** | Create a request → get a real **`upi://pay` QR code** scannable by GPay/PhonePe/Paytm/BHIM. Share the QR image on WhatsApp, copy the payment link, track pending/overdue, and "mark received" auto-logs the income. |
| **Weekly Email Digest** | A beautiful HTML email with last 7 days' income/expenses/net, top categories, budget alerts, upcoming recurring and goal progress. Works with any SMTP (Gmail app password = free). Test-send button included. |
| **Budgets** | Monthly per-category limits, over-budget alerts, "copy last month" rollover. |
| **Goals** | Progress rings, contributions & withdrawals, deadlines, full history. |
| **Recurring** | Rent, EMIs, subscriptions, salary — auto-posted on due date (catches up missed dates), pause/resume, post-now. |
| **Loans & EMIs** | Principal, rate, tenure → auto EMI, outstanding balance, interest paid, amortisation schedule, extra payments. |
| **Insights** | 12-month income-vs-expense trend, category & account splits, biggest expenses, monthly/yearly views. |
| **Data** | One-click CSV export; CSV import (works with bank statements — auto-creates missing categories). |
| **Mobile app** | Android APK (Capacitor) built automatically by **GitHub Actions** and published to your repo's Releases page. |
| **Extras** | Dark mode, fully responsive, empty states, loading skeletons, toasts, secure auth (bcrypt + httpOnly cookies or Bearer tokens), all in ₹. |

## 🚀 Run the website (for non-coders)

Install [Node.js 18+](https://nodejs.org) once, then in this folder:

```bash
npm run setup   # installs everything (one time)
npm run build   # builds the app (one time, or after changes)
npm start       # starts → open http://localhost:4000
```

Your data = a single file: `data/paisaflow.db`. Copy it to back up. Nothing leaves your machine.

### Free hosting (recommended, so the APK can reach it)
- **Render.com** → New Web Service → build command `npm run setup && npm run build`, start command `npm start`. Set env `TZ=Asia/Kolkata` so the digest scheduler uses IST.
- Railway / Fly.io / any VPS work the same way.

## 📱 Get the Android APK (via your GitHub)

The APK is built in the cloud by **GitHub Actions** (free) — no Android Studio needed, ever.

1. Create a new repo on GitHub (e.g. `paisaflow`) — public repos get unlimited free Actions.
2. Push this folder to it (see "Push to GitHub" below).
3. Every push to `main` automatically:
   - builds the web app, wraps it with Capacitor, compiles the Android app,
   - publishes **`app-debug.apk`** to the repo's **Releases** page (tag `apk-latest`) and as a build artifact.
4. On your phone: open your repo → Releases → download `app-debug.apk` → allow "install unknown apps" → open.
5. First launch: on the login screen tap **"Using the Android app? Set server URL"**, paste your hosted server URL, save, and sign in. (Your data syncs with the website — same account, same database.)

### Push to GitHub

```bash
cd paisaflow
git init                       # (already done if you received this as a git repo)
git add -A
git commit -m "PaisaFlow v1.1 — expense tracker with UPI QR, digest & Android APK"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/paisaflow.git
git push -u origin main
```

Then open **Actions** tab → the "Build Android APK" workflow runs → ~5–8 minutes → APK in **Releases**.

> First Actions run on a new repo: enable workflows if prompted. The workflow is already committed, so this is automatic.

## ✉️ Weekly digest setup (free with Gmail)

Settings → **Weekly Email Digest**: enable, pick day/time, then SMTP:
- Host `smtp.gmail.com`, port `587` (SSL off) — your Gmail address + a **Gmail App Password**
  (Google Account → Security → 2-Step Verification ON → App passwords).
- Hit **Send test email** to verify. That's it — digests go out on your chosen day, from your own account, to you.

## 🧰 Tech stack

- **Frontend:** React 18 + Vite + Tailwind CSS + Recharts + lucide icons + `qrcode` (`client/`)
- **Mobile:** Capacitor 6 (WebView wrapper) → debug APK via GitHub Actions
- **Backend:** Node.js + Express + nodemailer (`server/`) — plain JavaScript
- **Database:** SQLite via better-sqlite3 (`data/paisaflow.db`)
- **Auth:** bcryptjs + JWT (httpOnly cookie in browser, Bearer token in the APK)

```
paisaflow/
├── .github/workflows/build-apk.yml   # auto-builds & publishes the APK
├── server/           # Express API + digest scheduler
├── client/           # React app
│   └── android/      # Capacitor Android project (built in CI)
└── data/             # SQLite database (created automatically, git-ignored)
```

## 🔒 Notes

- Money is stored as **integer paise** — no floating-point rounding errors.
- UPI QR uses the standard NPCI deep-link (`upi://pay?pa=…&pn=…&am=…&tn=…&cu=INR`) — works with every UPI app in India.
- SMTP credentials stay in your private SQLite file; emails are sent directly from your account to your inbox.
