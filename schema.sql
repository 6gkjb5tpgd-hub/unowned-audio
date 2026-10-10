-- Safe to re-run: every statement is IF NOT EXISTS.
-- wrangler d1 execute unowned-audio --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  archive_url TEXT NOT NULL DEFAULT '',
  licence_note TEXT NOT NULL DEFAULT '',
  content_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'claimed',
  removed INTEGER NOT NULL DEFAULT 0,
  removed_reason TEXT NOT NULL DEFAULT '',
  updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate (bucket TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL,
  contribution_id INTEGER NOT NULL,
  created TEXT NOT NULL,
  PRIMARY KEY (user_id, contribution_id)
);
CREATE INDEX IF NOT EXISTS idx_contrib_user ON contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_contrib ON bookmarks(contribution_id);
