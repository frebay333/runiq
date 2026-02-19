// build.js
// Runs during Vercel build — injects env vars into HTML files.
// Secrets never touch the frontend code directly.

const fs = require('fs');

const clientId   = process.env.STRAVA_CLIENT_ID;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!clientId)     { console.error('ERROR: STRAVA_CLIENT_ID not set.');   process.exit(1); }
if (!anthropicKey) { console.error('ERROR: ANTHROPIC_API_KEY not set.');  process.exit(1); }

// Inject into athlete app
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace("'%%STRAVA_CLIENT_ID%%'", `'${clientId}'`);
html = html.replace("'YOUR_KEY_HERE'", `'${anthropicKey}'`);
fs.writeFileSync('index.html', html);

// Inject into coach portal
let coach = fs.readFileSync('runiq-coach.html', 'utf8');
coach = coach.replace("'YOUR_KEY_HERE'", `'${anthropicKey}'`);
fs.writeFileSync('runiq-coach.html', coach);

console.log('Build complete. All env vars injected.');
