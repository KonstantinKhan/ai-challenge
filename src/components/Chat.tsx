import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { sendMessage as sendGigaChatMessage } from '../services/gigachat';
import { sendMessage as sendHuggingFaceMessage } from '../services/huggingface';
import { sendMessage as sendOpenRouterMessage } from '../services/openrouter';
import { compressMessages, SUMMARY_MARKER, getMessagesForAPI } from '../services/compression';
import { 
  saveConversation, 
  loadConversation, 
  getCurrentConversationId, 
  setCurrentConversationId,
  generateConversationTitle,
  createNewConversation
} from '../services/conversationStorage';
import { MessageInput } from './MessageInput';
import { PromptEditor } from './PromptEditor';
import { TemperatureSlider } from './TemperatureSlider';
import { ModelSelector } from './ModelSelector';
import { ConversationManager } from './ConversationManager';
import type { ChatMessage, ModelConfig, HuggingFaceModel } from '../types/gigachat';
import type { SavedConversation } from '../types/conversation';

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.87);
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelConfig>({
    provider: 'gigachat',
    modelId: 'GigaChat',
    displayName: 'GigaChat',
  });
  const [assistantResponseCount, setAssistantResponseCount] = useState<number>(0);
  const [currentConversationId, setCurrentConversationIdState] = useState<string | null>(null);
  const [isConversationManagerOpen, setIsConversationManagerOpen] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);

  const formatDuration = (ms: number): string => {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Автосохранение диалога с дебаунсом
  const autoSaveConversation = useCallback(() => {
    if (messages.length === 0) return;

    // Очищаем предыдущий таймер
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Устанавливаем новый таймер с дебаунсом 500ms
    saveTimeoutRef.current = setTimeout(() => {
      try {
        const existingConversation = currentConversationId 
          ? loadConversation(currentConversationId) 
          : null;

        const conversation: SavedConversation = {
          id: currentConversationId || (existingConversation?.id || ''),
          title: generateConversationTitle(messages),
          createdAt: existingConversation?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          systemPrompt,
          messages,
          modelConfig: selectedModel,
          temperature,
          assistantResponseCount,
        };

        // Если нет ID, создаем новый диалог
        if (!conversation.id) {
          const newConversation = createNewConversation(
            systemPrompt,
            selectedModel,
            temperature
          );
          conversation.id = newConversation.id;
          conversation.createdAt = newConversation.createdAt;
        }

        saveConversation(conversation);
        setCurrentConversationIdState(conversation.id);
        setCurrentConversationId(conversation.id);
      } catch (error) {
        console.error('Ошибка при автосохранении диалога:', error);
      }
    }, 500);
  }, [messages, systemPrompt, selectedModel, temperature, assistantResponseCount, currentConversationId]);

  // Загрузка диалога при монтировании
  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      const savedId = getCurrentConversationId();
      
      if (savedId) {
        const savedConversation = loadConversation(savedId);
        if (savedConversation) {
          setMessages(savedConversation.messages);
          setSystemPrompt(savedConversation.systemPrompt);
          setSelectedModel(savedConversation.modelConfig);
          setTemperature(savedConversation.temperature);
          setAssistantResponseCount(savedConversation.assistantResponseCount);
          setCurrentConversationIdState(savedConversation.id);
        }
      }
    }
  }, []);

  // Автосохранение при изменении данных
  useEffect(() => {
    if (!isInitialLoadRef.current) {
      autoSaveConversation();
    }
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [messages, systemPrompt, selectedModel, temperature, assistantResponseCount, autoSaveConversation]);

  const handleSend = async (userMessage: string) => {
    if (isLoading) return;

    const newUserMessage: ChatMessage = {
      role: 'user',
      content: userMessage,
    };

    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    setIsLoading(true);
    setError(null);

    try {
      const startTime = performance.now();
      let response: string;
      let totalTokens: number | undefined;

      let tokenUsage;

      // Filter messages for API - send compressed version if summary exists
      const messagesToSendToAPI = getMessagesForAPI(updatedMessages);

      if (selectedModel.provider === 'gigachat') {
        const gigachatResponse = await sendGigaChatMessage(messagesToSendToAPI, '', temperature);
        response = gigachatResponse.content;
        tokenUsage = gigachatResponse.tokenUsage;
      } else if (selectedModel.provider === 'openrouter') {
        const openRouterResponse = await sendOpenRouterMessage(messagesToSendToAPI, '', temperature);
        response = openRouterResponse.content;
        tokenUsage = openRouterResponse.tokenUsage;
      } else {
        const hfResponse = await sendHuggingFaceMessage(
          messagesToSendToAPI,
          selectedModel.modelId as HuggingFaceModel,
          '',
          temperature
        );
        response = hfResponse.content;
        totalTokens = hfResponse.totalTokens;
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response,
        totalTokens,
        tokenUsage,
        duration,
      };

      const messagesWithAssistant = [...updatedMessages, assistantMessage];
      setMessages(messagesWithAssistant);

      // Increment assistant response count
      const newCount = assistantResponseCount + 1;
      setAssistantResponseCount(newCount);

      // Check if compression should trigger (every 5 assistant responses)
      if (newCount % 5 === 0) {
        performCompression(messagesWithAssistant);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка при отправке сообщения');
      // Удаляем сообщение пользователя при ошибке
      setMessages(messages);
    } finally {
      setIsLoading(false);
    }
  };

  const performCompression = async (currentMessages: ChatMessage[]) => {
    try {
      const summaryMessage = await compressMessages(
        currentMessages,
        selectedModel
      );

      // APPEND summary to messages (don't replace - keep all messages visible)
      setMessages(prevMessages => {
        // Remove old summary if exists
        const withoutOldSummary = prevMessages.filter(msg =>
          !(msg.role === 'system' && msg.content.startsWith(SUMMARY_MARKER))
        );

        // Append new summary at the end
        return [...withoutOldSummary, summaryMessage];
      });

      console.log('Compression successful');
    } catch (error) {
      console.error('Compression failed, continuing without compression:', error);
      // Do nothing - messages remain unchanged
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
    setAssistantResponseCount(0);
    setCurrentConversationIdState(null);
    setCurrentConversationId(null);
  };

  const handleNewConversation = () => {
    // Если есть сообщения, сохраняем текущий диалог
    if (messages.length > 0) {
      const existingConversation = currentConversationId 
        ? loadConversation(currentConversationId) 
        : null;

      const conversation: SavedConversation = {
        id: currentConversationId || '',
        title: generateConversationTitle(messages),
        createdAt: existingConversation?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        systemPrompt,
        messages,
        modelConfig: selectedModel,
        temperature,
        assistantResponseCount,
      };

      // Если нет ID, создаем новый
      if (!conversation.id) {
        const newConv = createNewConversation(systemPrompt, selectedModel, temperature);
        conversation.id = newConv.id;
        conversation.createdAt = newConv.createdAt;
      }

      saveConversation(conversation);
    }

    // Очищаем состояние для нового диалога
    setMessages([]);
    setError(null);
    setAssistantResponseCount(0);
    setCurrentConversationIdState(null);
    setCurrentConversationId(null);
  };

  const handleLoadConversation = (conversation: SavedConversation) => {
    setMessages(conversation.messages);
    setSystemPrompt(conversation.systemPrompt);
    setSelectedModel(conversation.modelConfig);
    setTemperature(conversation.temperature);
    setAssistantResponseCount(conversation.assistantResponseCount);
    setCurrentConversationIdState(conversation.id);
    setError(null);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex justify-between items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-800">AI Chat</h1>

          <div className="flex-1 flex justify-center items-center gap-4">
            <ModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              disabled={isLoading}
            />
            <TemperatureSlider
              value={temperature}
              onChange={setTemperature}
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setIsConversationManagerOpen(true)}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
            >
              Сохраненные диалоги
            </button>
            <button
              onClick={() => setIsPromptEditorOpen(true)}
              className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm"
            >
              Редактировать промпт
            </button>
            <button
              onClick={handleNewConversation}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm"
            >
              Создать новый диалог
            </button>
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
              <p className="text-lg">Начните диалог с AI</p>
            </div>
          )}

          {messages
            .filter(message =>
              !(message.role === 'system' && message.content.startsWith(SUMMARY_MARKER))
            )
            .map((message, index) => {
            const isUser = message.role === 'user';
            return (
              <div
                key={index}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    isUser
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-800 border border-gray-200'
                  }`}
                >
                  <ReactMarkdown
                    className="break-words"
                    components={{
                      h1: ({ children }) => (
                        <h1 className={`text-2xl font-bold mt-4 mb-2 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className={`text-xl font-bold mt-3 mb-2 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className={`text-lg font-semibold mt-2 mb-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h3>
                      ),
                      h4: ({ children }) => (
                        <h4 className={`text-base font-semibold mt-2 mb-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h4>
                      ),
                      h5: ({ children }) => (
                        <h5 className={`text-sm font-semibold mt-1 mb-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h5>
                      ),
                      h6: ({ children }) => (
                        <h6 className={`text-xs font-semibold mt-1 mb-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h6>
                      ),
                      p: ({ children }) => (
                        <p className={`mb-2 last:mb-0 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </p>
                      ),
                      ul: ({ children }) => (
                        <ul className={`list-disc list-inside mb-2 space-y-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className={`list-decimal list-inside mb-2 space-y-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => (
                        <li className={`ml-2 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </li>
                      ),
                      strong: ({ children }) => (
                        <strong className={`font-bold ${isUser ? 'text-white' : 'text-gray-900'}`}>
                          {children}
                        </strong>
                      ),
                      em: ({ children }) => (
                        <em className={`italic ${isUser ? 'text-white' : 'text-gray-700'}`}>
                          {children}
                        </em>
                      ),
                      code: ({ children, className }) => {
                        const isInline = !className;
                        if (isInline) {
                          return (
                            <code
                              className={`px-1 py-0.5 rounded text-sm font-mono ${
                                isUser
                                  ? 'bg-blue-600 bg-opacity-50 text-white'
                                  : 'bg-gray-100 text-gray-900'
                              }`}
                            >
                              {children}
                            </code>
                          );
                        }
                        return <code className={className}>{children}</code>;
                      },
                      pre: ({ children }) => (
                        <pre
                          className={`p-3 rounded-lg overflow-x-auto mb-2 text-sm font-mono ${
                            isUser
                              ? 'bg-blue-600 bg-opacity-50 text-white'
                              : 'bg-gray-900 text-gray-100'
                          }`}
                        >
                          {children}
                        </pre>
                      ),
                      a: ({ children, href }) => (
                        <a
                          href={href}
                          className={`underline hover:opacity-80 ${
                            isUser ? 'text-blue-200' : 'text-blue-600'
                          }`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
                {!isUser && (message.tokenUsage || message.totalTokens !== undefined || message.duration !== undefined) && (
                  <div className="mt-2 px-4">
                    <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700 space-y-1.5 border border-gray-200">
                      {message.tokenUsage ? (
                        <>
                          <div>
                            Токены запроса: <span className="text-blue-600 font-semibold">{message.tokenUsage.prompt_tokens}</span> • 
                            Токены генерации: <span className="text-green-600 font-semibold">{message.tokenUsage.completion_tokens}</span>
                            {message.tokenUsage.precached_prompt_tokens !== undefined && (
                              <> • Кэшированные: <span className="text-indigo-600 font-semibold">{message.tokenUsage.precached_prompt_tokens}</span></>
                            )}
                          </div>
                          <div>
                            Всего токенов (к тарификации): <span className="text-amber-600 font-semibold">{message.tokenUsage.total_tokens}</span>
                            {message.duration !== undefined && (
                              <> • Время выполнения: <span className="text-slate-600 font-medium">{formatDuration(message.duration)}</span></>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {message.totalTokens !== undefined && (
                            <>
                              Токенов использовано: <span className="text-amber-600 font-semibold">{message.totalTokens}</span>
                            </>
                          )}
                          {message.totalTokens !== undefined && message.duration !== undefined && ' • '}
                          {message.duration !== undefined && (
                            <>
                              Время выполнения: <span className="text-slate-600 font-medium">{formatDuration(message.duration)}</span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

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
        </div>
      </div>

      <div className="bg-white border-t border-gray-200 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <MessageInput 
            onSend={handleSend} 
            disabled={isLoading}
          />
        </div>
      </div>

      <PromptEditor
        isOpen={isPromptEditorOpen}
        currentPrompt={systemPrompt}
        defaultPrompt={''}
        onClose={() => setIsPromptEditorOpen(false)}
        onSave={(prompt) => setSystemPrompt(prompt)}
        onReset={() => setSystemPrompt('')}
      />

      <ConversationManager
        isOpen={isConversationManagerOpen}
        onClose={() => setIsConversationManagerOpen(false)}
        onLoadConversation={handleLoadConversation}
      />
    </div>
  );
}



