// api/upload-image-url.js
// Returns a Supabase Storage signed upload URL so the browser can upload
// images directly (avoids Vercel 4.5 MB body limit).
// GET /api/upload-image-url?token=ORDER_TOKEN&filename=image.jpg&type=image%2Fjpeg

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'order-images';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token, filename, type } = req.query;
  if (!token || !filename) return res.status(400).json({ error: 'Missing token or filename' });

  // Verify order exists
  const orderRes = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?token=eq.${encodeURIComponent(token)}&select=id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const orders = await orderRes.json();
  if (!orders.length) return res.status(404).json({ error: 'Order not found' });

  const ext = filename.split('.').pop().toLowerCase() || 'jpg';
  const storagePath = `${orders[0].id}/${Date.now()}.${ext}`;

  // Create signed upload URL (valid 60s)
  const signRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${storagePath}`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 60 }),
    }
  );

  if (!signRes.ok) {
    const err = await signRes.text();
    console.error('Signed URL error:', err);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }

  const signData = await signRes.json();

  // Public URL of the resulting file
  const public_url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  return res.json({
    upload_url: `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${storagePath}`,
    signed_url: signData.url,         // full presigned URL for browser PUT
    token: signData.token,
    public_url,
    storage_path: storagePath,
  });
}
