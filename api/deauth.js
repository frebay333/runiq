// api/deauth.js
// Deauthorizes a connected Strava athlete using their stored token
// POST /api/deauth  body: { athleteId } or empty to deauth all

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
  const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured' });
  }

  async function kvGet(key) {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  }

  async function kvKeys(pattern) {
    const r = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    return d.result || [];
  }

  async function kvDel(key) {
    await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
  }

  async function getRefreshedToken(tokenData) {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: tokenData.refresh_token,
        grant_type: 'refresh_token'
      })
    });
    const data = await r.json();
    return data.access_token;
  }

  async function deauthAthlete(tokenData) {
    let accessToken = tokenData.access_token;
    if (tokenData.expires_at < Math.floor(Date.now() / 1000)) {
      accessToken = await getRefreshedToken(tokenData);
    }
    const r = await fetch(`https://www.strava.com/oauth/deauthorize?access_token=${accessToken}`, {
      method: 'POST'
    });
    return r.json();
  }

  try {
    const { athleteId } = req.body || {};

    if (athleteId) {
      const tokenData = await kvGet(`tokens:${athleteId}`);
      if (!tokenData) return res.status(404).json({ error: 'No token found for athlete' });
      const result = await deauthAthlete(tokenData);
      await kvDel(`tokens:${athleteId}`);
      return res.status(200).json({ success: true, athleteId, name: tokenData.athleteName, result });
    } else {
      const keys = await kvKeys('tokens:*');
      if (!keys.length) return res.status(200).json({ success: true, message: 'No athletes stored in KV yet' });

      const results = await Promise.all(keys.map(async k => {
        const tokenData = await kvGet(k);
        if (!tokenData) return null;
        try {
          const result = await deauthAthlete(tokenData);
          await kvDel(k);
          return { athleteId: tokenData.athleteId, name: tokenData.athleteName, result };
        } catch(e) {
          return { athleteId: tokenData.athleteId, name: tokenData.athleteName, error: e.message };
        }
      }));

      return res.status(200).json({ success: true, deauthed: results.filter(Boolean) });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
