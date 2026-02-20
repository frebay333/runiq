// api/kv-test.js — tests KV read/write directly
export default async function handler(req, res) {
  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV env vars missing', KV_URL: !!KV_URL, KV_TOKEN: !!KV_TOKEN });
  }

  try {
    // Write test
    const writeRes = await fetch(`${KV_URL}/set/test-key/hello-world`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const writeData = await writeRes.json();

    // Read test
    const readRes = await fetch(`${KV_URL}/get/test-key`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const readData = await readRes.json();

    // Keys test
    const keysRes = await fetch(`${KV_URL}/keys/*`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const keysData = await keysRes.json();

    return res.status(200).json({
      write: writeData,
      read: readData,
      keys: keysData,
      kvUrl: KV_URL.slice(0, 30) + '...'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
