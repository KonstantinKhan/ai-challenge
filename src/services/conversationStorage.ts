import type { SavedConversation } from '../types/conversation';

const STORAGE_KEY_CONVERSATIONS = 'ai-chat-conversations';
const STORAGE_KEY_CURRENT_ID = 'ai-chat-current-id';

/**
 * Генерирует уникальный ID для диалога
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Генерирует название диалога из первого пользовательского сообщения
 */
export function generateConversationTitle(messages: Array<{ role: string; content: string }>): string {
  const firstUserMessage = messages.find(msg => msg.role === 'user');
  if (!firstUserMessage) {
    return 'Новый диалог';
  }
  
  const content = firstUserMessage.content.trim();
  if (content.length <= 50) {
    return content;
  }
  
  return content.substring(0, 50) + '...';
}

/**
 * Сохраняет диалог в LocalStorage
 */
export function saveConversation(conversation: SavedConversation): void {
  try {
    const conversations = listConversations();
    const existingIndex = conversations.findIndex(c => c.id === conversation.id);
    
    if (existingIndex >= 0) {
      // Обновляем существующий диалог
      conversations[existingIndex] = conversation;
    } else {
      // Добавляем новый диалог
      conversations.push(conversation);
    }
    
    // Сортируем по дате обновления (новые сверху)
    conversations.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    
    localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(conversations));
  } catch (error) {
    console.error('Ошибка при сохранении диалога:', error);
  }
}

/**
 * Загружает диалог по ID
 */
export function loadConversation(id: string): SavedConversation | null {
  try {
    const conversations = listConversations();
    return conversations.find(c => c.id === id) || null;
  } catch (error) {
    console.error('Ошибка при загрузке диалога:', error);
    return null;
  }
}

/**
 * Возвращает список всех сохраненных диалогов
 */
export function listConversations(): SavedConversation[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
    if (!data) {
      return [];
    }
    
    const conversations = JSON.parse(data) as SavedConversation[];
    // Сортируем по дате обновления (новые сверху)
    return conversations.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (error) {
    console.error('Ошибка при загрузке списка диалогов:', error);
    return [];
  }
}

/**
 * Удаляет диалог
 */
export function deleteConversation(id: string): void {
  try {
    const conversations = listConversations();
    const filtered = conversations.filter(c => c.id !== id);
    localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(filtered));
    
    // Если удаляемый диалог был текущим, очищаем текущий ID
    if (getCurrentConversationId() === id) {
      setCurrentConversationId(null);
    }
  } catch (error) {
    console.error('Ошибка при удалении диалога:', error);
  }
}

/**
 * Получает ID текущего активного диалога
 */
export function getCurrentConversationId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_CURRENT_ID);
  } catch (error) {
    console.error('Ошибка при получении текущего ID диалога:', error);
    return null;
  }
}

/**
 * Устанавливает ID текущего активного диалога
 */
export function setCurrentConversationId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEY_CURRENT_ID, id);
    } else {
      localStorage.removeItem(STORAGE_KEY_CURRENT_ID);
    }
  } catch (error) {
    console.error('Ошибка при установке текущего ID диалога:', error);
  }
}

/**
 * Создает новый диалог с автогенерацией ID и названия
 */
export function createNewConversation(
  systemPrompt: string,
  modelConfig: { provider: string; modelId: string; displayName: string },
  temperature: number
): SavedConversation {
  const id = generateId();
  const now = new Date().toISOString();
  
  return {
    id,
    title: 'Новый диалог',
    createdAt: now,
    updatedAt: now,
    systemPrompt,
    messages: [],
    modelConfig,
    temperature,
    assistantResponseCount: 0,
  };
}
