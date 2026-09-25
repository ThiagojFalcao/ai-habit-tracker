import { GoogleGenAI } from "@google/genai";

let client = null;

export const getClient = () => {
  if (client) return client;
  if (!process.env.GEMINI_API_KEY) return null;
  client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
};

const modelName = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";

export const parseJson = (text) => {
  try {
    return JSON.parse(String(text).replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
};

export const SYSTEM_PROMPTS = {
  weekly: `You are a supportive habit coach. Write a personalised 120-180 word report on the user's last 7 days of habit data. Cover wins, struggles, patterns and encouragement, using the user's actual habit names. Plain prose with line breaks — no markdown headers.`,
  suggest: `You are a habit design expert. Based on the user's goals, most productive time and past struggles, suggest exactly 3 habits. Return ONLY a JSON array of objects with fields: name, description, frequency ("daily" or "weekly"), category (must be exactly one of: Health, Fitness, Learning, Mindfulness, Productivity, Social, Finance, Creative, Other), icon (one emoji), reason (one short sentence). Never invent new categories. No markdown, no code fences.`,
  recovery: `You are a compassionate habit coach. The user broke a streak on one specific habit. Write a warm, empathetic 3-day recovery plan tailored to that habit: open with an encouraging line, then Day 1, Day 2 and Day 3 sections — each with one concrete action — and close with a final line of encouragement. No judgement, no markdown headers.`,
  chat: `You are a habit data analyst. Answer the user's question using ONLY the provided habit data. Cite the user's real habit names, days and percentages; keep every answer grounded in the exact numbers given. Plain prose; markdown emphasis is fine.`,
  morning: `You are a warm, energetic motivational coach. Write a short morning message of 30-60 words mentioning one or two of the user's actual habit names and current streaks. Warm tone, at most one emoji.`,
};

export const FALLBACK_SUGGESTIONS = [
  { name: "5-minute morning stretch", description: "Loosen up before the day starts.", frequency: "daily", category: "Health", icon: "🧘", reason: "Pairs naturally with your existing morning habits and takes almost no willpower." },
  { name: "No screens for the first 30 minutes", description: "Start the morning offline.", frequency: "daily", category: "Mindfulness", icon: "😴", reason: "Helps your meditation habit stick and reduces decision fatigue early in the day." },
  { name: "Weekly long walk", description: "60-90 minutes outdoors on Sunday.", frequency: "weekly", category: "Fitness", icon: "🚶", reason: "Gives you a low-friction movement habit on weekends when your run consistency drops." },
];

const DISABLED_MESSAGE =
  "AI features are disabled right now — add a GEMINI_API_KEY to backend/.env to enable them.";

const PROVIDER_ERROR_MESSAGE =
  "The AI provider is temporarily unavailable (demand spike or free-tier quota). Please try again in a moment.";

export const chatComplete = async (systemPrompt, userMessage, temperature = 0.7) => {
  const ai = getClient();
  if (!ai) return { disabled: true, text: DISABLED_MESSAGE };
  try {
    const response = await ai.models.generateContent({
      model: modelName(),
      contents: userMessage,
      config: { systemInstruction: systemPrompt, temperature },
    });
    return { disabled: false, text: (response.text || "").trim() };
  } catch (err) {
    console.error("[ai] provider error:", err?.message || err);
    return { disabled: true, text: PROVIDER_ERROR_MESSAGE };
  }
};
