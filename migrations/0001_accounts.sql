-- Accounts, so a person's favourites and playlists follow them between devices.
-- Passwords are never stored: the app derives a key from the password on the
-- person's device (PBKDF2, 600,000 rounds), and the server keeps only a salted
-- SHA-256 of that key.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,         -- lower-case
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,            -- hex SHA-256(salt + key from the device)
  salt TEXT NOT NULL,                 -- hex, random per user
  created INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,        -- hex SHA-256 of the cookie's token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Favourites and playlists, as JSON merged item by item (latest change wins).
CREATE TABLE libraries (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL
);

-- Slows down password guessing: 10 wrong passwords lock an email for 15 minutes.
CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);
