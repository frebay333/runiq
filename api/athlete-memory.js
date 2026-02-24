// api/athlete-memory.js — v0.6.9.3
// Stores and retrieves long-term coaching memory per athlete

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

  const { athleteId } = req.method === 'GET' ? req.query : req.body;
  if (!athleteId) return res.status(400).json({ error: 'Missing athleteId' });

  const key = `memory:${athleteId}`;

  const emptyMem = () => ({
    athleteId,
    goal: '',
    targetRace: '',
    targetDate: '',
    goalTime: '',
    raceDist: '',
    raceEstimates: null,
    injuryHistory: [],
    injuryHistoryMeta: [],
    coachNotes: [],
    workoutSummaries: [],
    athletePreferences: '',
    fieldUpdated: {},
    lastUpdated: new Date().toISOString()
  });

  try {
    if (req.method === 'GET') {
      const mem = await kvGet(key);
      if (!mem) return res.status(200).json({ ...emptyMem(), empty: true });
      return res.status(200).json(mem);
    }

    if (req.method === 'POST') {
      const { action, data } = req.body;

      const mem = (await kvGet(key)) || emptyMem();
      // Ensure arrays exist (defensive)
      if (!Array.isArray(mem.coachNotes)) mem.coachNotes = [];
      if (!Array.isArray(mem.workoutSummaries)) mem.workoutSummaries = [];
      if (!Array.isArray(mem.injuryHistory)) mem.injuryHistory = [];
      if (!Array.isArray(mem.injuryHistoryMeta)) mem.injuryHistoryMeta = [];
      if (!mem.fieldUpdated || typeof mem.fieldUpdated !== 'object') mem.fieldUpdated = {};
      const nowIso = new Date().toISOString();

      if (action === 'set_goal') {
        if (data.goal !== undefined) mem.goal = data.goal;
        if (data.targetRace !== undefined) mem.targetRace = data.targetRace;
        if (data.targetDate !== undefined) mem.targetDate = data.targetDate;
        if (data.goalTime !== undefined) mem.goalTime = data.goalTime;
        if (data.raceDist !== undefined) mem.raceDist = data.raceDist;
        if (data.athletePreferences !== undefined) mem.athletePreferences = data.athletePreferences;
        if (data.goal !== undefined) mem.fieldUpdated.goal = nowIso;
        if (data.targetRace !== undefined) mem.fieldUpdated.targetRace = nowIso;
        if (data.targetDate !== undefined) mem.fieldUpdated.targetDate = nowIso;
        if (data.goalTime !== undefined) mem.fieldUpdated.goalTime = nowIso;
        if (data.raceDist !== undefined) mem.fieldUpdated.raceDist = nowIso;
        if (data.athletePreferences !== undefined) mem.fieldUpdated.athletePreferences = nowIso;
      }
      else if (action === 'add_note') {
        // Support key/value fields (e.g. marathonEstimate)
        if (data.key && data.value !== undefined) {
          mem[data.key] = data.value;
          mem.fieldUpdated[data.key] = nowIso;
        } else {
          mem.coachNotes.push({
            date: new Date().toISOString(),
            note: data.note,
            author: data.author || 'Coach'
          });
          if (mem.coachNotes.length > 50) mem.coachNotes = mem.coachNotes.slice(-50);
        }
      }
      else if (action === 'delete_note') {
        mem.coachNotes = mem.coachNotes.filter((_, i) => i !== data.index);
      }
      else if (action === 'add_injury') {
        if (data.injury && !mem.injuryHistory.includes(data.injury)) {
          mem.injuryHistory.push(data.injury);
          mem.injuryHistoryMeta.push({ injury: data.injury, date: nowIso });
          mem.fieldUpdated.injuryHistory = nowIso;
        }
      }
      else if (action === 'remove_injury') {
        mem.injuryHistory = mem.injuryHistory.filter(x => x !== data.injury);
        mem.injuryHistoryMeta = mem.injuryHistoryMeta.filter(x => x.injury !== data.injury);
        mem.fieldUpdated.injuryHistory = nowIso;
      }
      else if (action === 'add_workout_summary') {
        mem.workoutSummaries.push({
          date: new Date().toISOString(),
          workoutId: data.workoutId,
          workoutName: data.workoutName,
          summary: data.summary
        });
        if (mem.workoutSummaries.length > 20) mem.workoutSummaries = mem.workoutSummaries.slice(-20);
      }
      else if (action === 'full_update') {
        Object.assign(mem, data);
        Object.keys(data || {}).forEach(k => { mem.fieldUpdated[k] = nowIso; });
      }
      else {
        return res.status(400).json({ error: 'Unknown action: ' + action });
      }

      mem.lastUpdated = new Date().toISOString();
      await kvSet(key, mem);
      return res.status(200).json({ success: true, memory: mem });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('athlete-memory error:', err);
    res.status(500).json({ error: err.message });
  }
}
