const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'paisaflow.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'cash',
    emoji TEXT NOT NULL DEFAULT '💵',
    color TEXT NOT NULL DEFAULT '#6366f1',
    initial_balance INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income','expense')),
    emoji TEXT NOT NULL DEFAULT '📦',
    color TEXT NOT NULL DEFAULT '#6366f1',
    is_default INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    UNIQUE(user_id, category_id, month)
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target INTEGER NOT NULL CHECK (target > 0),
    deadline TEXT,
    emoji TEXT NOT NULL DEFAULT '🎯',
    color TEXT NOT NULL DEFAULT '#6366f1',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS goal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS recurring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income','expense')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    next_date TEXT NOT NULL,
    last_posted TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    lender TEXT NOT NULL DEFAULT '',
    principal INTEGER NOT NULL CHECK (principal > 0),
    rate REAL NOT NULL DEFAULT 0,
    tenure_months INTEGER NOT NULL CHECK (tenure_months > 0),
    emi INTEGER NOT NULL CHECK (emi > 0),
    start_date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    closed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS loan_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_txn_user_date ON transactions(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_txn_user_type ON transactions(user_id, type);
  CREATE INDEX IF NOT EXISTS idx_txn_user_cat ON transactions(user_id, category_id);

  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    note TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','cancelled')),
    upi_id TEXT NOT NULL DEFAULT '',
    payee_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    received_at TEXT,
    txn_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
  );
`);

// Lightweight migrations for databases created by earlier versions
(function migrate() {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('upi_id')) {
    db.exec("ALTER TABLE users ADD COLUMN upi_id TEXT NOT NULL DEFAULT ''");
  }
})();

// Default category set seeded for every new user (app defaults, not demo data)
const DEFAULT_CATEGORIES = [
  ['expense', 'Food & Dining', '🍔', '#f97316'],
  ['expense', 'Groceries', '🛒', '#84cc16'],
  ['expense', 'Shopping', '🛍️', '#ec4899'],
  ['expense', 'Transport', '🚗', '#3b82f6'],
  ['expense', 'Rent', '🏠', '#8b5cf6'],
  ['expense', 'Utilities', '💡', '#eab308'],
  ['expense', 'Bills & Recharge', '📱', '#06b6d4'],
  ['expense', 'Health', '🏥', '#ef4444'],
  ['expense', 'Education', '📚', '#6366f1'],
  ['expense', 'Entertainment', '🎬', '#d946ef'],
  ['expense', 'Travel', '✈️', '#0ea5e9'],
  ['expense', 'Fitness', '💪', '#22c55e'],
  ['expense', 'EMI & Loans', '🏦', '#64748b'],
  ['expense', 'Gifts & Donations', '🎁', '#f43f5e'],
  ['expense', 'Subscriptions', '📺', '#a855f7'],
  ['expense', 'Others', '📦', '#94a3b8'],
  ['income', 'Salary', '💼', '#22c55e'],
  ['income', 'Business', '📈', '#10b981'],
  ['income', 'Investments', '📊', '#14b8a6'],
  ['income', 'Freelance', '💻', '#0ea5e9'],
  ['income', 'Interest & Cashback', '🪙', '#eab308'],
  ['income', 'Other Income', '💰', '#84cc16']
];

function seedUser(userId) {
  const catStmt = db.prepare(
    'INSERT INTO categories (user_id, name, type, emoji, color, is_default) VALUES (?, ?, ?, ?, ?, 1)'
  );
  const seedCats = db.transaction((uid) => {
    for (const [type, name, emoji, color] of DEFAULT_CATEGORIES) {
      catStmt.run(uid, name, type, emoji, color);
    }
  });
  seedCats(userId);
  db.prepare(
    "INSERT INTO accounts (user_id, name, type, emoji, color, initial_balance) VALUES (?, 'Cash', 'cash', '💵', '#22c55e', 0)"
  ).run(userId);
}

module.exports = { db, seedUser, DATA_DIR };
