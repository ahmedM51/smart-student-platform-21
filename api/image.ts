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
    const prompt: unknown = body.prompt;
    const imageBase64: unknown = body.imageBase64;
    const imageMimeType: unknown = body.imageMimeType;
    const aspectRatio: unknown = body.aspectRatio;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const ai = new GoogleGenAI({ apiKey });

    const parts: any[] = [];
    if (typeof imageBase64 === 'string' && imageBase64.trim()) {
      parts.push({
        inlineData: {
          data: imageBase64,
          mimeType: typeof imageMimeType === 'string' && imageMimeType ? imageMimeType : 'image/png',
        },
      });
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: typeof aspectRatio === 'string' && aspectRatio ? aspectRatio : '1:1',
        },
      },
    });

    const responseParts = response.candidates?.[0]?.content?.parts;
    const inlineData = Array.isArray(responseParts)
      ? responseParts
          .map((p: any) => p?.inlineData)
          .find((d: any) => d && typeof d.data === 'string')
      : undefined;

    if (!inlineData || typeof inlineData.data !== 'string') {
      return res.status(500).json({ error: 'No image returned' });
    }

    return res.status(200).json({
      imageDataUrl: `data:image/png;base64,${inlineData.data}`,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Image generation failed' });
  }
}
