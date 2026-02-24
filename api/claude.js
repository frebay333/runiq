// api/claude.js — v0.6.9.3
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

  function buildMemoryBlock(mem, cutoffMs) {
    if (!mem || mem.empty) return '';
    const lines = [];
    const withinCutoff = item => {
      if (!cutoffMs) return true;
      const t = item && item.date ? new Date(item.date).getTime() : NaN;
      return Number.isFinite(t) ? t <= cutoffMs : true;
    };
    const fieldUpdatedMs = key => {
      const d = mem.fieldUpdated && mem.fieldUpdated[key] ? new Date(mem.fieldUpdated[key]).getTime() : NaN;
      return Number.isFinite(d) ? d : null;
    };
    const includeUndated = key => {
      if (!cutoffMs) return true;
      const t = fieldUpdatedMs(key);
      if (t !== null) return t <= cutoffMs;
      const lu = mem.lastUpdated ? new Date(mem.lastUpdated).getTime() : NaN;
      return Number.isFinite(lu) ? lu <= cutoffMs : false;
    };
    if (mem.goal && includeUndated('goal')) lines.push(`ATHLETE GOAL: ${mem.goal}`);
    if (mem.targetRace && includeUndated('targetRace')) lines.push(`TARGET RACE: ${mem.targetRace}${mem.targetDate ? ' on ' + mem.targetDate : ''}`);
    if (mem.athletePreferences && includeUndated('athletePreferences')) lines.push(`ATHLETE NOTES: ${mem.athletePreferences}`);
    if (mem.injuryHistory && mem.injuryHistory.length) {
      let injuries = mem.injuryHistory;
      if (cutoffMs) {
        if (Array.isArray(mem.injuryHistoryMeta) && mem.injuryHistoryMeta.length) {
          injuries = mem.injuryHistoryMeta
            .filter(withinCutoff)
            .map(x => x.injury)
            .filter(Boolean);
        } else if (!includeUndated('injuryHistory')) {
          injuries = [];
        }
      }
      if (injuries.length) lines.push(`INJURY HISTORY: ${injuries.join(', ')}`);
    }
    if (mem.coachNotes && mem.coachNotes.length) {
      const notes = mem.coachNotes.filter(withinCutoff).slice(-5);
      if (notes.length) {
        lines.push('RECENT COACH NOTES:');
        notes.forEach(n => {
          const d = new Date(n.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          lines.push(`  [${d}] ${n.note}`);
        });
      }
    }
    if (mem.workoutSummaries && mem.workoutSummaries.length) {
      const summaries = mem.workoutSummaries.filter(withinCutoff).slice(-5);
      if (summaries.length) {
        lines.push('RECENT WORKOUT HISTORY:');
        summaries.forEach(s => {
          const d = new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          lines.push(`  [${d}] ${s.workoutName}: ${s.summary}`);
        });
      }
    }
    if (mem.raceEstimates && includeUndated('raceEstimates'))
      lines.push(`RACE ESTIMATES: ${JSON.stringify(mem.raceEstimates)}`);
    if (!lines.length) return '';
    return `\n\n=== ATHLETE MEMORY ===\n${lines.join('\n')}\n=== END MEMORY ===`;
  }

  try {
    const body = { ...req.body };
    const athleteId = body.athleteId;
    const contextDate = body.contextDate;
    delete body.athleteId;
    delete body.contextDate;

    if (athleteId && KV_URL && KV_TOKEN) {
      const raw = await kvGet(`memory:${athleteId}`);
      if (raw) {
        const mem = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const cutoffMs = contextDate ? new Date(contextDate).getTime() : null;
        const memBlock = buildMemoryBlock(mem, Number.isFinite(cutoffMs) ? cutoffMs : null);
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
