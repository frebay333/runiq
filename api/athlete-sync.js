// api/athlete-sync.js — v0.6.9.1.1
// Saves athlete profile + recent activities to Upstash KV

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured' });
  }

  async function kvSet(key, value) {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    if (!r.ok) throw new Error(`KV set failed: ${r.status}`);
    return r.json();
  }

  async function kvGet(key) {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    let raw = d.result;
    if (!raw) return null;
    // Handle single or double encoding
    let attempts = 0;
    while (typeof raw === 'string' && attempts < 3) {
      try { raw = JSON.parse(raw); attempts++; } catch(e) { return null; }
    }
    // Handle array-wrapped values (old storage format bug)
    if (Array.isArray(raw)) raw = raw[0];
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch(e) { return null; }
    }
    return typeof raw === 'object' && raw !== null ? raw : null;
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
      const { athlete, activities, accessToken } = req.body;
      if (!athlete || !athlete.id) return res.status(400).json({ error: 'Missing athlete' });

      const athleteKey = `athlete:${athlete.id}`;
      const payload = {
        id: athlete.id,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
        name: `${athlete.firstname} ${athlete.lastname}`,
        profile: athlete.profile,
        profile_medium: athlete.profile_medium,
        city: athlete.city,
        country: athlete.country,
        lastSync: new Date().toISOString(),
        activities: (activities || []).slice(0, 100),
      };

      await kvSet(athleteKey, payload);

      // Update athlete index for coach roster
      const indexKey = `athlete-index:${athlete.id}`;
      await kvSet(indexKey, {
        id: athlete.id,
        name: payload.name,
        lastSync: payload.lastSync,
        runCount: payload.activities.length
      });

      return res.status(200).json({ success: true, athleteId: athlete.id });
    }

    if (req.method === 'GET') {
      const { athleteId } = req.query;

      if (athleteId) {
        const data = await kvGet(`athlete:${athleteId}`);
        if (!data) return res.status(404).json({ error: 'Athlete not found' });
        return res.status(200).json(data);
      } else {
        // List all athletes for coach portal
        const keys = await kvKeys('athlete-index:*');
        const athletes = await Promise.all(keys.map(k => kvGet(k)));
        const valid = athletes.filter(a => a && a.id && String(a.id) !== 'undefined');
        return res.status(200).json(valid);
      }
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('athlete-sync error:', err);
    res.status(500).json({ error: err.message });
  }
}
