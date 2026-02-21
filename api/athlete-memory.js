// api/athlete-memory.js
// Stores and retrieves long-term coaching memory per athlete
// Memory structure:
//   goal: string (race goal)
//   targetRace: string
//   targetDate: string
//   injuryHistory: string[]
//   coachNotes: { date, note, author }[]
//   workoutSummaries: { date, workoutId, summary }[]  (last 20)
//   athletePreferences: string  (free text — coach-editable)
//   lastUpdated: ISO string

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

  const { athleteId } = req.method === 'GET' ? req.query : req.body;
  if (!athleteId) return res.status(400).json({ error: 'Missing athleteId' });

  const key = `memory:${athleteId}`;

  try {
    // ── GET: load memory ──────────────────────────────────────
    if (req.method === 'GET') {
      const raw = await kvGet(key);
      if (!raw) return res.status(200).json({ athleteId, empty: true, coachNotes: [], workoutSummaries: [], injuryHistory: [] });
      const mem = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return res.status(200).json(mem);
    }

    // ── POST: update memory ───────────────────────────────────
    if (req.method === 'POST') {
      const { action, data } = req.body;

      // Load existing
      const raw = await kvGet(key);
      const mem = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {
        athleteId,
        goal: '',
        targetRace: '',
        targetDate: '',
        injuryHistory: [],
        coachNotes: [],
        workoutSummaries: [],
        athletePreferences: '',
        lastUpdated: new Date().toISOString()
      };

      if (action === 'set_goal') {
        // Coach sets athlete goal info
        mem.goal = data.goal || mem.goal;
        mem.targetRace = data.targetRace || mem.targetRace;
        mem.targetDate = data.targetDate || mem.targetDate;
        mem.athletePreferences = data.athletePreferences !== undefined ? data.athletePreferences : mem.athletePreferences;
      }

      else if (action === 'add_note') {
        // Coach adds a note
        mem.coachNotes.push({
          date: new Date().toISOString(),
          note: data.note,
          author: data.author || 'Coach'
        });
        // Keep last 50 notes
        if (mem.coachNotes.length > 50) mem.coachNotes = mem.coachNotes.slice(-50);
      }

      else if (action === 'delete_note') {
        mem.coachNotes = mem.coachNotes.filter((_, i) => i !== data.index);
      }

      else if (action === 'add_injury') {
        if (data.injury && !mem.injuryHistory.includes(data.injury)) {
          mem.injuryHistory.push(data.injury);
        }
      }

      else if (action === 'remove_injury') {
        mem.injuryHistory = mem.injuryHistory.filter(x => x !== data.injury);
      }

      else if (action === 'add_workout_summary') {
        // Auto-called after each AI chat session
        mem.workoutSummaries.push({
          date: new Date().toISOString(),
          workoutId: data.workoutId,
          workoutName: data.workoutName,
          summary: data.summary  // 2-3 sentence AI-generated summary
        });
        // Keep last 20 workout summaries
        if (mem.workoutSummaries.length > 20) mem.workoutSummaries = mem.workoutSummaries.slice(-20);
      }

      else if (action === 'full_update') {
        // Full replace from coach portal form
        Object.assign(mem, data);
      }

      mem.lastUpdated = new Date().toISOString();
      await kvSet(key, JSON.stringify(mem));
      return res.status(200).json({ success: true, memory: mem });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('athlete-memory error:', err);
    res.status(500).json({ error: err.message });
  }
}
