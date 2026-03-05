

export interface AIResponse {
  text: string;
  links?: any[];
}

export interface GenerateOptions {
  model?: string;
  responseMimeType?: string;
  temperature?: number;
  systemInstruction?: string;
}

export type GeneratePart =
  | { text: string }
  | { inlineData: { data: string; mimeType: string } };

export const getAIResponse = async (
  prompt: string, 
  context: string = "عام", 
  useSearch: boolean = false
): Promise<AIResponse> => {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, context, useSearch }),
    });

    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      const msg = typeof data?.error === 'string' ? data.error : 'AI request failed';
      throw new Error(msg);
    }

    return {
      text: data?.text || "عذراً، لم أتمكن من معالجة الطلب حالياً.",
      links: data?.links,
    };
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    const errorStr = error?.message || JSON.stringify(error);
    
    // إذا انتهت الحصة أو هناك مشكلة في المفتاح، نطلب من المستخدم اختيار مفتاح جديد عبر واجهة المنصة
    if (errorStr.includes("429") || errorStr.includes("RESOURCE_EXHAUSTED") || errorStr.includes("not found")) {
      if (typeof window !== 'undefined' && (window as any).aistudio) {
        (window as any).aistudio.openSelectKey();
      }
      return { text: "⚠️ تم استهلاك حصة المفتاح الحالي. جاري محاولة فتح نافذة اختيار مفتاح جديد لمتابعة الدراسة..." };
    }
    
    return { text: "عذراً، واجه المعلم مشكلة تقنية بسيطة. يرجى المحاولة مرة أخرى بعد لحظات." };
  }
};

export const generateText = async (prompt: string, options: GenerateOptions = {}): Promise<string> => {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ...options }),
  });

  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Generate failed');
  return typeof data?.text === 'string' ? data.text : '';
};

export const generateWithParts = async (parts: GeneratePart[], options: GenerateOptions & { prompt?: string } = {}): Promise<string> => {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts, ...options }),
  });

  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Generate failed');
  return typeof data?.text === 'string' ? data.text : '';
};

export const generateFromAudio = async (audioBase64: string, audioMimeType: string, prompt: string, options: GenerateOptions = {}): Promise<string> => {
  const res = await fetch('/api/audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, audioMimeType, prompt, ...options }),
  });

  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Audio request failed');
  return typeof data?.text === 'string' ? data.text : '';
};

export const textToSpeech = async (text: string, voiceName?: string): Promise<string> => {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceName }),
  });

  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'TTS failed');
  if (typeof data?.audioBase64 !== 'string') throw new Error('No audio returned');
  return data.audioBase64;
};

export const generateImage = async (prompt: string, params: { imageBase64?: string; imageMimeType?: string; aspectRatio?: string } = {}): Promise<string> => {
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ...params }),
  });

  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Image failed');
  if (typeof data?.imageDataUrl !== 'string') throw new Error('No image returned');
  return data.imageDataUrl;
};
