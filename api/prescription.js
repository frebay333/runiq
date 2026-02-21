// api/prescription.js
// Stores and retrieves weekly prescribed workouts per athlete
// KV key: prescription:{athleteId}:{weekStart}  (weekStart = YYYY-MM-DD Monday)
// KV key: prescription-current:{athleteId}       (pointer to current week's key)

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

  // Get current Monday as YYYY-MM-DD
  function getCurrentMonday() {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d.toISOString().split('T')[0];
  }

  // Get next Monday as YYYY-MM-DD
  function getNextMonday() {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow + 7);
    return d.toISOString().split('T')[0];
  }

  try {
    // ── GET: load prescription ────────────────────────────
    if (req.method === 'GET') {
      const { athleteId, weekStart, current } = req.query;
      if (!athleteId) return res.status(400).json({ error: 'Missing athleteId' });

      if (current === 'true' || !weekStart) {
        // Load current week's prescription
        const currWeek = getCurrentMonday();
        const nextWeek = getNextMonday();

        // Try next week first (what athlete should see), fall back to current
        let raw = await kvGet(`prescription:${athleteId}:${nextWeek}`);
        if (!raw) raw = await kvGet(`prescription:${athleteId}:${currWeek}`);
        if (!raw) return res.status(200).json({ empty: true, weekStart: nextWeek });

        const rx = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return res.status(200).json(rx);
      }

      // Load specific week
      const raw = await kvGet(`prescription:${athleteId}:${weekStart}`);
      if (!raw) return res.status(200).json({ empty: true, weekStart });
      return res.status(200).json(typeof raw === 'string' ? JSON.parse(raw) : raw);
    }

    // ── POST: save/update prescription ───────────────────
    if (req.method === 'POST') {
      const { athleteId, action, prescription } = req.body;
      if (!athleteId) return res.status(400).json({ error: 'Missing athleteId' });

      const weekStart = prescription?.weekStart || getNextMonday();
      const key = `prescription:${athleteId}:${weekStart}`;

      if (action === 'save_draft') {
        const rx = {
          ...prescription,
          athleteId,
          weekStart,
          status: 'draft',
          updatedAt: new Date().toISOString()
        };
        await kvSet(key, JSON.stringify(rx));
        return res.status(200).json({ success: true, weekStart, status: 'draft' });
      }

      if (action === 'approve_push') {
        // Load existing draft
        const raw = await kvGet(key);
        const rx = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : prescription;
        rx.status = 'pushed';
        rx.pushedAt = new Date().toISOString();
        rx.weekStart = weekStart;
        await kvSet(key, JSON.stringify(rx));
        return res.status(200).json({ success: true, weekStart, status: 'pushed' });
      }

      if (action === 'update_completion') {
        // Called by athlete app when a workout is completed
        // data: { day: 'mon', activityId, grade, gradeBreakdown }
        const { day, activityId, grade, gradeBreakdown } = req.body;
        const raw = await kvGet(key);
        if (!raw) return res.status(404).json({ error: 'No prescription found' });
        const rx = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (rx.days && rx.days[day]) {
          rx.days[day].completed = true;
          rx.days[day].activityId = activityId;
          rx.days[day].grade = grade;
          rx.days[day].gradeBreakdown = gradeBreakdown;
          rx.days[day].completedAt = new Date().toISOString();
        }
        await kvSet(key, JSON.stringify(rx));
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('prescription error:', err);
    res.status(500).json({ error: err.message });
  }
}
