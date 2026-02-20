// api/admin-athletes.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured', KV_URL: !!KV_URL, KV_TOKEN: !!KV_TOKEN });
  }

  async function kvGet(key) {
    const r = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    return d.result;
  }

  async function kvKeys(pattern) {
    const r = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    return d.result || [];
  }

  try {
    const keys = await kvKeys('athlete-index:*');
    console.log('KV keys found:', keys);

    const kvAthletes = await Promise.all(
      keys.map(async k => {
        const val = await kvGet(k);
        if (!val) return null;
        try { return JSON.parse(decodeURIComponent(val)); } 
        catch { return JSON.parse(val); }
      })
    );

    return res.status(200).json({
      strava: { clientId: process.env.STRAVA_CLIENT_ID },
      kvAthletes: kvAthletes.filter(Boolean),
      keysFound: keys,
      message: kvAthletes.length
        ? `${kvAthletes.length} athlete(s) in KV`
        : 'No athletes in KV yet'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
