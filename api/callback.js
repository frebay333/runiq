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

    // Write athlete data to KV immediately on OAuth so coach portal has the record
    const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
    const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (KV_URL && KV_TOKEN && data.athlete) {
      const aid  = data.athlete.id;
      const name = `${data.athlete.firstname} ${data.athlete.lastname}`;
      const now  = new Date().toISOString();

      const kvSet = async (key, value) => {
        const payload = typeof value === 'string' ? value : JSON.stringify(value);
        await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      };

      // Write full athlete record (fetched by coach portal per-athlete lookup)
      const athleteRecord = {
        id: aid,
        firstname: data.athlete.firstname,
        lastname:  data.athlete.lastname,
        name,
        profile:        data.athlete.profile,
        profile_medium: data.athlete.profile_medium,
        city:    data.athlete.city,
        country: data.athlete.country,
        lastSync: now,
        activities: []   // will be filled in by syncAthleteToKV from frontend
      };

      // Write athlete-index record (used by coach roster list)
      const indexRecord = {
        id: aid,
        name,
        lastSync: now,
        runCount: 0
      };

      // Write tokens
      const tokenRecord = {
        athleteId: aid, athleteName: name,
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    data.expires_at,
        connectedAt:   now
      };

      await Promise.all([
        kvSet(`athlete:${aid}`,       athleteRecord),
        kvSet(`athlete-index:${aid}`, indexRecord),
        kvSet(`tokens:${aid}`,        tokenRecord),
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
