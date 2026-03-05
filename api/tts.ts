import { GoogleGenAI, Modality } from '@google/genai';

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
    const text: unknown = body.text;
    const voiceName: unknown = body.voiceName;

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Missing text' });
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: typeof voiceName === 'string' && voiceName ? voiceName : 'Kore',
            },
          },
        },
      },
    });

    const audioBase64: unknown = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (typeof audioBase64 !== 'string' || !audioBase64) {
      return res.status(500).json({ error: 'No audio returned' });
    }

    return res.status(200).json({ audioBase64 });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'TTS failed' });
  }
}
