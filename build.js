// build.js
// Runs during Vercel build — injects STRAVA_CLIENT_ID into the HTML.
// The secret never touches this file or the frontend.

const fs = require('fs');

const clientId = process.env.STRAVA_CLIENT_ID;
if (!clientId) {
  console.error('ERROR: STRAVA_CLIENT_ID environment variable is not set.');
  process.exit(1);
}

let html = fs.readFileSync('index.html', 'utf8');
html = html.replace("'%%STRAVA_CLIENT_ID%%'", `'${clientId}'`);
fs.writeFileSync('index.html', html);

console.log(`Build complete. Client ID injected.`);
