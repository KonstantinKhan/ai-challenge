import axios from 'axios';
import type { OAuthResponse, ChatRequest, ChatResponse, TokenUsage } from '../types/gigachat';
import type { Tool } from '../types/tool';

const OAUTH_URL = '/api/oauth';
const CHAT_URL = '/api/chat';

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
  customSystemPrompt?: string,
  temperature: number = 0.87,
  functions?: Tool[]
): Promise<{
  content: string;
  tokenUsage?: TokenUsage;
  function_call?: { name: string; arguments: Record<string, unknown> };
}> {
  const accessToken = await getAccessToken();

  // Обрабатываем сообщения, учитывая системный промпт
  let processedMessages = [...messages];

  // Если предоставлен customSystemPrompt, добавляем его как первый элемент
  // или заменяем существующий системный промпт, если он есть
  if (customSystemPrompt) {
    // Проверяем, есть ли уже системное сообщение в массиве
    const existingSystemMessageIndex = processedMessages.findIndex(msg => msg.role === 'system');

    if (existingSystemMessageIndex !== -1) {
      // Заменяем существующее системное сообщение
      processedMessages[existingSystemMessageIndex] = {
        role: 'system' as const,
        content: customSystemPrompt
      };
    } else {
      // Добавляем новое системное сообщение в начало
      processedMessages = [{ role: 'system' as const, content: customSystemPrompt }, ...processedMessages];
    }
  }

  if (import.meta.env.DEV && customSystemPrompt) {
    console.log('[GigaChat] Sending with system prompt, total messages:', processedMessages.length);
    console.log('[GigaChat] System prompt length:', customSystemPrompt.length, 'chars');
  }

  const requestBody: ChatRequest = {
    model: 'GigaChat:latest', // Используем более конкретное имя модели
    messages: processedMessages,
    temperature,
    top_p: 0.9,
    stream: false,
    repetition_penalty: 1.0,
    update_interval: 0,
    // Добавляем функции только если они есть
    ...(functions && functions.length > 0 && {
      functions,
      function_call: 'auto' as const // Убедимся, что это правильный тип
    }),
  };

  if (import.meta.env.DEV && functions && functions.length > 0) {
    console.log('[GigaChat] Sending with functions:', functions.map(f => f.name));
  }

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
      const message = response.data.choices[0].message;

      // Парсим function_call, если присутствует
      let parsedFunctionCall: { name: string; arguments: Record<string, unknown> } | undefined;

      if (message.function_call) {
        try {
          // Проверяем, что arguments - это строка
          if (typeof message.function_call.arguments === 'string') {
            // Пробуем распарсить аргументы как JSON
            let args: Record<string, unknown>;

            try {
              args = JSON.parse(message.function_call.arguments);
            } catch {
              // Если не получается распарсить как JSON, сохраняем как строку
              args = { raw_arguments: message.function_call.arguments };
            }

            parsedFunctionCall = {
              name: message.function_call.name,
              arguments: args,
            };

            if (import.meta.env.DEV) {
              console.log('[GigaChat] Function call detected:', parsedFunctionCall);
            }
          } else {
            // Если arguments уже объект, используем его напрямую
            parsedFunctionCall = {
              name: message.function_call.name,
              arguments: message.function_call.arguments || {},
            };
          }
        } catch (error) {
          console.error('[GigaChat] Failed to parse function_call arguments:', error);
          // Возвращаем базовую информацию о вызове функции, даже если не удалось распарсить аргументы
          parsedFunctionCall = {
            name: message.function_call.name,
            arguments: {},
          };
        }
      }

      return {
        content: message.content,
        tokenUsage: response.data.usage,
        function_call: parsedFunctionCall,
      };
    }

    throw new Error('Пустой ответ от API');
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    throw error;
  }
}

