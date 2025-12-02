import axios from 'axios';
import type { OAuthResponse, ChatRequest, ChatResponse } from '../types/gigachat';

const OAUTH_URL = '/api/oauth';
const CHAT_URL = '/api/chat';

const SYSTEM_PROMPT = `You are a task formulation analyzer and entity extraction specialist. Your task is to analyze the user's task description and ALWAYS return the response EXCLUSIVELY in the following JSON format, without any additional explanations, greetings, or text before or after the JSON.

IMPORTANT: Return ONLY compact, minified JSON without extra blank lines between fields. Format it as a single block:

{
  "createAt": "ACTUAL current time in UTC ISO 8601 format (e.g., 2025-12-02T14:35:22Z)",
  "title": "Task name with key context. Must answer 'What needs to be done?'; Start with a verb in infinitive form; Include important context (e.g., reason for call, document name, specific topic). CRITICAL: The title MUST be in the SAME LANGUAGE as the user's message!",
  "source": "Original user message without modifications",
  "status": "inbox",
  "plannedTime": "Specific date-time in UTC ISO 8601 format when the task should be completed. If no time is specified, return null",
  "priority": "high/medium/low based on the content of the user's message"
}

PROCESSING RULES:

1. createAt: ALWAYS use the ACTUAL CURRENT time in UTC ISO 8601 format. 
   Do NOT use the example time. Generate the real timestamp at the moment of analysis.
   Format: YYYY-MM-DDTHH:MM:SSZ (e.g., if now is December 2, 2025 at 14:35:22 UTC, use "2025-12-02T14:35:22Z")

2. title: Extract the main action and include key context from the message.
   Start with a verb in infinitive form, add important details.
   CRITICAL: The title MUST be in the SAME LANGUAGE as the user's message!
   Examples:
   - "купить молоко в магазине" → title: "Купить молоко"
   - "позвонить Ивану по поводу документов" → title: "Позвонить Ивану по поводу документов"
   - "отправить отчет директору до пятницы" → title: "Отправить отчет директору"
   - "buy milk at the store" → title: "Buy milk"
   - "call John about the contract" → title: "Call John about the contract"

3. source: Copy the original user text without changes

4. status: Always return "inbox"

5. plannedTime: If the text contains date/time references, convert to a specific date-time in UTC ISO 8601 format.
   - For vague time references, choose a random time within the appropriate range:
     * "утром" / "morning" → select time between 09:00-11:00 (e.g., 09:30:00Z, 10:15:00Z)
     * "после обеда" / "afternoon" → select time between 13:00-15:00 (e.g., 13:45:00Z, 14:20:00Z)
     * "вечером" / "evening" → select time between 16:00-18:00 (e.g., 16:30:00Z, 17:15:00Z)
   - For specific times ("at 15:00", "by Friday"), convert to exact UTC date-time
   - If no time is specified, return null
   - Always return in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ

6. priority:

   - high: if words like "urgent", "important", "immediately", "ASAP", "critical" are present, 
     OR if the task is overdue (plannedTime is in the past relative to current time),
     OR if the message mentions that something should have been done earlier 
     (phrases like "обещал на прошлой неделе", "должен был", "promised last week", "should have done", "was supposed to")

   - medium: if words like "preferably", "would be nice", "when possible", moderate importance

   - low: in all other cases

REMINDER: The "title" field MUST be written in the exact same language as the user's original message. If the user writes in Russian, the title must be in Russian. If the user writes in English, the title must be in English. Do NOT translate the title to English!

CRITICAL: Your response must be valid JSON, ready for parsing. No other output.`;

interface TokenCache {
  access_token: string;
  expires_at: number;
  refreshTimer?: ReturnType<typeof setTimeout>;
}

let tokenCache: TokenCache | null = null;

/**
 * Получение access_token с кешированием и автоматическим обновлением
 */
async function getAccessToken(): Promise<string> {
  const authToken = import.meta.env.VITE_AUTH_TOKEN;
  const scope = import.meta.env.VITE_SCOPE;

  if (!authToken || !scope) {
    throw new Error('VITE_AUTH_TOKEN и VITE_SCOPE должны быть установлены в переменных окружения');
  }

  // Проверяем, есть ли валидный токен в кеше
  if (tokenCache && tokenCache.expires_at > Date.now() + 5 * 60 * 1000) {
    return tokenCache.access_token;
  }

  // Получаем новый токен
  try {
    console.log('Requesting token with scope:', scope);
    
    const response = await axios.post<OAuthResponse>(
      OAUTH_URL,
      `scope=${encodeURIComponent(scope)}`,
      {
        headers: {
          'Authorization': `Basic ${authToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'RqUID': crypto.randomUUID(),
        },
      }
    );
    
    console.log('Token received:', response.data);

    const { access_token, expires_at } = response.data;

    // Очищаем предыдущий таймер, если есть
    if (tokenCache?.refreshTimer) {
      clearTimeout(tokenCache.refreshTimer);
    }

    // Сохраняем токен в кеш
    tokenCache = {
      access_token,
      expires_at,
    };

    // Устанавливаем таймер для обновления токена за 5 минут до истечения
    const timeUntilRefresh = expires_at - Date.now() - 5 * 60 * 1000;
    if (timeUntilRefresh > 0) {
      tokenCache.refreshTimer = setTimeout(() => {
        // Очищаем кеш, чтобы при следующем запросе получить новый токен
        tokenCache = null;
      }, timeUntilRefresh);
    }

    return access_token;
  } catch (error) {
    console.error('Ошибка при получении access_token:', error);
    throw error;
  }
}

/**
 * Отправка сообщения в GigaChat API
 */
export async function sendMessage(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): Promise<string> {
  const accessToken = await getAccessToken();

  const requestBody: ChatRequest = {
    model: 'GigaChat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ],
  };

  try {
    const response = await axios.post<ChatResponse>(
      CHAT_URL,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content;
    }

    throw new Error('Пустой ответ от API');
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    throw error;
  }
}

