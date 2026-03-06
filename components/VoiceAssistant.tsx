import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, Volume2, Sparkles, Play, Square, Loader2, 
  Upload, Video, Headphones, Download, FileText, 
  X, Image as ImageIcon, Waves, FileAudio, PlayCircle, PauseCircle,
  Radio, Monitor, Info, ShieldAlert, CheckCircle2, Cpu, Film, Beaker,
  History, ArrowRight, Share2
} from 'lucide-react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

// --- Audio & File Helpers ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function audioBufferToMp3(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new (window as any).lamejs.Mp3Encoder(channels, sampleRate, 128);
  const mp3Data: any[] = [];
  const left = buffer.getChannelData(0);
  const leftInt16 = new Int16Array(left.length);
  for (let i = 0; i < left.length; i++) {
    leftInt16[i] = left[i] < 0 ? left[i] * 0x8000 : left[i] * 0x7FFF;
  }
  let mp3buf;
  if (channels === 2) {
    const right = buffer.getChannelData(1);
    const rightInt16 = new Int16Array(right.length);
    for (let i = 0; i < right.length; i++) {
      rightInt16[i] = right[i] < 0 ? right[i] * 0x8000 : right[i] * 0x7FFF;
    }
    mp3buf = mp3encoder.encodeBuffer(leftInt16, rightInt16);
  } else {
    mp3buf = mp3encoder.encodeBuffer(leftInt16);
  }
  if (mp3buf.length > 0) mp3Data.push(mp3buf);
  const endBuf = mp3encoder.flush();
  if (endBuf.length > 0) mp3Data.push(endBuf);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

export const VoiceAssistant: React.FC<{ lang?: 'ar' | 'en' }> = ({ lang = 'ar' }) => {
  const [isLive, setIsLive] = useState(false);
  const [lectureText, setLectureText] = useState('');
  const [fileType, setFileType] = useState<'text' | 'image' | 'pdf' | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoStatus, setVideoStatus] = useState('');
  const [showVideoHelp, setShowVideoHelp] = useState(false);

  const [isAudioSummaryLoading, setIsAudioSummaryLoading] = useState(false);
  const [summaryAudioUrl, setSummaryAudioUrl] = useState<string | null>(null);

  const [lectureDigest, setLectureDigest] = useState<string>('');
  const [isDigestLoading, setIsDigestLoading] = useState(false);

  const platformApiKey =
    (import.meta as any).env?.VITE_GEMINI_LIVE_API_KEY ||
    (import.meta as any).env?.VITE_GEMINI_API_KEY ||
    (import.meta as any).env?.VITE_API_KEY ||
    '';

  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    if (!(window as any).pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      };
      document.head.appendChild(script);
    }
  }, []);

  const stopAllAudio = () => {
    audioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  };

  // --- Begin Defensive Transcript Handlers Patch (TS18048) ---

  // Defensive helper for safely extracting text for user transcript
  function getUserTranscriptText(msg: LiveServerMessage): string | undefined {
    if (
      msg.serverContent &&
      msg.serverContent.inputTranscription &&
      typeof msg.serverContent.inputTranscription.text === "string"
    ) {
      return msg.serverContent.inputTranscription.text;
    }
    return undefined;
  }

  // Defensive helper for safely extracting text for ai transcript
  function getAiTranscriptText(msg: LiveServerMessage): string | undefined {
    if (
      msg.serverContent &&
      msg.serverContent.outputTranscription &&
      typeof msg.serverContent.outputTranscription.text === "string"
    ) {
      return msg.serverContent.outputTranscription.text;
    }
    return undefined;
  }

  // --- End Defensive Transcript Handlers Patch ---

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true);
    setSummaryAudioUrl(null); 
    setVideoUrl(null);
    setLectureDigest('');
    try {
      if (file.type === 'application/pdf') {
        const pdfjs = (window as any).pdfjsLib;
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((it: any) => it.str).join(' ') + '\n';
        }
        setLectureText(text);
        setFileType('pdf');
        setImageData(null);
        buildLectureDigest(text);
      } else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setImageData(ev.target?.result as string);
          setFileType('image');
          setLectureText('');
          setLectureDigest('');
        };
        reader.readAsDataURL(file);
      } else {
        const text = await file.text();
        setLectureText(text);
        setFileType('text');
        setImageData(null);
        buildLectureDigest(text);
      }
      setTranscript(prev => [
        ...prev, 
        { 
          role: 'ai', 
          text: lang === 'ar' 
            ? `تم تحميل "${file.name}"، أنا جاهز لتحويله إلى فيديو شرح أو بودكاست صوتي.` 
            : `"${file.name}" loaded, ready for video or podcast.` 
        }
      ]);
    } catch (err) { alert("خطأ في التحميل"); } finally { setFileLoading(false); }
  };

  const generateAudioSummary = async () => {
    if (!lectureText && !imageData) return alert("يرجى رفع ملف أولاً.");
    setIsAudioSummaryLoading(true);
    setSummaryAudioUrl(null);
    try {
      await ensureDigestForText();
      const src = lectureDigest.trim() ? lectureDigest : lectureText;
      const prompt = imageData 
        ? "أعطني شرحاً صوتياً مفصلاً جداً لهذه الصورة وكأنك معلم يشرح لطلابه بأسلوب قصصي ممتع. اكتب بالعربية فقط."
        : `قم بإنشاء شرح صوتي كامل ومفصل جداً يغطي المحاضرة بالكامل بأسلوب حوار ممتع ومبسط بين 'الدكتور' و 'الطالب'. اكتب بالعربية فقط.
محتوى المحاضرة/ملخصها المنظم:
${src.substring(0, 20000)}`;

      const textRes = await generateText(prompt, { model: 'gemini-3-flash-preview' });
      const summaryText = textRes || "";
      const audioBase64 = await textToSpeech(`اقرأ هذا الشرح بأسلوب تفاعلي: ${summaryText}`, 'Kore');
      if (typeof audioBase64 === "string") {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const audioBuffer = await decodeAudioData(decode(audioBase64), ctx, 24000, 1);
        const mp3Blob = audioBufferToMp3(audioBuffer);
        setSummaryAudioUrl(URL.createObjectURL(mp3Blob));
      }
    } catch (e) { alert("فشل توليد التلخيص الصوتي."); } finally { setIsAudioSummaryLoading(false); }
  };

  const generateSmartVideo = async () => {
    if (!lectureText && !imageData) return alert("يرجى رفع ملف (PDF أو صورة) أولاً ليتمكن الذكاء الاصطناعي من تحليله وتوليد الفيديو.");
    
    // API Key Requirement for Veo
    if (!await (window as any).aistudio.hasSelectedApiKey()) {
      alert("توليد الفيديو يتطلب اختيار مفتاح API مدفوع (Paid) من Google Cloud. سيتم فتح نافذة الاختيار الآن.");
      await (window as any).aistudio.openSelectKey();
      return; 
    }
    
    setIsVideoLoading(true);
    setVideoStatus(lang === 'ar' ? 'جاري استيعاب محتوى ملفك...' : 'Ingesting your file...');
    
    try {
      // Step 1: Analyze content to create a visual prompt
      const ai = new GoogleGenAI({ apiKey: String(platformApiKey).trim() });
      let prompt = imageData 
        ? "Analyze this image and create a highly detailed cinematic prompt for a 5-second educational video explaining its core concept. Describe motion, lighting, and camera work. Respond only with the English prompt."
        : `Summarize the following lecture into a cinematic visual prompt for a 5-second video that explains the main concept visually. Use descriptive artistic language. 
           Content: ${lectureText.substring(0, 2000)}
           Respond only with the English prompt.`;

      const analysisRes = await ai.models.generateContent({ 
        model: 'gemini-3-flash-preview', 
        contents: imageData 
          ? { parts: [{ inlineData: { data: imageData.split(',')[1], mimeType: 'image/jpeg' } }, { text: prompt }] } 
          : { parts: [{ text: prompt }] } 
      });

      const visualPrompt: string = analysisRes.text || "Scientific visualization of " + (lectureText.substring(0, 50) || "lecture");
      setVideoStatus(lang === 'ar' ? 'جاري تصميم المشاهد السينمائية...' : 'Designing cinematic scenes...');

      // Step 2: Generate Video using Veo
      let videoConfig: any = { 
        model: 'veo-3.1-fast-generate-preview', 
        prompt: visualPrompt,
        config: { 
          numberOfVideos: 1, 
          resolution: '720p', 
          aspectRatio: '16:9' 
        } 
      };

      // If user uploaded an image, use it as the starting frame for a "real" connection
      if (imageData) {
        videoConfig.image = {
          imageBytes: imageData.split(',')[1],
          mimeType: 'image/jpeg'
        };
      }

      let operation = await ai.models.generateVideos(videoConfig);

      setVideoStatus(lang === 'ar' ? 'جاري الرندرة الحقيقية (قد يستغرق 3-5 دقائق)...' : 'Rendering real video (takes 3-5 mins)...');

      // Step 3: Wait for operation
      while (!operation.done) {
        await new Promise(r => setTimeout(r, 10000));
        operation = await ai.operations.getVideosOperation({ operation });
      }

      setVideoStatus(lang === 'ar' ? 'تجهيز ملف MP4 للتحميل...' : 'Preparing MP4 for download...');

      const downloadLink: string | undefined = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (typeof downloadLink === "string") {
        const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
        const blob = await response.blob();
        setVideoUrl(URL.createObjectURL(blob));
      }
    } catch (e: any) {
      console.error(e);
      if (typeof e?.message === "string" && e.message.includes("entity was not found")) {
        alert("يرجى اختيار مفتاح API مدفوع مرتبط بمشروع Google Cloud مفعل فيه الفواتير (Billing).");
        await (window as any).aistudio.openSelectKey();
      } else {
        alert("فشل توليد الفيديو. تأكد من استهلاكك للـ Quota أو صلاحية المفتاح.");
      }
    } finally {
      setIsVideoLoading(false);
    }
  };

  const downloadVideo = () => {
    if (!videoUrl) return;
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = `Smart_Lecture_${Date.now()}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const startLiveSession = async () => {
    if (isLive) {
      await stopLiveSession();
      return;
    }

    await ensureDigestForText();
    if (!String(platformApiKey || '').trim()) {
      alert(lang === 'ar'
        ? 'مفتاح المنصة غير مضبوط. أضف VITE_GEMINI_LIVE_API_KEY أو VITE_GEMINI_API_KEY أو VITE_API_KEY.'
        : 'Missing platform API key. Set VITE_GEMINI_LIVE_API_KEY / VITE_GEMINI_API_KEY / VITE_API_KEY.');
      return;
    }

    const ai = new GoogleGenAI({ apiKey: String(platformApiKey).trim() });
    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    audioContextRef.current = outputCtx;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
          setIsLive(true);
          const source = inputCtx.createMediaStreamSource(stream);
          const proc = inputCtx.createScriptProcessor(4096, 1, 1);
          proc.onaudioprocess = (e) => {
            const data = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(data.length);
            for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
            sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
          };
          source.connect(proc);
          proc.connect(inputCtx.destination);
          if (imageData) sessionPromise.then(s => s.sendRealtimeInput({ media: { data: imageData.split(',')[1], mimeType: 'image/jpeg' } }));
        },
        onmessage: async (msg: LiveServerMessage) => {
          // Defensive code: see lint context (TS18048) - we use our safe helpers.
          // Also strictly enforce type for transcript items to have a string `text`
          const modelTurnParts = msg.serverContent?.modelTurn?.parts;
          const audioData = Array.isArray(modelTurnParts) && modelTurnParts[0]?.inlineData?.data;
          const outputCtx = audioContextRef.current;
          if (audioData && outputCtx) {
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
            const buf = await decodeAudioData(decode(audioData), outputCtx, 24000, 1);
            const s = outputCtx.createBufferSource();
            s.buffer = buf; s.connect(outputCtx.destination); s.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buf.duration;
            audioSourcesRef.current.add(s);
            s.onended = () => audioSourcesRef.current.delete(s);
          }
          // Defensive: check user transcription via helper
          const userText = getUserTranscriptText(msg);
          if (typeof userText === "string") {
            setTranscript(p => [
              ...p,
              { role: 'user', text: userText }
            ]);
          }
          // Defensive: check ai transcription via helper
          const aiText = getAiTranscriptText(msg);
          if (typeof aiText === "string") {
            setTranscript(p => [
              ...p,
              { role: 'ai', text: aiText }
            ]);
          }
          if (msg.serverContent && msg.serverContent.interrupted) stopAllAudio();
        },
        onclose: () => setIsLive(false),
        onerror: () => setIsLive(false)
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {}, outputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
        systemInstruction: `ابدأ بالترحيب دائماً: "أهلا بك" ثم عرّف نفسك: "أنا المعلم الذكي".
قواعد اللغة: اكتب وتحدث بالعربية الفصحى دائماً حتى لو كتب المستخدم بالإنجليزية.
قواعد النطاق: ركّز 100% على الملف المرفوع كمصدر وحيد. اشرح المحتوى ثم أجب عن أي سؤال مرتبط بالملف فقط.
إذا كان السؤال خارج محتوى الملف أو لا يمكن استنتاجه من المصدر، قل صراحة أنك لا تستطيع الجزم لأن المعلومة غير موجودة في الملف واطلب من المستخدم رفع جزء إضافي.
قدّم الإجابات على شكل: شرح مختصر ثم نقاط واضحة وخلاصة.

ممنوع استخدام الإنجليزية نهائياً في الإجابة.

المصدر (ملف المستخدم):
${(lectureDigest.trim() ? lectureDigest : lectureText).substring(0, 20000)}`,
      },
    });
    sessionRef.current = await sessionPromise;
  };

  const chunkText = (text: string, chunkSize: number) => {
    const t = String(text || '');
    const out: string[] = [];
    for (let i = 0; i < t.length; i += chunkSize) out.push(t.slice(i, i + chunkSize));
    return out;
  };

  const buildLectureDigest = async (text: string): Promise<string> => {
    const src = String(text || '').trim();
    if (!src) {
      setLectureDigest('');
      return '';
    }

    setIsDigestLoading(true);
    try {
      const chunks = chunkText(src, 6000);
      let digest = '';
      for (let i = 0; i < chunks.length; i++) {
        const part = chunks[i];
        const prompt = `أنت مُلخِّص محاضرات دقيق.
الهدف: بناء ملخص تراكمي شامل للمحاضرة كلها، بالعربية الفصحى فقط.

الملخص الحالي (قد يكون فارغاً):
${digest}

الجزء الجديد رقم ${i + 1} من ${chunks.length}:
${part}

حدّث الملخص ليشمل أهم المفاهيم والتعاريف والقوانين/المعادلات والخطوات والأمثلة إن وجدت.
مخرجاتك يجب أن تكون بالعربية فقط، وبصيغة منظمة:
- عناوين رئيسية
- نقاط أساسية
- مصطلحات وتعريفات
- أسئلة مراجعة قصيرة (5-10) في النهاية`;

        const updated = await generateText(prompt, { model: 'gemini-3-flash-preview' });
        digest = String(updated || '').trim() || digest;
        setLectureDigest(digest);
      }

      return digest;
    } catch {
      // ignore
      return '';
    } finally {
      setIsDigestLoading(false);
    }
  };

  const ensureDigestForText = async () => {
    if (imageData) return;
    const src = String(lectureText || '').trim();
    if (!src) return;
    if (lectureDigest.trim()) return;
    if (src.length <= 20000) return;
    await buildLectureDigest(src);
  };

  return (
    <div className={`flex flex-col min-h-[calc(100dvh-10rem)] h-auto gap-8 animate-in fade-in duration-500 pb-6 ${lang === 'ar' ? 'rtl' : 'ltr'}`}>
      
      {/* Help Modal */}
      {showVideoHelp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-xl animate-in fade-in">
           <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3.5rem] p-10 shadow-2xl relative border border-white/10">
              <button onClick={() => setShowVideoHelp(false)} className="absolute top-8 left-8 text-slate-400 hover:text-rose-500 transition-all"><X size={24} /></button>
              <h3 className="text-3xl font-black mb-6 flex items-center gap-4"><Info className="text-indigo-600" size={32} /> كيف نولد فيديو من ملفاتك؟</h3>
              
              <div className="space-y-8">
                 <div className="flex gap-6 items-start">
                    <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 shrink-0"><FileText size={24} /></div>
                    <div>
                       <h4 className="font-black text-lg">الخطوة الأولى: تحليل المحتوى</h4>
                       <p className="text-slate-500 text-sm leading-relaxed">يستخدم المساعد نموذج Gemini 3 لقراءة نصوصك واستخراج المفاهيم العلمية بدقة لتحويلها لصور متحركة.</p>
                    </div>
                 </div>
                 <div className="flex gap-6 items-start">
                    <div className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center text-purple-600 shrink-0"><Film size={24} /></div>
                    <div>
                       <h4 className="font-black text-lg">الخطوة الثانية: الرندرة السينمائية</h4>
                       <p className="text-slate-500 text-sm leading-relaxed">يرسل النظام "الوصف التعليمي" لنموذج Veo 3.1 الذي يقوم ببناء فيديو MP4 عالي الجودة خصيصاً لمحتواك.</p>
                    </div>
                 </div>
                 <div className="bg-amber-50 dark:bg-amber-900/10 p-6 rounded-3xl border-2 border-dashed border-amber-200">
                    <h4 className="font-black text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2"><ShieldAlert size={18} /> ملاحظات هامة:</h4>
                    <ul className="text-[11px] text-amber-700 dark:text-amber-400 space-y-2 font-bold list-disc pr-4">
                       <li>يجب استخدام مفتاح API من مشروع Google Cloud مفعل فيه نظام الدفع (Paid Tier).</li>
                       <li>النماذج المستخدمة (Veo) تستهلك Quota عالية، لذا قد يستغرق التوليد بضع دقائق.</li>
                       <li>يمكنك متابعة حالة التوليد من شريط التقدم في واجهة الفيديو.</li>
                    </ul>
                    <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-[10px] text-indigo-600 underline block mt-4">رابط تفعيل الدفع في Google Cloud</a>
                 </div>
              </div>
              <button onClick={() => setShowVideoHelp(false)} className="w-full mt-10 py-5 bg-indigo-600 text-white rounded-2xl font-black shadow-xl hover:scale-105 transition-all">جاهز للتوليد الحقيقي</button>
           </div>
        </div>
      )}

      {/* Top Controls Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-8 rounded-[3.5rem] shadow-xl border border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-4">
           <div className="flex items-center gap-6">
              <div className={`w-16 h-16 rounded-[2rem] flex items-center justify-center text-white shadow-2xl ${fileType ? 'bg-emerald-500' : 'bg-indigo-600'}`}>
                 {fileLoading ? <Loader2 className="animate-spin" /> : fileType === 'image' ? <ImageIcon /> : <FileText />}
              </div>
              <div>
                 <h2 className="text-2xl font-black">{lang === 'ar' ? 'المساعد المتعدد الوسائط' : 'Multi-modal Assistant'}</h2>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{fileType ? `${lang === 'ar' ? 'المرجع النشط:' : 'Active Ref:'} ${fileType}` : (lang === 'ar' ? 'ارفع ملفاً للبدء' : 'Upload to start')}</p>
              </div>
           </div>
           <div className="flex gap-3 flex-wrap">
              <label className="p-4 bg-slate-50 dark:bg-slate-800 hover:bg-indigo-600 hover:text-white rounded-2xl cursor-pointer transition-all border dark:border-slate-700">
                 <Upload size={24} /><input type="file" className="hidden" accept=".pdf,.txt,image/*" onChange={handleFileUpload} />
              </label>
              <button onClick={generateAudioSummary} disabled={isAudioSummaryLoading || (!lectureText && !imageData)} className="px-6 py-4 bg-amber-500 text-white rounded-2xl font-black flex items-center gap-2 hover:shadow-lg transition-all disabled:opacity-50">
                {isAudioSummaryLoading ? <Loader2 className="animate-spin" size={20} /> : <Headphones size={20} />}
                {lang === 'ar' ? 'بودكاست الشرح' : 'Audio Podcast'}
              </button>
              <button onClick={generateSmartVideo} className="px-6 py-4 bg-purple-600 text-white rounded-2xl font-black flex items-center gap-2 hover:shadow-lg transition-all">
                <Video size={20} /> {lang === 'ar' ? 'توليد فيديو MP4' : 'Generate MP4'}
              </button>
           </div>
        </div>
        <button onClick={() => isLive ? sessionRef.current?.close() : startLiveSession()} className={`p-8 rounded-[3.5rem] text-white shadow-xl relative overflow-hidden group transition-all ${isLive ? 'bg-rose-500 animate-pulse' : 'bg-indigo-600'}`}>
           <div className="relative z-10 text-right"><h3 className="text-xl font-black mb-2">{isLive ? (lang === 'ar' ? 'جلسة نشطة' : 'Live Now') : (lang === 'ar' ? 'تحدث مع الملف' : 'Talk to File')}</h3><p className="text-xs font-medium opacity-80">{isLive ? (lang === 'ar' ? 'أنا أسمعك...' : 'Listening...') : (lang === 'ar' ? 'مناقشة صوتية للمحتوى' : 'Audio discussion')}</p></div>
           {isLive ? <Waves className="absolute -bottom-4 -left-4 opacity-20" size={120} /> : <Mic className="absolute -bottom-4 -left-4 opacity-20" size={100} />}
        </button>
      </div>

      {/* Audio Download Bar */}
      {summaryAudioUrl && (
        <div className="bg-emerald-50 dark:bg-emerald-900/10 p-6 rounded-[2.5rem] border border-emerald-100 dark:border-emerald-800 flex items-center justify-between gap-4 animate-in slide-in-from-top-4">
           <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-500 text-white rounded-xl flex items-center justify-center shadow-lg"><FileAudio size={24} /></div>
              <div>
                <h4 className="font-black text-emerald-800 dark:text-emerald-200">{lang === 'ar' ? 'البودكاست التعليمي جاهز' : 'Educational Podcast Ready'}</h4>
                <p className="text-[10px] font-bold text-emerald-600">{lang === 'ar' ? 'شرح صوتي مفصل يعتمد على ملفك' : 'Detailed audio based on your file'}</p>
              </div>
           </div>
           <div className="flex items-center gap-4 flex-1 max-w-xl">
              <audio controls src={summaryAudioUrl} className="w-full h-10 accent-emerald-600" />
              <a href={summaryAudioUrl} download={`Podcast_${Date.now()}.mp3`} className="p-3 bg-white dark:bg-slate-800 text-emerald-600 rounded-xl shadow-sm hover:scale-110 transition-all border border-emerald-100"><Download size={20} /></a>
           </div>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Chat Transcript Panel */}
        <div className="lg:col-span-7 flex flex-col bg-white dark:bg-slate-900 rounded-[3.5rem] shadow-2xl border dark:border-slate-800 overflow-hidden relative">
           <div className="flex-1 overflow-y-auto p-10 space-y-6 custom-scrollbar">
              {transcript.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-4">
                  <Radio size={80} className="text-indigo-400 animate-pulse" />
                  <h4 className="text-xl font-black">{lang === 'ar' ? 'المساعد بانتظار أوامرك' : 'Assistant is waiting'}</h4>
                  <p className="text-xs max-w-xs">{lang === 'ar' ? 'ارفع ملفك ثم اختر نوع الشرح (صوتي أو مرئي) لتبدأ المعالجة الحقيقية.' : 'Upload file and choose explanation type.'}</p>
                </div>
              )}
              {transcript.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                   <div className={`max-w-[85%] p-6 rounded-[2.5rem] text-sm font-bold leading-relaxed shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-50 dark:bg-slate-800 dark:text-white rounded-bl-none border border-indigo-50/20'}`}>
                     {m.text}
                   </div>
                </div>
              ))}
           </div>
        </div>

        {/* Video Visualizer Panel */}
        <div className="lg:col-span-5 flex flex-col gap-6 overflow-hidden">
           <div className="flex-1 bg-slate-950 rounded-[3.5rem] p-8 flex flex-col items-center justify-center relative overflow-hidden group border-4 border-indigo-600/20 shadow-2xl shadow-indigo-500/10">
              <button onClick={() => setShowVideoHelp(true)} className="absolute top-8 left-8 p-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl backdrop-blur-md z-20 transition-all"><Info size={20} /></button>
              
              {videoUrl && (
                <button 
                  onClick={downloadVideo}
                  className="absolute bottom-8 right-8 p-4 bg-emerald-600 text-white rounded-2xl shadow-2xl hover:scale-110 transition-all z-30 flex items-center gap-2 animate-in zoom-in"
                >
                  <Download size={20} />
                  <span className="font-black text-xs">{lang === 'ar' ? 'تحميل فيديو MP4' : 'Download MP4'}</span>
                </button>
              )}

              {isVideoLoading ? (
                <div className="text-center space-y-8 z-10 w-full px-10">
                   <div className="relative">
                      <div className="w-28 h-28 border-8 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mx-auto shadow-2xl shadow-indigo-500/30"></div>
                      <Film className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-400 animate-pulse" size={32} />
                   </div>
                   <div className="space-y-4">
                      <p className="text-white font-black text-xl animate-pulse">{videoStatus}</p>
                      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden p-0.5">
                         <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 animate-[loading-bar_10s_ease-in-out_infinite] rounded-full"></div>
                      </div>
                      <div className="flex justify-center gap-4 text-slate-500 text-[9px] font-black uppercase tracking-[0.2em]">
                         <span className="flex items-center gap-1"><Cpu size={10} /> Gemini 3 Analysis</span>
                         <span className="flex items-center gap-1"><Film size={10} /> Veo 3.1 Rendering</span>
                      </div>
                   </div>
                </div>
              ) : videoUrl ? (
                <video src={videoUrl} controls autoPlay loop className="w-full h-full object-cover rounded-[2rem] shadow-2xl" />
              ) : imageData ? (
                <img src={imageData} className="w-full h-full object-contain rounded-[2rem] opacity-60" alt="Preview" />
              ) : (
                <div className="text-center space-y-6 opacity-30">
                   <div className="w-24 h-24 bg-indigo-500/20 rounded-[2rem] flex items-center justify-center mx-auto">
                      <Monitor size={60} className="text-indigo-400" />
                   </div>
                   <div className="space-y-2">
                     <h4 className="text-white text-xl font-black">{lang === 'ar' ? 'مرسم المحاضرات (MP4)' : 'Lecture Visualizer (MP4)'}</h4>
                     <p className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest">{lang === 'ar' ? 'حوّل ملفاتك لمقاطع تعليمية واقعية' : 'Turn files into real clips'}</p>
                   </div>
                </div>
              )}
           </div>

           {/* Content Context Panel */}
           <div className="bg-white dark:bg-slate-900 p-8 rounded-[3.5rem] shadow-xl border dark:border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{lang === 'ar' ? 'محتوى المصدر' : 'Source Content'}</h4>
                {lectureText && <span className="text-[10px] font-black text-emerald-500">{lectureText.length} حرف تم استخراجها</span>}
              </div>
              <div className="w-full h-32 p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-bold overflow-y-auto custom-scrollbar leading-relaxed">
                {lectureText || (lang === 'ar' ? "في انتظار رفع ملف PDF أو كتابة نص..." : "Waiting for file ingest...")}
              </div>
           </div>
        </div>
      </div>
      
      <style>{`
        @keyframes loading-bar {
          0% { width: 0%; transform: translateX(-100%); }
          50% { width: 70%; transform: translateX(0%); }
          100% { width: 100%; transform: translateX(100%); }
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
      `}</style>
    </div>
  );
};
