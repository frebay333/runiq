// api/callback.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code'
      })
    });

    const data = await response.json();
    if (!response.ok || !data.access_token) {
      return res.status(400).json({ error: data.message || 'Token exchange failed' });
    }

    // Store tokens in Upstash KV using correct REST format: /set/key/value
    const KV_URL   = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;
    if (KV_URL && KV_TOKEN && data.athlete) {
      const aid = data.athlete.id;
      const name = `${data.athlete.firstname} ${data.athlete.lastname}`;

      const tokenVal = encodeURIComponent(JSON.stringify({
        athleteId: aid, athleteName: name,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        connectedAt: new Date().toISOString()
      }));

      const indexVal = encodeURIComponent(JSON.stringify({
        id: aid, name, lastSync: new Date().toISOString(), runCount: 0
      }));

      await Promise.all([
        fetch(`${KV_URL}/set/tokens:${aid}/${tokenVal}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` } }),
        fetch(`${KV_URL}/set/athlete-index:${aid}/${indexVal}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` } })
      ]).catch(e => console.warn('KV store failed:', e));
    }

    return res.status(200).json({
      access_token: data.access_token,
      athlete:      data.athlete,
      expires_at:   data.expires_at,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
