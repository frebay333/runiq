// api/chat-history.js — v0.6.9.1.1
// Save and load chat conversations per athlete
// Supports both per-workout keys and a rolling per-athlete timeline

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
    let attempts = 0;
    while (typeof raw === 'string' && attempts < 3) {
      try { raw = JSON.parse(raw); attempts++; } catch(e) { return null; }
    }
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
      const { athleteId, workoutId, messages, action, message } = req.body;
      if (!athleteId) return res.status(400).json({ error: 'Missing athleteId' });

      // Append a single message to the athlete's rolling timeline
      if (action === 'append' && message) {
        const timelineKey = `chat-timeline:${athleteId}`;
        const existing = await kvGet(timelineKey) || { athleteId, messages: [] };
        if (!Array.isArray(existing.messages)) existing.messages = [];
        existing.messages.push(message);
        // Keep last 200 messages
        if (existing.messages.length > 200) existing.messages = existing.messages.slice(-200);
        existing.updatedAt = new Date().toISOString();
        await kvSet(timelineKey, existing);
        return res.status(200).json({ success: true });
      }

      // Save full rolling timeline (single cohesive thread per athlete)
      if (action === 'save_timeline') {
        const timelineKey = `chat-timeline:${athleteId}`;
        const payload = Array.isArray(messages)
          ? { athleteId, messages, updatedAt: new Date().toISOString() }
          : { athleteId, ...(messages || {}), updatedAt: new Date().toISOString() };
        if (!Array.isArray(payload.messages) && Array.isArray(payload.history)) payload.messages = payload.history;
        if (!Array.isArray(payload.messages)) payload.messages = [];
        await kvSet(timelineKey, payload);
        return res.status(200).json({ success: true });
      }

      // Save full chat for a specific workout
      if (!workoutId) return res.status(400).json({ error: 'Missing workoutId' });
      const key = `chat:${athleteId}:${workoutId}`;
      await kvSet(key, { athleteId, workoutId, messages, updatedAt: new Date().toISOString() });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      const { athleteId, workoutId } = req.query;
      if (!athleteId) return res.status(400).json({ error: 'Missing athleteId' });

      if (workoutId) {
        const data = await kvGet(`chat:${athleteId}:${workoutId}`);
        if (!data) return res.status(200).json({ messages: [] });
        return res.status(200).json(data);
      }

      // Return athlete's rolling timeline (for coach messaging tab)
      const timeline = await kvGet(`chat-timeline:${athleteId}`);
      if (timeline) return res.status(200).json(timeline);

      // Fall back to listing all workout chats
      const keys = await kvKeys(`chat:${athleteId}:*`);
      const chats = await Promise.all(keys.map(async k => kvGet(k)));
      const allMessages = chats
        .filter(Boolean)
        .flatMap(c => c.messages || [])
        .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
      return res.status(200).json({ athleteId, messages: allMessages });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('chat-history error:', err);
    res.status(500).json({ error: err.message });
  }
}
