import { GoogleGenAI } from '@google/genai';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const audioBase64: unknown = body.audioBase64;
    const audioMimeType: unknown = body.audioMimeType;
    const prompt: unknown = body.prompt;
    const responseMimeType: unknown = body.responseMimeType;

    if (typeof audioBase64 !== 'string' || !audioBase64.trim()) {
      return res.status(400).json({ error: 'Missing audioBase64' });
    }

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: audioBase64,
              mimeType: typeof audioMimeType === 'string' && audioMimeType ? audioMimeType : 'audio/webm',
            },
          },
          { text: prompt },
        ],
      },
      config:
        typeof responseMimeType === 'string' && responseMimeType
          ? { responseMimeType }
          : undefined,
    });

    return res.status(200).json({ text: response.text || '' });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Audio request failed' });
  }
}
