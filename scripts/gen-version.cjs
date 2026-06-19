// Writes src/buildInfo.json with the current commit + build time so the app
// can show a "which build is live" badge. Runs as the `prebuild` npm step
// (and can be run by hand). Cross-platform; never throws — falls back to 'dev'
// so a local `npm start` or a checkout without git still builds.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function safe(cmd, fallback) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return fallback; }
}

// On Vercel, VERCEL_GIT_COMMIT_SHA is provided even when .git isn't a full clone.
const sha =
  (process.env.VERCEL_GIT_COMMIT_SHA && process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)) ||
  safe('git rev-parse --short HEAD', 'dev');

const time = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const out = { sha, time };
fs.writeFileSync(path.join(__dirname, '..', 'src', 'buildInfo.json'), JSON.stringify(out, null, 2) + '\n');
console.log('buildInfo:', out);
