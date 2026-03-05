export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  return res.status(501).json({
    error: 'Live streaming is not supported on Vercel Serverless. Use WebSocket-capable backend (e.g. Cloud Run) for live sessions.',
  });
}
