-- BG Vanish D1 Schema

CREATE TABLE IF NOT EXISTS users (
  google_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  credits INTEGER DEFAULT 3,
  plan TEXT DEFAULT 'free',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT NOT NULL,
  paypal_order_id TEXT UNIQUE NOT NULL,
  plan_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT DEFAULT 'USD',
  credits_added INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  captured_at TEXT,
  FOREIGN KEY (google_id) REFERENCES users(google_id)
);
