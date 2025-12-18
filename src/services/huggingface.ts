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

  // Получаем провайдер для модели или используем featherless-ai по умолчанию
  const provider = MODEL_PROVIDERS[model] || 'featherless-ai';
  const modelWithSuffix = `${model}:${provider}`;

  // Добавляем system prompt в начало массива сообщений, если он передан
  const messagesWithSystem = customSystemPrompt
    ? [{ role: 'system' as const, content: customSystemPrompt }, ...messages]
    : messages;

  if (import.meta.env.DEV && customSystemPrompt) {
    console.log('[HuggingFace] Sending with system prompt, total messages:', messagesWithSystem.length);
    console.log('[HuggingFace] System prompt length:', customSystemPrompt.length, 'chars');
  }

  const requestBody: HuggingFaceRequest = {
    model: modelWithSuffix,
    messages: messagesWithSystem,
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

