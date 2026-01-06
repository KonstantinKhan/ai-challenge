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
import { MCPToolsModal } from './MCPToolsModal';
import { getMCPTools, callMCPTool } from '../services/mcp';
// import { createSummariesConnection } from '../services/summaries';
// import { useAgentTasks } from '../hooks/useAgentTasks';
import { convertMCPToolsToGigaChatTools } from '../utils/toolConverter';
import type { ChatMessage, ModelConfig, HuggingFaceModel, TokenUsage } from '../types/gigachat';
import type { SavedConversation } from '../types/conversation';
import type { MCPToolWithServer } from '../types/mcp';
// import type { TaskSummary } from '../types/summaries';

type MCPToolConfig = {
  selected: boolean;
  args?: Record<string, unknown>;
};

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.87);
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelConfig>({
    provider: 'gigachat',
    modelId: 'GigaChat-2-Pro',
    displayName: 'GigaChat',
  });
  const [assistantResponseCount, setAssistantResponseCount] = useState<number>(0);
  const [currentConversationId, setCurrentConversationIdState] = useState<string | null>(null);
  const [isConversationManagerOpen, setIsConversationManagerOpen] = useState(false);
  const [isMCPModalOpen, setIsMCPModalOpen] = useState(false);
  const [mcpTools, setMcpTools] = useState<MCPToolWithServer[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpToolConfigs, setMcpToolConfigs] = useState<Record<string, MCPToolConfig>>({});
  const [mcpServerStatuses, setMcpServerStatuses] = useState<Record<string, {
    connected: boolean;
    error?: string;
    toolCount: number;
  }>>({});
  // const [summaries, setSummaries] = useState<TaskSummary[]>([]);
  const saveTimeoutRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);
  // const receivedIdsRef = useRef<Set<string>>(new Set());
  // const summariesConnectionRef = useRef<ReturnType<typeof createSummariesConnection> | null>(null);

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

  // SSE соединение для получения summaries
  // Закомментировано, так как сервер на порту 8080 не запущен
  // useEffect(() => {
  //   const connection = createSummariesConnection({
  //     onSummary: (id: string, text: string) => {
  //       // Дедупликация: проверяем, не получен ли уже summary с таким ID
  //       if (receivedIdsRef.current.has(id)) {
  //         if (import.meta.env.DEV) {
  //           console.debug('[SSE] Duplicate summary ignored:', id);
  //         }
  //         return;
  //       }

  //       // Добавляем ID в Set для дедупликации
  //       receivedIdsRef.current.add(id);

  //       // Добавляем summary в состояние
  //       setSummaries((prev) => [
  //         ...prev,
  //         {
  //           id,
  //           text,
  //           receivedAt: new Date(),
  //         },
  //       ]);
  //     },
  //     onError: (error) => {
  //       console.error('[SSE] Connection error:', error);
  //       // EventSource автоматически переподключается
  //     },
  //   });

  //   summariesConnectionRef.current = connection;

  //   // Закрываем соединение при размонтировании
  //   return () => {
  //     connection.close();
  //     summariesConnectionRef.current = null;
  //   };
  // }, []);

  const handleToggleMCPTool = (toolName: string) => {
    setMcpToolConfigs((prev) => {
      const prevConfig = prev[toolName] || { selected: false };
      return {
        ...prev,
        [toolName]: {
          ...prevConfig,
          selected: !prevConfig.selected,
        },
      };
    });
  };

  const handleUpdateToolArgs = (toolName: string, args: Record<string, unknown>) => {
    setMcpToolConfigs((prev) => {
      const prevConfig = prev[toolName] || { selected: false, args: {} };
      return {
        ...prev,
        [toolName]: {
          selected: prevConfig.selected, // Сохраняем состояние selected
          args: { ...(prevConfig.args || {}), ...args },
        },
      };
    });
  };

  // Интерфейс для запроса вызова инструмента (с аргументами)

  // Вспомогательная функция для генерации примеров сообщений пользователя

  // Функция для построения system prompt с описанием инструментов

  // Функция для парсинга запросов инструментов из ответа LLM

  // Функция для валидации аргументов инструмента

  // Функция для построения минимального system prompt с подсказкой о функциях
  const buildMinimalSystemPrompt = useCallback((basePrompt: string, hasTools: boolean): string => {
    if (!hasTools) {
      return basePrompt;
    }

    const functionsHint = `
Ты - полезный AI ассистент с доступом к инструментам поиска информации.

Когда пользователь задает вопрос, требующий поиска в документации или проектных файлах, используй доступные функции для получения актуальной информации.

ОБЯЗАТЕЛЬНО указывай источники информации в ответе (файлы и строки).
`;

    return basePrompt ? `${basePrompt}\n\n${functionsHint}` : functionsHint;
  }, []);

  // Функция для форматирования результата вызова инструмента
  const formatToolResult = useCallback((
    toolName: string,
    _args: Record<string, unknown>,
    result: unknown
  ): string => {
    if (toolName === 'rag_data') {
      // Log the RAG response for debugging
      console.log('[RAG Response] Raw result for formatting:', result);

      // Handle the nested RAG response structure
      let contentText = '';
      let sources: string[] = [];

      // Check if result has the expected structure with content array
      if (result && typeof result === 'object' && 'content' in result) {
        const resultObj = result as { content: Array<{ type: string; text: string }> };

        if (Array.isArray(resultObj.content) && resultObj.content.length > 0) {
          // Extract text content from each item in the content array
          contentText = resultObj.content
            .filter(item => item.type === 'text')
            .map(item => item.text)
            .join('\n\n');

          // Extract sources from the content text
          const fileMatches = contentText.match(/File: ([^\n\r]+)/g) || [];
          sources = fileMatches.map(match => match.replace('File: ', '').trim());
        } else {
          // Fallback: try to stringify the whole result
          contentText = JSON.stringify(result, null, 2);
        }
      } else {
        // Fallback: try to stringify the whole result
        contentText = JSON.stringify(result, null, 2);
      }

      console.log('[RAG Response] Extracted content text:', contentText);
      console.log('[RAG Response] Extracted sources:', sources);

      let formatted = '**Результаты поиска:**\n\n';
      formatted += '```\n' + contentText + '\n```';

      if (sources.length > 0) {
        formatted += '\n\n**Источники:**\n';
        sources.forEach(source => {
          formatted += `- \`${source}\`\n`;
        });
      }

      return formatted;
    }

    return `**Результат ${toolName}:**\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }, []);

  const handleSend = async (userMessage: string) => {
    if (isLoading) return;

    const newUserMessage: ChatMessage = {
      role: 'user',
      content: userMessage,
    };

    const baseMessages = [...messages, newUserMessage];

    setIsLoading(true);
    setError(null);

    try {
      const startTime = performance.now();

      // Получаем выбранные инструменты
      const selectedTools = mcpTools.filter(
        (tool) => mcpToolConfigs[tool.name]?.selected,
      );

      if (import.meta.env.DEV) {
        console.log('[handleSend] Selected tools:', selectedTools.map(t => t.name));
        console.log('[handleSend] Tool configs:', mcpToolConfigs);
      }

      // Конвертируем MCP инструменты в формат GigaChat (только для GigaChat)
      const gigaChatTools = selectedModel.provider === 'gigachat' && selectedTools.length > 0
        ? convertMCPToolsToGigaChatTools(selectedTools)
        : undefined;

      // Строим минимальный system prompt
      const enhancedSystemPrompt = buildMinimalSystemPrompt(
        systemPrompt,
        selectedTools.length > 0
      );

      if (import.meta.env.DEV) {
        console.log('[handleSend] Enhanced system prompt length:', enhancedSystemPrompt.length);
        if (gigaChatTools) {
          console.log('[handleSend] GigaChat tools:', gigaChatTools.map(t => t.name));
        }
      }

      // Подготавливаем сообщения для отправки в API
      const messagesToSendToAPI = getMessagesForAPI(baseMessages);

      // Делаем ОДИН запрос к LLM
      let assistantResponse: string;
      let tokenUsage: TokenUsage | undefined;
      let totalTokens: number | undefined;
      let functionCallData: { name: string; arguments: Record<string, unknown> } | undefined;

      if (selectedModel.provider === 'gigachat') {
        const gigachatResponse = await sendGigaChatMessage(
          messagesToSendToAPI,
          enhancedSystemPrompt,
          temperature,
          gigaChatTools, // Передаем functions только для GigaChat
        );
        assistantResponse = gigachatResponse.content;
        tokenUsage = gigachatResponse.tokenUsage;
        functionCallData = gigachatResponse.function_call;
      } else if (selectedModel.provider === 'openrouter') {
        const openRouterResponse = await sendOpenRouterMessage(
          messagesToSendToAPI,
          enhancedSystemPrompt,
          temperature,
        );
        assistantResponse = openRouterResponse.content;
        tokenUsage = openRouterResponse.tokenUsage;
      } else {
        const hfResponse = await sendHuggingFaceMessage(
          messagesToSendToAPI,
          selectedModel.modelId as HuggingFaceModel,
          enhancedSystemPrompt,
          temperature,
        );
        assistantResponse = hfResponse.content;
        totalTokens = hfResponse.totalTokens;
      }

      // Обработка function_call (если получен от GigaChat)
      if (functionCallData && selectedModel.provider === 'gigachat') {
        if (import.meta.env.DEV) {
          console.log('[handleSend] Function call received from GigaChat API:', functionCallData);
          console.log('[handleSend] This suggests GigaChat should handle MCP tools internally, but it returned a function call instead');
        }

        // The ideal scenario is that GigaChat API handles MCP tools internally during the API call
        // If we receive a function call response, it means the API didn't execute the tool internally
        // For now, we'll handle it by making the tool call ourselves and returning a proper response
        // But in a proper MCP integration, this shouldn't happen

        try {
          // Объединяем аргументы из конфига с аргументами из function_call
          const toolConfig = mcpToolConfigs[functionCallData.name] || { selected: false, args: {} };
          const mergedArgs = { ...functionCallData.arguments };

          // Для rag_data добавляем query из пользовательского сообщения и use_reranker из конфига
          if (functionCallData.name === 'rag_data') {
            // Добавляем оригинальное сообщение пользователя как query, если его нет
            if (!mergedArgs.query) {
              mergedArgs.query = userMessage;
            }
            // Добавляем use_reranker из конфига, если он задан
            if (toolConfig.args?.use_reranker !== undefined) {
              mergedArgs.use_reranker = toolConfig.args.use_reranker;
            }
          }

          // Вызов инструмента
          if (import.meta.env.DEV) {
            console.log(`[handleSend] Calling tool "${functionCallData.name}" with args:`, mergedArgs);
          }

          const toolResult = await callMCPTool(functionCallData.name, mergedArgs);

          // Log the RAG response for debugging
          if (functionCallData.name === 'rag_data') {
            console.log('[RAG Response] Tool result received:', toolResult);

            // Additional logging to understand the structure
            if (toolResult && typeof toolResult === 'object' && 'content' in toolResult) {
              console.log('[RAG Response] Content structure:', (toolResult as any).content);
            }
          }

          // Transform the RAG response to a format compatible with GigaChat API
          let processedResult = toolResult;

          if (functionCallData.name === 'rag_data') {
            if (toolResult && typeof toolResult === 'object' && 'content' in toolResult) {
              const resultObj = toolResult as { content: Array<{ type: string; text: string }> };

              if (Array.isArray(resultObj.content) && resultObj.content.length > 0) {
                // Log the original structure for debugging
                console.log('[RAG Response] Original structure for API:', toolResult);

                // For GigaChat API, we should send back the result in the same schema as defined in return_parameters
                // which matches the original RAG response structure: { content: [...] }
                processedResult = toolResult; // Send the original structure back

                console.log('[RAG Response] Sending back to API:', processedResult);
              } else {
                // If the expected structure is not found, log an error
                console.error('[RAG Response] Expected content array not found in RAG response:', toolResult);
                // Fallback: send the original result
                processedResult = toolResult;
              }
            } else {
              // If the response doesn't have the expected structure, log an error
              console.error('[RAG Response] Unexpected RAG response structure:', toolResult);
              // Fallback: send the original result
              processedResult = toolResult;
            }
          }

          // For proper MCP integration, the GigaChat API should handle the tool execution internally
          // Since it's returning a function call, we need to make a second request to get the final response
          // This is not ideal but may be how the current GigaChat API implementation works

          // Create a function result message (standard format for LLM APIs)
          // GigaChat API doesn't support 'function' role, so we use 'user' instead
          const functionResultMessage: ChatMessage = {
            role: 'user',
            content: `[Результат выполнения функции "${functionCallData.name}"]\n\n${formatToolResult(functionCallData.name, mergedArgs, processedResult)}`,
          };

          // Create a new conversation with the function result
          const messagesWithFunctionResult = [...baseMessages, {
            role: 'assistant' as const,
            content: assistantResponse, // Initial response that triggered the function call
            tokenUsage,
            duration: performance.now() - startTime,
          }, functionResultMessage];

          // Make a second request to get the final response incorporating the function result
          // Send full context instead of slice(-10) to avoid losing important information
          const finalResponse = await sendGigaChatMessage(
            messagesWithFunctionResult,
            enhancedSystemPrompt,
            temperature,
            undefined, // Don't pass tools again
          );

          assistantResponse = finalResponse.content;
          tokenUsage = finalResponse.tokenUsage;

          if (import.meta.env.DEV) {
            console.log('[handleSend] Final response after function execution received');
          }
        } catch (toolError) {
          console.error('[handleSend] Error executing tool:', toolError);

          // If tool execution fails, inform the user
          const errorMessage = toolError instanceof Error
            ? toolError.message
            : `Failed to execute tool "${functionCallData.name}"`;
          assistantResponse = `**Ошибка выполнения инструмента ${functionCallData.name}:**\n\n${errorMessage}`;
        }
      }

      // Вычисляем общую длительность запроса (включая обработку функций)
      const totalEndTime = performance.now();
      const totalDuration = totalEndTime - startTime;

      // Создаем сообщение ассистента
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: assistantResponse,
        totalTokens,
        tokenUsage,
        duration: totalDuration,
      };

      // Обновляем состояние сообщений
      const messagesWithAssistant = [...baseMessages, assistantMessage];
      setMessages(messagesWithAssistant);

      // Увеличиваем счетчик ответов и проверяем на необходимость сжатия
      const newCount = assistantResponseCount + 1;
      setAssistantResponseCount(newCount);

      if (newCount % 5 === 0) {
        performCompression(messagesWithAssistant);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Произошла ошибка при отправке сообщения',
      );
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

  // Функция для автоматической генерации саммари (вызывается планировщиком)
  // Закомментировано, так как сервер на порту 8080 не запущен
  // const handleAutoGenerateSummary = useCallback(async () => {
  //   console.log('Auto-generating task summary...');

  //   const summaryPrompt = 'Пожалуйста, проанализируй текущие невыполненные задачи и создай ежедневное саммари.';

  //   // Используем существующую функцию handleSend
  //   await handleSend(summaryPrompt);

  //   console.log('Auto-summary generation completed');
  // }, [messages, isLoading, mcpTools, mcpToolConfigs, systemPrompt, selectedModel, temperature, assistantResponseCount]);

  // Подключаем hook для автоматической обработки задач от планировщика
  // Закомментировано, так как сервер на порту 8080 не запущен
  // useAgentTasks({
  //   onGenerateSummary: handleAutoGenerateSummary,
  //   enabled: true,
  // });

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

  const handleOpenMCPTools = async () => {
    setIsMCPModalOpen(true);
    setMcpLoading(true);
    setMcpError(null);

    try {
      const response = await getMCPTools();
      setMcpTools(response.tools);
      setMcpServerStatuses(response.serverStatuses);

      // Log connection summary
      const connected = Object.entries(response.serverStatuses)
        .filter(([, status]) => status.connected)
        .map(([name]) => name);
      console.log('[MCP] Connected servers:', connected.join(', '));
    } catch (error) {
      setMcpError(
        error instanceof Error
          ? error.message
          : 'Failed to fetch MCP tools'
      );
    } finally {
      setMcpLoading(false);
    }
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
              onClick={handleOpenMCPTools}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm"
            >
              MCP Tools
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
          {/* {summaries.length > 0 && (
            <div className="space-y-3 mb-6">
              <h2 className="text-lg font-semibold text-gray-700">Task Summaries</h2>
              {summaries.map((summary) => {
                const timeString = summary.receivedAt.toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                return (
                  <div
                    key={summary.id}
                    className="bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs text-gray-500 font-medium">
                        {timeString}
                      </span>
                    </div>
                    <p className="text-gray-800 whitespace-pre-wrap">{summary.text}</p>
                  </div>
                );
              })}
            </div>
          )} */}

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

      <MCPToolsModal
        isOpen={isMCPModalOpen}
        onClose={() => setIsMCPModalOpen(false)}
        tools={mcpTools}
        isLoading={mcpLoading}
        error={mcpError}
        toolConfigs={mcpToolConfigs}
        onToggleTool={handleToggleMCPTool}
        onUpdateToolArgs={handleUpdateToolArgs}
        serverStatuses={mcpServerStatuses}
      />
    </div>
  );
}



