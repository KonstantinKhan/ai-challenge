import axios from 'axios';
import type { ChatMessage, TokenUsage } from '../types/gigachat';
import { SYSTEM_PROMPT } from './gigachat';

const OPENROUTER_API_URL = '/api/openrouter';

const MODEL_ID = 'mistralai/mistral-7b-instruct:free';

interface OpenRouterRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}

interface OpenRouterResponse {
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
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Отправка сообщения в OpenRouter API
 */
export async function sendMessage(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  customSystemPrompt?: string,
  temperature: number = 0.87
): Promise<{ content: string; tokenUsage: TokenUsage }> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('VITE_OPENROUTER_API_KEY должна быть установлена в переменных окружения');
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

  const requestBody: OpenRouterRequest = {
    model: MODEL_ID,
    messages: messagesToSend,
    temperature,
  };

  try {
    const response = await axios.post<OpenRouterResponse>(
      OPENROUTER_API_URL,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin,
          'X-Title': 'AI Chat',
        },
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      return {
        content: response.data.choices[0].message.content,
        tokenUsage: response.data.usage,
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
      
      console.error('Ошибка при отправке сообщения в OpenRouter:', errorMessage);
      throw new Error(`Ошибка OpenRouter API: ${errorMessage}`);
    }
    console.error('Ошибка при отправке сообщения:', error);
    throw error;
  }
}
