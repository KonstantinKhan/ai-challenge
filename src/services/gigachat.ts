import axios from 'axios';
import type { OAuthResponse, ChatRequest, ChatResponse, TokenUsage } from '../types/gigachat';

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
  temperature: number = 0.87
): Promise<{ content: string; tokenUsage?: TokenUsage }> {
  const accessToken = await getAccessToken();

  const requestBody: ChatRequest = {
    model: 'GigaChat',
    messages: messages,
    temperature,
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
      return {
        content: response.data.choices[0].message.content,
        tokenUsage: response.data.usage,
      };
    }

    throw new Error('Пустой ответ от API');
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    throw error;
  }
}

