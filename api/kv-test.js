export default async function handler(req, res) {
  // Log all env vars that start with UPSTASH or KV to debug
  const envDebug = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.includes('UPSTASH') || k.includes('KV') || k.includes('REDIS')) {
      envDebug[k] = v ? v.slice(0, 20) + '...' : 'EMPTY';
    }
  }

  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ error: 'Missing vars', envDebug });
  }

  try {
    const r = await fetch(`${url}/set/test/hello`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await r.json();
    return res.status(200).json({ success: true, result: d, envDebug });
  } catch(e) {
    return res.status(500).json({ error: e.message, envDebug });
  }
}
