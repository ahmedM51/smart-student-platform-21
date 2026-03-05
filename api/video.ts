export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  return res.status(501).json({
    error: 'Video generation is not supported on this deployment target. Use a dedicated long-running backend for Veo operations.',
  });
}
