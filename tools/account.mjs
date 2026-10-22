// Helps the owner look after accounts, since the app can't email anyone.
//
//   node tools/account.mjs count                  how many accounts there are
//   node tools/account.mjs reset <email>          gives that account a temporary password
//   node tools/account.mjs reset <email> --local  the same, on the local test database
//
// A reset prints a temporary password to pass on to the person (by message or in
// person); they sign in with it and choose their own under Library → ⋯ → Change
// password. It also signs them out everywhere and clears any lock from wrong guesses.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = path.join(ROOT, 'node_modules/.bin/wrangler');
const [cmd, emailArg] = process.argv.slice(2);
const where = process.argv.includes('--local') ? '--local' : '--remote';

function d1(sql) {
  const out = execFileSync(WRANGLER, ['d1', 'execute', 'kirtan-accounts', where, '--json', '--command', sql], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(out)[0].results;
}
const quote = s => `'${String(s).replace(/'/g, "''")}'`;

// Same as the app: PBKDF2-SHA256, 600,000 rounds, salted with the email.
const keyFor = (email, password) => crypto.pbkdf2Sync(password, `kirtan-app|${email}`, 600000, 32, 'sha256').toString('base64url');

if (cmd === 'count') {
  console.log(`${d1('SELECT COUNT(*) AS n FROM users')[0].n} accounts`);
} else if (cmd === 'reset' && emailArg) {
  const email = emailArg.trim().toLowerCase();
  const user = d1(`SELECT id, name FROM users WHERE email = ${quote(email)}`)[0];
  if (!user) {
    console.error(`No account uses ${email}. Check the spelling with the person.`);
    process.exit(1);
  }
  // Easy to read out and type: three short words of letters and digits.
  const words = Array.from({ length: 3 }, () => crypto.randomBytes(3).toString('hex'));
  const temporary = words.join('-');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + keyFor(email, temporary)).digest('hex');
  d1(`UPDATE users SET pass_hash = ${quote(hash)}, salt = ${quote(salt)} WHERE id = ${quote(user.id)};
      DELETE FROM sessions WHERE user_id = ${quote(user.id)};
      DELETE FROM login_attempts WHERE email = ${quote(email)};`);
  console.log(`Temporary password for ${user.name || email}: ${temporary}`);
  console.log('Ask them to sign in with it, then change it under Library → ⋯ → Change password.');
} else {
  console.log('Use: node tools/account.mjs count | reset <email> [--local]');
  process.exit(1);
}
