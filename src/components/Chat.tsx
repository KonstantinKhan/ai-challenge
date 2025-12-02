import { useState } from 'react';
import { sendMessage } from '../services/gigachat';
import { MessageInput } from './MessageInput';
import type { ChatMessage } from '../types/gigachat';

const MAX_MESSAGES = 5;

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageCount = messages.filter(m => m.role === 'user').length;
  const canSendMessage = messageCount < MAX_MESSAGES;

  const handleSend = async (userMessage: string) => {
    if (!canSendMessage || isLoading) return;

    const newUserMessage: ChatMessage = {
      role: 'user',
      content: userMessage,
    };

    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendMessage(updatedMessages);
      
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response,
      };

      setMessages([...updatedMessages, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка при отправке сообщения');
      // Удаляем сообщение пользователя при ошибке
      setMessages(messages);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold text-gray-800">GigaChat</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              Сообщений: {messageCount} / {MAX_MESSAGES}
            </span>
            <button
              onClick={handleClear}
              disabled={messages.length === 0}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm"
            >
              Очистить диалог
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 mt-20">
              <p className="text-lg">Начните диалог с GigaChat</p>
              <p className="text-sm mt-2">Вы можете отправить до {MAX_MESSAGES} сообщений в одном диалоге</p>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-800 border border-gray-200'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                  <span className="text-gray-600">Думаю...</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg">
              <p className="font-semibold">Ошибка:</p>
              <p>{error}</p>
            </div>
          )}

          {!canSendMessage && messages.length > 0 && (
            <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded-lg">
              <p>Достигнут лимит сообщений ({MAX_MESSAGES}). Очистите диалог, чтобы начать новый.</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-t border-gray-200 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <MessageInput onSend={handleSend} disabled={!canSendMessage || isLoading} />
        </div>
      </div>
    </div>
  );
}



