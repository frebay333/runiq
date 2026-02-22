// api/prescription.js — v0.6.9.1.1
// Stores and retrieves weekly prescribed workouts per athlete
// KV key: prescription:{athleteId}:{weekStart}  (weekStart = YYYY-MM-DD Monday)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured', details: 'Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN env vars' });
  }

  // Store object as JSON string in KV — single encode only
  async function kvSet(key, value) {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const result = await r.json();
    if (!r.ok) throw new Error(`KV set failed: ${JSON.stringify(result)}`);
    return result;
  }

  // Always returns a parsed object regardless of how Upstash returns it
  async function kvGet(key) {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    let raw = d.result;
    if (!raw) return null;
    // Handle single or double encoding - keep parsing until we get an object
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

  function getCurrentMonday() {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    d.setHours(0,0,0,0);
    return d.toISOString().split('T')[0];
  }

  function getNextMonday() {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow + 7);
    d.setHours(0,0,0,0);
    return d.toISOString().split('T')[0];
  }

  try {
    // ── GET: load prescription ────────────────────────────
    if (req.method === 'GET') {
      const { athleteId, weekStart, current } = req.query;
      if (!athleteId) return res.status(400).json({ error: 'Missing athleteId' });

      if (current === 'true' || !weekStart) {
        const currWeek = getCurrentMonday();
        const nextWeek = getNextMonday();
        let rx = await kvGet(`prescription:${athleteId}:${nextWeek}`);
        if (!rx) rx = await kvGet(`prescription:${athleteId}:${currWeek}`);
        if (!rx) return res.status(200).json({ empty: true, weekStart: nextWeek });
        return res.status(200).json(rx);
      }

      const rx = await kvGet(`prescription:${athleteId}:${weekStart}`);
      if (!rx) return res.status(200).json({ empty: true, weekStart });
      return res.status(200).json(rx);
    }

    // ── POST: save/update prescription ───────────────────
    if (req.method === 'POST') {
      const { athleteId, action, prescription } = req.body;
      if (!athleteId) return res.status(400).json({ error: 'Missing athleteId' });
      if (!action) return res.status(400).json({ error: 'Missing action' });

      const weekStart = prescription?.weekStart || getNextMonday();
      const key = `prescription:${athleteId}:${weekStart}`;

      if (action === 'save_draft') {
        const rx = { ...prescription, athleteId, weekStart, status: 'draft', updatedAt: new Date().toISOString() };
        await kvSet(key, rx);
        return res.status(200).json({ success: true, weekStart, status: 'draft' });
      }

      if (action === 'approve_push') {
        // Load existing draft, merge with incoming prescription data, mark as pushed
        const existing = await kvGet(key);
        const rx = existing ? { ...existing, ...prescription } : { ...prescription };
        rx.athleteId = athleteId;
        rx.weekStart = weekStart;
        rx.status = 'pushed';
        rx.pushedAt = new Date().toISOString();
        await kvSet(key, rx);
        return res.status(200).json({ success: true, weekStart, status: 'pushed' });
      }

      if (action === 'update_completion') {
        const { day, activityId, grade, gradeBreakdown } = req.body;
        const rx = await kvGet(key);
        if (!rx) return res.status(404).json({ error: 'No prescription found' });
        if (rx.days && rx.days[day]) {
          rx.days[day].completed = true;
          rx.days[day].activityId = activityId;
          rx.days[day].grade = grade;
          rx.days[day].gradeBreakdown = gradeBreakdown;
          rx.days[day].completedAt = new Date().toISOString();
        }
        await kvSet(key, rx);
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action: ' + action });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('prescription error:', err);
    res.status(500).json({ error: err.message, details: err.stack?.split('\n')[1] || '' });
  }
}
