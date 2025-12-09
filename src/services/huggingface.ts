import axios from 'axios';
import type { ChatMessage, HuggingFaceModel } from '../types/gigachat';

const HF_API_URL = '/api/huggingface';

/**
 * Маппинг провайдеров для моделей Hugging Face
 * Каждая модель требует определенного провайдера в суффиксе
 */
const MODEL_PROVIDERS: Record<HuggingFaceModel, string> = {
  'deepseek-ai/DeepSeek-V3.2': 'novita',
  'OpenBuddy/openbuddy-llama3.1-8b-v22.3-131k': 'featherless-ai',
  '0xfader/Qwen2.5-0.5B-Instruct-Gensyn-Swarm-sharp_soaring_rooster': 'featherless-ai',
};

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

interface HuggingFaceRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  stream?: boolean;
}

interface HuggingFaceResponse {
  choices: Array<{
    message: {
      content: string;
      role: 'assistant';
    };
    index: number;
    finish_reason: string;
  }>;
  created: number;
  model: string;
  object: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Отправка сообщения в Hugging Face Inference API
 */
export async function sendMessage(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  model: HuggingFaceModel,
  customSystemPrompt?: string,
  temperature: number = 0.87
): Promise<{ content: string; totalTokens?: number }> {
  const apiKey = import.meta.env.VITE_HF_API_KEY;

  if (!apiKey) {
    throw new Error('VITE_HF_API_KEY должна быть установлена в переменных окружения');
  }

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

  // Если передан пустой промпт, не добавляем системное сообщение
  const messagesToSend = customSystemPrompt === '' 
    ? messages 
    : [
        { role: 'system' as const, content: systemPromptWithTime },
        ...messages,
      ];

  // Получаем провайдер для модели или используем featherless-ai по умолчанию
  const provider = MODEL_PROVIDERS[model] || 'featherless-ai';
  const modelWithSuffix = `${model}:${provider}`;

  const requestBody: HuggingFaceRequest = {
    model: modelWithSuffix,
    messages: messagesToSend,
    temperature,
    stream: false,
  };

  try {
    const response = await axios.post<HuggingFaceResponse>(
      HF_API_URL,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      return {
        content: response.data.choices[0].message.content,
        totalTokens: response.data.usage?.total_tokens,
      };
    }

    throw new Error('Пустой ответ от API');
  } catch (error) {
    if (axios.isAxiosError(error)) {
      let errorMessage: string;
      const errorData = error.response?.data?.error;
      
      if (errorData) {
        // Если error - объект, сериализуем его
        if (typeof errorData === 'object') {
          errorMessage = errorData.message || JSON.stringify(errorData);
        } else {
          errorMessage = String(errorData);
        }
      } else {
        errorMessage = error.message || 'Неизвестная ошибка';
      }
      
      console.error('Ошибка при отправке сообщения в Hugging Face:', errorMessage);
      throw new Error(`Ошибка Hugging Face API: ${errorMessage}`);
    }
    console.error('Ошибка при отправке сообщения:', error);
    throw error;
  }
}

