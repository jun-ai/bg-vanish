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
