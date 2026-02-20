// api/athlete-sync.js
// Saves athlete profile + recent activities to Upstash KV
// Called by athlete app after Strava OAuth

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  async function kvSet(key, value) {
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    return r.json();
  }

  async function kvGet(key) {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
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
    if (req.method === 'POST') {
      // Save athlete data
      const { athlete, activities, accessToken } = req.body;
      if (!athlete || !athlete.id) return res.status(400).json({ error: 'Missing athlete' });

      const athleteKey = `athlete:${athlete.id}`;
      const payload = {
        id: athlete.id,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
        profile: athlete.profile,
        city: athlete.city,
        country: athlete.country,
        lastSync: new Date().toISOString(),
        activities: (activities || []).slice(0, 100), // store last 100 runs
      };

      await kvSet(athleteKey, payload);

      // Also store in athlete index for coach to list all athletes
      const indexKey = `athlete-index:${athlete.id}`;
      await kvSet(indexKey, {
        id: athlete.id,
        name: `${athlete.firstname} ${athlete.lastname}`,
        lastSync: payload.lastSync,
        runCount: payload.activities.length
      });

      return res.status(200).json({ success: true, athleteId: athlete.id });
    }

    if (req.method === 'GET') {
      const { athleteId } = req.query;

      if (athleteId) {
        // Get specific athlete
        const data = await kvGet(`athlete:${athleteId}`);
        if (!data) return res.status(404).json({ error: 'Athlete not found' });
        return res.status(200).json(JSON.parse(data));
      } else {
        // List all athletes (for coach portal)
        const keys = await kvKeys('athlete-index:*');
        const athletes = await Promise.all(
          keys.map(async k => {
            const d = await kvGet(k);
            return d ? JSON.parse(d) : null;
          })
        );
        return res.status(200).json(athletes.filter(Boolean));
      }
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('athlete-sync error:', err);
    res.status(500).json({ error: err.message });
  }
}
