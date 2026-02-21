// api/claude.js
// Proxies requests to Anthropic API — auto-injects athlete memory into every system prompt

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  async function kvGet(key) {
    try {
      const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const d = await r.json();
      return d.result;
    } catch { return null; }
  }

  function buildMemoryBlock(mem) {
    if (!mem || mem.empty) return '';
    const lines = [];
    if (mem.goal) lines.push(`ATHLETE GOAL: ${mem.goal}`);
    if (mem.targetRace) lines.push(`TARGET RACE: ${mem.targetRace}${mem.targetDate ? ' on ' + mem.targetDate : ''}`);
    if (mem.athletePreferences) lines.push(`ATHLETE NOTES: ${mem.athletePreferences}`);
    if (mem.injuryHistory && mem.injuryHistory.length)
      lines.push(`INJURY HISTORY: ${mem.injuryHistory.join(', ')}`);
    if (mem.coachNotes && mem.coachNotes.length) {
      lines.push('RECENT COACH NOTES:');
      mem.coachNotes.slice(-5).forEach(n => {
        const d = new Date(n.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        lines.push(`  [${d}] ${n.note}`);
      });
    }
    if (mem.workoutSummaries && mem.workoutSummaries.length) {
      lines.push('RECENT WORKOUT HISTORY:');
      mem.workoutSummaries.slice(-5).forEach(s => {
        const d = new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        lines.push(`  [${d}] ${s.workoutName}: ${s.summary}`);
      });
    }
    if (!lines.length) return '';
    return `\n\n=== ATHLETE MEMORY ===\n${lines.join('\n')}\n=== END MEMORY ===`;
  }

  try {
    const body = { ...req.body };
    const athleteId = body.athleteId;
    delete body.athleteId;

    if (athleteId && KV_URL && KV_TOKEN) {
      const raw = await kvGet(`memory:${athleteId}`);
      if (raw) {
        const mem = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const memBlock = buildMemoryBlock(mem);
        if (memBlock && body.system) body.system = body.system + memBlock;
      }
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('Claude proxy error:', err);
    return res.status(500).json({ error: 'Proxy error: ' + err.message });
  }
}
