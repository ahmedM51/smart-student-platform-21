
import express from 'express';
import cors from 'cors';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/**
 * إعداد MongoDB Atlas
 * ملاحظة: يجب استبدال <db_password> بكلمة المرور الفعلية في إعدادات البيئة
 */
const uri = process.env.MONGODB_URI || "mongodb+srv://ahmedmohamed4336_db_user:<db_password>@cluster0.s1n0ukf.mongodb.net/?appName=Cluster0";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db;

async function connectDB() {
  try {
    await client.connect();
    // سيتم إنشاء قاعدة بيانات باسم smart_student داخل الـ Cluster الخاص بك
    db = client.db("smart_student");
    console.log("✅ متصل بنجاح بـ MongoDB Atlas (Cluster0)");
  } catch (error) {
    console.error("❌ فشل الاتصال بـ MongoDB Atlas:", error);
  }
}
connectDB();

// إعداد Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY });

// --- AI Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: message,
      config: { systemInstruction: "أنت مساعد ذكي لمنصة الطالب الذكي. السياق المتاح: " + (context || "عام") },
    });
    res.json({ text: response.text });
  } catch (error) {
    res.status(500).json({ error: "فشل AI" });
  }
});

// --- Data Endpoints (MongoDB) ---

app.get('/api/data', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'قاعدة البيانات غير متصلة بعد' });
    }
    const profile = await db.collection('profiles').findOne({});
    const subjects = await db.collection('subjects').find({}).toArray();
    const tasks = await db.collection('tasks').find({}).toArray();
    const notes = await db.collection('notes').find({}).toArray();
    res.json({ user: profile, subjects, tasks, notes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/user', async (req, res) => {
  const { id, email, full_name, xp } = req.body;
  await db.collection('profiles').updateOne(
    { id },
    { $set: { email, full_name, xp } },
    { upsert: true }
  );
  res.json({ success: true });
});

app.post('/api/subjects', async (req, res) => {
  const subjects = req.body;
  await db.collection('subjects').deleteMany({});
  if (subjects.length > 0) {
    await db.collection('subjects').insertMany(subjects);
  }
  res.json({ success: true });
});

app.post('/api/tasks', async (req, res) => {
  const tasks = req.body;
  await db.collection('tasks').deleteMany({});
  if (tasks.length > 0) {
    await db.collection('tasks').insertMany(tasks);
  }
  res.json({ success: true });
});

app.post('/api/notes', async (req, res) => {
  const notes = req.body;
  await db.collection('notes').deleteMany({});
  if (notes.length > 0) {
    await db.collection('notes').insertMany(notes);
  }
  res.json({ success: true });
});

// Quizzes
app.post('/api/quizzes', async (req, res) => {
  const quiz = req.body;
  await db.collection('quizzes').updateOne({ id: quiz.id }, { $set: quiz }, { upsert: true });
  res.json({ success: true });
});

app.get('/api/quizzes/:id', async (req, res) => {
  const quiz = await db.collection('quizzes').findOne({ id: req.params.id });
  res.json(quiz);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 خادم المنصة يعمل على المنفذ ${PORT}`);
});
