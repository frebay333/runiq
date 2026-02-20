// api/chat-history.js
// Save and load chat conversations per athlete per workout

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

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
      // Save chat message(s)
      const { athleteId, workoutId, messages } = req.body;
      if (!athleteId || !workoutId) return res.status(400).json({ error: 'Missing athleteId or workoutId' });

      const key = `chat:${athleteId}:${workoutId}`;
      await kvSet(key, {
        athleteId,
        workoutId,
        messages,
        updatedAt: new Date().toISOString()
      });

      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      const { athleteId, workoutId } = req.query;

      if (workoutId) {
        // Get chat for specific workout
        const key = `chat:${athleteId}:${workoutId}`;
        const data = await kvGet(key);
        if (!data) return res.status(404).json({ messages: [] });
        return res.status(200).json(JSON.parse(data));
      } else if (athleteId) {
        // Get all chats for athlete (for coach view)
        const keys = await kvKeys(`chat:${athleteId}:*`);
        const chats = await Promise.all(
          keys.map(async k => {
            const d = await kvGet(k);
            return d ? JSON.parse(d) : null;
          })
        );
        return res.status(200).json(chats.filter(Boolean));
      }
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('chat-history error:', err);
    res.status(500).json({ error: err.message });
  }
}
