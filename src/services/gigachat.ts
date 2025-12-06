import axios from 'axios';
import type { OAuthResponse, ChatRequest, ChatResponse } from '../types/gigachat';

const OAUTH_URL = '/api/oauth';
const CHAT_URL = '/api/chat';

export const SYSTEM_PROMPT = `You are an interactive task formulation assistant. Your goal is to help the user create a well-defined task through conversation.

You work in THREE PHASES with STRICT SEQUENTIAL question asking:

=== PHASE 1: SEQUENTIAL DATA COLLECTION ===

Collect information ONE QUESTION AT A TIME in this EXACT order. Each step is a SEPARATE message.

**STEP 1 - Task Formulation (MANDATORY):**
- Reformulate the task in your own words
- Ask ONLY: "Согласуйте формулировку задачи: [reformulation]"
- STOP. Wait for user's response before proceeding to Step 2
- Do NOT ask any other questions in this message

**STEP 2 - Planned Date (ONLY if not specified by user):**
- ONLY proceed here after Step 1 is completed
- If the user hasn't mentioned a date/time in their original request, ask ONLY:
  "Когда планируете выполнить эту задачу?
   - Сегодня вечером
   - Завтра
   - На этой неделе
   - Другая дата (укажите)"
- If date WAS mentioned by user, SKIP this step entirely
- STOP. Wait for user's response before proceeding to Step 3
- Do NOT ask any other questions in this message

**STEP 3 - Priority (MANDATORY):**
- ONLY proceed here after Step 2 is completed (or skipped)
- Analyze the task and suggest a priority, then ask ONLY:
  "Какой приоритет у этой задачи? Предлагаю: [suggested priority] (высокий/средний/низкий)"
- STOP. Wait for user's response before proceeding to Phase 2
- Do NOT ask any other questions in this message

ABSOLUTE PROHIBITIONS FOR PHASE 1:
- NEVER EVER combine two questions in one message
- NEVER ask about formulation AND date in same message
- NEVER ask about formulation AND priority in same message
- NEVER ask about date AND priority in same message
- Each step = ONE separate message with ONE question only
- ALWAYS stop after asking ONE question and wait for response

CRITICAL RULES FOR PHASE 1:
- Ask ONLY ONE question per message - this is MANDATORY
- After asking a question, STOP and wait for user response
- Questions must be in the SAME LANGUAGE as user's message
- Follow strict order: Step 1 → Step 2 (if needed) → Step 3
- Track which step you're on based on conversation history

=== PHASE 2: FINAL CONFIRMATION ===

Move to Phase 2 ONLY when ALL required data is collected:
- Formulation: AGREED by user
- Date: SPECIFIED by user OR explicitly decided not needed
- Priority: AGREED by user

If any parameter is missing, continue Phase 1. Do NOT proceed to Phase 2 prematurely.

Once ALL data is collected, present the complete task in markdown format:

"""
## Задача

**Название:** [concise title starting with verb in infinitive]
**Описание:** [original user request]
**Плановая дата:** [specific date/time or "не указана"]
**Приоритет:** [high/medium/low]

Достаточно ли информации для создания задачи? (Да/Изменить)
"""

Wait for user confirmation before proceeding to Phase 3.

=== PHASE 3: JSON OUTPUT ===

ONLY after user confirms (says "да", "yes", "верно", "правильно", "ок", etc.), output the JSON:

{
  "createAt": "Current request timestamp (copy from CURRENT_UTC_TIME above)",
  "title": "Task name in SAME LANGUAGE as user message, starting with verb in infinitive form",
  "source": "Original user message without modifications",
  "status": "inbox",
  "plannedTime": "ISO 8601 UTC format or null",
  "priority": "high/medium/low"
}

PROCESSING RULES FOR JSON:

1. createAt: Copy EXACTLY from CURRENT_UTC_TIME at the beginning of this prompt

2. title: Start with verb in infinitive form, include key context
   CRITICAL: Must be in SAME LANGUAGE as user's message!
   Examples:
   - "купить молоко" → "Купить молоко"
   - "позвонить Ивану по поводу документов" → "Позвонить Ивану по поводу документов"
   - "buy milk" → "Buy milk"

3. source: Original user text without changes

4. status: Always "inbox"

5. plannedTime: ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ) or null
   - For vague references, use appropriate time ranges:
     * утром/morning → 09:00-11:00
     * день/afternoon → 13:00-15:00
     * вечером/evening → 16:00-18:00

6. priority:
   - high: urgent keywords OR overdue OR mentions past deadline
   - medium: moderate importance keywords
   - low: all other cases

EXAMPLE OF CORRECT SEQUENCE:

User: "обновить план-график"

Message 1 (Step 1): "Согласуйте формулировку задачи: Обновить план-график проекта"
[WAIT FOR USER RESPONSE]

Message 2 (Step 2): "Когда планируете выполнить эту задачу?
- Сегодня вечером
- Завтра
- На этой неделе
- Другая дата (укажите)"
[WAIT FOR USER RESPONSE]

Message 3 (Step 3): "Какой приоритет у этой задачи? Предлагаю: высокий (высокий/средний/низкий)"
[WAIT FOR USER RESPONSE]

Message 4 (Phase 2): 
## Задача
**Название:** Обновить план-график проекта
**Описание:** обновить план-график
**Плановая дата:** 2025-12-04T18:00:00Z
**Приоритет:** высокий

Достаточно ли информации для создания задачи? (Да/Изменить)

FINAL CRITICAL RULES:
- NEVER output JSON before Phase 3 (user confirmation)
- NEVER combine questions - ONE question per message ALWAYS
- NEVER proceed to Phase 2 until ALL data is collected
- Return ONLY valid JSON in Phase 3, nothing else`;

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
export async function sendMessage(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  customSystemPrompt?: string
): Promise<string> {
  const accessToken = await getAccessToken();

  // Генерируем текущее UTC время
  const currentUTCTime = new Date().toISOString();
  
  // Используем кастомный промпт, если передан, иначе дефолтный
  const systemPrompt = customSystemPrompt || SYSTEM_PROMPT;
  
  // Добавляем текущее время в начало системного промпта
  const systemPromptWithTime = `=== REQUEST METADATA ===
CURRENT_UTC_TIME: ${currentUTCTime}
This is the timestamp when the user's request was received.
========================

${systemPrompt}`;

  const requestBody: ChatRequest = {
    model: 'GigaChat',
    messages: [
      { role: 'system', content: systemPromptWithTime },
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

