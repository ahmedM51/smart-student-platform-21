import { GoogleGenAI } from '@google/genai';

type Part = { text?: string; inlineData?: { data: string; mimeType: string } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isTransientGeminiError = (e: any) => {
  const msg = String(e?.message || e?.error?.message || '');
  const status = String(e?.status || e?.error?.status || '');
  const code = String(e?.code || e?.error?.code || '');
  return (
    msg.includes('high demand') ||
    msg.includes('UNAVAILABLE') ||
    status === 'UNAVAILABLE' ||
    code === '503' ||
    msg.includes('503')
  );
};

const getHttpStatusFromGeminiError = (e: any) => {
  const msg = String(e?.message || '');
  if (msg.includes('Missing GEMINI_API_KEY')) return 500;
  if (msg.toLowerCase().includes('method not allowed')) return 405;
  if (isTransientGeminiError(e)) return 503;
  return 500;
};

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

    const maxAttempts = 3;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: finalModel,
          contents: { parts: finalParts },
          config: Object.keys(config).length ? config : undefined,
        });

        return res.status(200).json({ text: response.text || '' });
      } catch (e: any) {
        lastErr = e;
        if (attempt < maxAttempts && isTransientGeminiError(e)) {
          const backoffMs = 400 * Math.pow(2, attempt - 1);
          await sleep(backoffMs);
          continue;
        }
        break;
      }
    }
  } catch (e: any) {
    const status = getHttpStatusFromGeminiError(e);
    return res.status(status).json({ error: e?.message || 'Generate failed' });
  }
}
