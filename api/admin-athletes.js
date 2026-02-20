// api/admin-athletes.js
// Shows who is currently connected to the Strava app
// GET /api/admin-athletes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
  const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  try {
    // Get all athlete-index keys from KV
    let kvAthletes = [];
    if (KV_URL && KV_TOKEN) {
      const r = await fetch(`${KV_URL}/keys/${encodeURIComponent('athlete-index:*')}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const keys = (await r.json()).result || [];
      kvAthletes = await Promise.all(keys.map(async k => {
        const d = await fetch(`${KV_URL}/get/${encodeURIComponent(k)}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
        const val = (await d.json()).result;
        return val ? JSON.parse(val) : null;
      }));
      kvAthletes = kvAthletes.filter(Boolean);
    }

    return res.status(200).json({
      strava: {
        clientId: CLIENT_ID,
        note: 'Check strava.com/settings/api for connected athlete count'
      },
      kvAthletes,
      message: kvAthletes.length 
        ? `${kvAthletes.length} athlete(s) synced to KV database`
        : 'No athletes in KV yet — they need to connect via Strava first'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
