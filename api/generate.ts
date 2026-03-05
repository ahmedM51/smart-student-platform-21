import { GoogleGenAI } from '@google/genai';

type Part = { text?: string; inlineData?: { data: string; mimeType: string } };

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
    const model: unknown = body.model;
    const prompt: unknown = body.prompt;
    const parts: unknown = body.parts;
    const responseMimeType: unknown = body.responseMimeType;
    const temperature: unknown = body.temperature;
    const systemInstruction: unknown = body.systemInstruction;

    const finalModel = typeof model === 'string' && model ? model : 'gemini-3-flash-preview';

    const finalParts: Part[] = Array.isArray(parts)
      ? (parts as any[]).map((p) => ({
          text: typeof p?.text === 'string' ? p.text : undefined,
          inlineData:
            p?.inlineData && typeof p.inlineData.data === 'string'
              ? { data: p.inlineData.data, mimeType: typeof p.inlineData.mimeType === 'string' ? p.inlineData.mimeType : 'application/octet-stream' }
              : undefined,
        }))
      : typeof prompt === 'string'
        ? [{ text: prompt }]
        : [];

    if (!finalParts.length) {
      return res.status(400).json({ error: 'Missing prompt/parts' });
    }

    const ai = new GoogleGenAI({ apiKey });

    const config: any = {};
    if (typeof responseMimeType === 'string' && responseMimeType) config.responseMimeType = responseMimeType;
    if (typeof temperature === 'number') config.temperature = temperature;
    if (typeof systemInstruction === 'string' && systemInstruction) config.systemInstruction = systemInstruction;

    const response = await ai.models.generateContent({
      model: finalModel,
      contents: { parts: finalParts },
      config: Object.keys(config).length ? config : undefined,
    });

    return res.status(200).json({ text: response.text || '' });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Generate failed' });
  }
}
