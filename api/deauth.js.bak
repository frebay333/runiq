// api/deauth.js
// Deauthorizes the currently connected Strava athlete
// POST /api/deauth  (no body needed — uses app credentials)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
  const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Missing Strava credentials' });
  }

  try {
    // First get a fresh token using client credentials
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'client_credentials'
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.status(400).json({ error: 'Could not get token', details: tokenData });
    }

    // Deauthorize using the access token
    const deauthRes = await fetch(`https://www.strava.com/oauth/deauthorize?access_token=${tokenData.access_token}`, {
      method: 'POST'
    });

    const deauthData = await deauthRes.json();
    return res.status(200).json({ success: true, revoked: deauthData });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
