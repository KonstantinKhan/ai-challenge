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
import { createSummariesConnection } from '../services/summaries';
import { useAgentTasks } from '../hooks/useAgentTasks';
import type { ChatMessage, ModelConfig, HuggingFaceModel, TokenUsage } from '../types/gigachat';
import type { SavedConversation } from '../types/conversation';
import type { MCPToolWithServer } from '../types/mcp';
import type { TaskSummary } from '../types/summaries';

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
  const [summaries, setSummaries] = useState<TaskSummary[]>([]);
  const saveTimeoutRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);
  const receivedIdsRef = useRef<Set<string>>(new Set());
  const summariesConnectionRef = useRef<ReturnType<typeof createSummariesConnection> | null>(null);

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
  useEffect(() => {
    const connection = createSummariesConnection({
      onSummary: (id: string, text: string) => {
        // Дедупликация: проверяем, не получен ли уже summary с таким ID
        if (receivedIdsRef.current.has(id)) {
          if (import.meta.env.DEV) {
            console.debug('[SSE] Duplicate summary ignored:', id);
          }
          return;
        }

        // Добавляем ID в Set для дедупликации
        receivedIdsRef.current.add(id);

        // Добавляем summary в состояние
        setSummaries((prev) => [
          ...prev,
          {
            id,
            text,
            receivedAt: new Date(),
          },
        ]);
      },
      onError: (error) => {
        console.error('[SSE] Connection error:', error);
        // EventSource автоматически переподключается
      },
    });

    summariesConnectionRef.current = connection;

    // Закрываем соединение при размонтировании
    return () => {
      connection.close();
      summariesConnectionRef.current = null;
    };
  }, []);

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
  interface ToolCallRequest {
    tool: string;
    arguments: Record<string, unknown>;
  }

  // Вспомогательная функция для генерации примеров сообщений пользователя
  const getExampleUserMessage = (tool: MCPToolWithServer): string => {
    const examples: Record<string, string> = {
      'add_task': 'Добавь задачу: купить молоко',
      'get_pending_tasks': 'Какие у меня есть задачи?',
      'complete_task': 'Отметь задачу как выполненную',
      'get_books': 'Найди книги автора Толстой',
      'add_task_summary': 'Создай summary: выполнено 3 задачи сегодня',
      'get_undelivered_summaries': 'Покажи непрочитанные summaries',
      'mark_summary_delivered': 'Отметь summary как доставленный',
      'tavily-search': 'Найди информацию о новых возможностях React 19',
      'tavily-extract': 'Извлеки данные со страницы документации',
      'rag_data': 'Найди информацию о квантовых компьютерах',
      'run_test': 'Запусти тесты для проекта mcp-run-tests',
    };

    return examples[tool.name] || `Используй инструмент ${tool.name}`;
  };

  // Функция для построения system prompt с описанием инструментов
  const buildSystemPromptWithTools = useCallback((basePrompt: string, tools: MCPToolWithServer[]): string => {
    if (tools.length === 0) {
      return basePrompt;
    }

    // Группируем инструменты по серверам
    const toolsByServer = tools.reduce((acc, tool) => {
      if (!acc[tool.serverName]) {
        acc[tool.serverName] = [];
      }
      acc[tool.serverName].push(tool);
      return acc;
    }, {} as Record<string, MCPToolWithServer[]>);

    const hasTavily = toolsByServer['tavily']?.length > 0;
    const hasLocal = toolsByServer['local']?.length > 0;
    const hasRag = tools.some(t => t.name === 'rag_data');

    // 1. Описание инструментов с группировкой по серверам
    const toolsDescription = Object.entries(toolsByServer).map(([serverName, serverTools]) => {
      const serverLabel = serverName === 'tavily' ? 'WEB SEARCH TOOLS (Tavily)' : 'LOCAL TOOLS';
      const toolsList = serverTools.map((tool, index) => {
        const required = tool.inputSchema.required || [];
        const properties = tool.inputSchema.properties || {};

        const paramsDesc = Object.entries(properties)
          .map(([name, schema]) => {
            const isRequired = required.includes(name);
            const type = schema.type || 'unknown';
            const description = schema.description || '';
            return `    - ${name} (${type}, ${isRequired ? 'обязательный' : 'опциональный'})${description ? ': ' + description : ''}`;
          })
          .join('\n');

        const toolDesc = tool.description ? ` - ${tool.description}` : '';
        return `${index + 1}. ${tool.name}${toolDesc}\n  Параметры:\n${paramsDesc || '    (нет параметров)'}`;
      }).join('\n\n');

      return `### ${serverLabel}\n\n${toolsList}`;
    }).join('\n\n');

    // Инструкция по извлечению аргументов
    const argumentExtractionInstructions = `
## КАК ИЗВЛЕКАТЬ АРГУМЕНТЫ ИЗ ЗАПРОСА ПОЛЬЗОВАТЕЛЯ

КРИТИЧЕСКИ ВАЖНО: Ты должен внимательно анализировать текст пользователя, чтобы найти и извлечь значения для всех ОБЯЗАТЕЛЬНЫХ аргументов инструмента. Не угадывай значения, а находи их в тексте.

**ПРИМЕР РАБОТЫ:**

1.  **ЗАПРОС ПОЛЬЗОВАТЕЛЯ:** "Запусти, пожалуйста, тесты для проекта mcp-run-tests"
2.  **ТВОЙ АНАЛИЗ:**
    *   Пользователь хочет запустить тесты. Для этого подходит инструмент \`run_test\`.
    *   У инструмента \`run_test\` есть обязательный параметр \`project_name\`.
    *   В тексте пользователя есть фраза "для проекта mcp-run-tests". Отсюда я могу извлечь имя проекта.
    *   Имя проекта: "mcp-run-tests".
3.  **ПРАВИЛЬНЫЙ ВЫЗОВ ИНСТРУМЕНТА:**

    TOOL_CALL:
    {
      "tool": "run_test",
      "arguments": {
        "project_name": "mcp-run-tests"
      }
    }
    END_TOOL_CALL

**НЕПРАВИЛЬНЫЙ ВЫЗОВ (пропущен обязательный аргумент):**

    TOOL_CALL:
    {
      "tool": "run_test",
      "arguments": {}
    }
    END_TOOL_CALL

Этот вызов приведёт к ошибке, так как \`project_name\` не был предоставлен. Всегда ищи значение в запросе пользователя!

**ПРИМЕР РАБОТЫ С RAG_DATA:**

1.  **ЗАПРОС ПОЛЬЗОВАТЕЛЯ:** "Найди информацию о квантовых компьютерах"
2.  **ТВОЙ АНАЛИЗ:**
    *   Пользователь хочет найти информацию. Для этого подходит инструмент \`rag_data\`.
    *   У инструмента \`rag_data\` есть обязательный параметр \`query\`.
    *   Я должен сформулировать поисковый запрос с ключевыми словами.
    *   Запрос: "quantum computers principles applications"
3.  **ПРАВИЛЬНЫЙ ВЫЗОВ ИНСТРУМЕНТА:**

    TOOL_CALL:
    {
      "tool": "rag_data",
      "arguments": {
        "query": "quantum computers principles applications"
      }
    }
    END_TOOL_CALL

**ВАЖНО для RAG_DATA:**
- Формулируй запрос в виде ключевых слов или короткого вопроса
- Используй английский язык для технических терминов
- Избегай слишком общих запросов - будь конкретным
- Хороший запрос: "machine learning algorithms", "quantum computing basics", "neural networks architecture"
- Плохой запрос: "как работает", "все про тему", "покажи информацию"
`;

    const resultFormattingInstructions = `
## ФОРМАТИРОВАНИЕ РЕЗУЛЬТАТОВ ИНСТРУМЕНТОВ

После получения \`TOOL_RESULT\` от инструмента, ты должен представить результат пользователю в четком и информативном виде.

**Особые правила для \`run_test\`:**

Когда ты получаешь успешный \`TOOL_RESULT\` от \`run_test\`, отформатируй свой ответ следующим образом:

1.  **ЗАГОЛОВОК:** Начни с сообщения об успешном прохождении тестов.
2.  **САММАРИ:** Укажи общее количество пройденных тестов и суммарное время выполнения.
3.  **СПИСОК ТЕСТОВ:** Выведи список всех тестов, указывая название каждого теста и его статус.

**ПРИМЕР:**

**\`TOOL_RESULT\` который ты получил:**
\`\`\`json
{
  "summary": {
    "total_tests": 5,
    "passed": 5,
    "failed": 0,
    "total_time_ms": 1234
  },
  "tests": [
    { "name": "test_login_success", "status": "passed", "duration_ms": 200 },
    { "name": "test_login_failure", "status": "passed", "duration_ms": 300 },
    { "name": "test_create_post", "status": "passed", "duration_ms": 400 },
    { "name": "test_delete_post", "status": "passed", "duration_ms": 150 },
    { "name": "test_logout", "status": "passed", "duration_ms": 184 }
  ]
}
\`\`\`

**ТВОЙ ОТВЕТ ПОЛЬЗОВАТЕЛЮ:**

Тесты для проекта \`mcp-run-tests\` успешно пройдены!

- **Всего пройдено:** 5 тестов
- **Общее время:** 1.23 сек

**Список тестов:**
- ✅ test_login_success
- ✅ test_login_failure
- ✅ test_create_post
- ✅ test_delete_post
- ✅ test_logout

**Особые правила для \`rag_data\`:**

Когда ты получаешь \`TOOL_RESULT\` от \`rag_data\`, результат содержит найденные фрагменты документов:

\`\`\`
────────────────────────────────────────────────────────────────────────────────
Result #1 | Similarity: 0.8523
File: vite.config.ts
Location: /project/vite.config.ts:8-34
Chunk #1

[текст фрагмента кода или документации]
────────────────────────────────────────────────────────────────────────────────
\`\`\`

**ТВОЯ ЗАДАЧА:**
1.  **Прочитай** все найденные фрагменты
2.  **Извлеки** релевантную информацию для ответа
3.  **Сформулируй ответ** своими словами на основе найденного
4.  **ОБЯЗАТЕЛЬНО укажи источники** - упомяни файлы и их расположение (строки/локации), из которых взята информация

**ВАЖНО - ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ОБ ИСТОЧНИКАХ:**

В тексте ответа от \`rag_data\` (в TOOL_RESULT) есть строки вида \`File: {ИСТОЧНИК}\`. ТЫ ОБЯЗАН:
- **Найти** в тексте TOOL_RESULT все строки, начинающиеся с \`File: \`
- **Извлечь** имя источника из каждой такой строки (текст после \`File: \`)
- **Использовать** это имя файла как источник информации в твоем ответе
- **Указать** это имя файла в секции "Источники" в конце ответа

**Пример извлечения:**
Если в тексте TOOL_RESULT видишь:
\`\`\`
────────────────────────────────────────────────────────────────────────────────
Result #1 | Similarity: 0.8523
File: vite.config.ts
Location: /project/vite.config.ts:8-34
Chunk #1

[текст фрагмента]
\`\`\`

То найди строку \`File: vite.config.ts\` и извлеки оттуда \`vite.config.ts\`.

В ответе ОБЯЗАТЕЛЬНО укажи:
**Источник:** \`vite.config.ts\` (строки 8-34)

**КРИТИЧНО:** Ответ без указания источников НЕДОПУСТИМ! Всегда ищи в тексте TOOL_RESULT строки вида \`File: {ИСТОЧНИК}\`, извлекай имя источника и указывай его в ответе.

**ПРИМЕРЫ ХОРОШИХ ОТВЕТОВ:**

**Пример 1 - Один источник:**

Для настройки proxy в Vite нужно добавить конфигурацию в \`vite.config.ts\`:

\`\`\`typescript
server: {
  proxy: {
    '/api/oauth': {
      target: 'https://example.com',
      changeOrigin: true,
      secure: false,
    }
  }
}
\`\`\`

**Источник:** \`vite.config.ts\` (строки 8-34)

**Пример 2 - Несколько источников:**

Для работы с API в проекте используется несколько компонентов. Основная логика находится в \`src/services/api.ts\`, где определены функции для отправки запросов. Обработка ошибок реализована в \`src/utils/errorHandler.ts\`.

**Источники:**
- \`src/services/api.ts\` (строки 15-45)
- \`src/utils/errorHandler.ts\` (строки 8-25)

**Пример 3 - С указанием конкретных локаций:**

Архитектура приложения состоит из трех основных слоев: сервисы, компоненты и утилиты. Сервисы находятся в \`src/services/\`, компоненты в \`src/components/\`, а утилиты в \`src/utils/\`.

**Источники:**
- \`src/services/gigachat.ts\` (строки 1-50, Location: /project/src/services/gigachat.ts:1-50)
- \`src/components/Chat.tsx\` (строки 34-100, Location: /project/src/components/Chat.tsx:34-100)

**ФОРМАТ УКАЗАНИЯ ИСТОЧНИКОВ:**

После каждого ответа, основанного на результатах rag_data, ОБЯЗАТЕЛЬНО добавь секцию с источниками.

**КАК ИЗВЛЕКАТЬ ИСТОЧНИКИ ИЗ TOOL_RESULT:**

1. Прочитай весь текст TOOL_RESULT от \`rag_data\`
2. Найди все строки, которые начинаются с \`File: \` (например, \`File: vite.config.ts\`)
3. Для каждой такой строки извлеки имя файла (текст после \`File: \`) - это и есть источник
4. Если есть строка \`Location: {}\`, извлеки информацию о строках/локации
5. Используй эти данные для указания источников в ответе

**Пример поиска в тексте:**
Если в TOOL_RESULT есть строка:
\`File: vite.config.ts\`

То имя источника - это \`vite.config.ts\` (текст после \`File: \`).

**Если один источник (найден в строке \`File: vite.config.ts\`):**
**Источник:** \`vite.config.ts\` (строки 8-34)

**Если несколько источников (найдены строки \`File: файл1.ts\`, \`File: файл2.js\`):**
**Источники:**
- \`файл1.ts\` (строки 10-25) - извлечено из строки \`File: файл1.ts\`
- \`файл2.js\` (строки 5-15) - извлечено из строки \`File: файл2.js\`

**Можно также указать полный путь из строки \`Location: {}\`:**
**Источники:**
- \`файл1.ts\` (строки 10-25, Location: /project/path/to/file1.ts:10-25)
- \`файл2.js\` (строки 5-15, Location: /project/path/to/file2.js:5-15)

**ПОМНИ:** Всегда ищи в тексте TOOL_RESULT строки вида \`File: {ИСТОЧНИК}\`, извлекай имя источника (текст после \`File: \`) и указывай его в секции источников!

**ЗАПРЕЩЕНО:**
- ❌ Отвечать без указания источников
- ❌ Говорить "на основе информации" без конкретных файлов
- ❌ Упоминать источники только в тексте без отдельной секции в конце ответа
- ❌ Пропускать указание строк/локаций, если они доступны в TOOL_RESULT
- ❌ Игнорировать строки \`File: {ИСТОЧНИК}\` в тексте TOOL_RESULT - ОБЯЗАН найти и извлечь имя источника
- ❌ Придумывать имена файлов - используй ТОЛЬКО имена, извлеченные из строк \`File: {ИСТОЧНИК}\` в тексте результатов
`;

    // 2. ПАЙПЛАЙН для работы с Tavily и Local инструментами
    const pipelineInstructions = hasTavily && hasLocal ? `
## РАБОЧИЙ ПРОЦЕСС: ПОИСК → АНАЛИЗ И ФОРМИРОВАНИЕ → СОЗДАНИЕ ЗАДАЧ

Когда пользователь просит "Составить список задач по обновлению X до последней версии":

**ШАГ 1: ПОИСК ДОКУМЕНТАЦИИ**
- Используй tavily_search для получения актуальной документации и информации об изменениях
- Запроси информацию о миграции, breaking changes, новых возможностях

**ШАГ 2: АНАЛИЗ И ФОРМИРОВАНИЕ ЗАДАЧ**
- Дождись TOOL_RESULT от tavily_search
- Проанализируй полученные данные
- Выдели КЛЮЧЕВЫЕ ИЗМЕНЕНИЯ, которые требуют действий
- Сформируй конкретные задачи для каждого ключевого изменения

**ШАГ 3: СОЗДАНИЕ ЗАДАЧ В СИСТЕМЕ**
- Для КАЖДОЙ сформированной задачи вызови add_task
- Передай четкое описание того, что нужно сделать
- НЕ создавай задачи до получения и анализа данных от tavily_search!

**ШАГ 4: ИНТЕРПРЕТАЦИЯ РЕЗУЛЬТАТА**
- После получения TOOL_RESULT от add_task
- Сообщи пользователю, какие задачи были созданы
- Укажи основные моменты из документации

**ПРИМЕР ПОЛНОГО ПАЙПЛАЙНА:**

User: "Составь список задач по обновлению React до последней версии"

→ LLM: "Сейчас найду информацию о последней версии React и ключевых изменениях.

TOOL_CALL:
{"tool": "tavily_search", "arguments": {"query": "React 19 migration guide breaking changes latest 2025"}}
END_TOOL_CALL"

→ [Ждешь TOOL_RESULT от Tavily с документацией]

→ LLM анализирует: "На основе документации React 19, вижу 3 ключевых изменения:
1. Новый компилятор React Compiler требует обновления конфигурации
2. Изменения в API: createRoot заменяет render
3. Новые хуки: useActionState и useOptimistic

Создаю задачи:

TOOL_CALL:
{"tool": "add_task", "arguments": {"title": "Установить и настроить React Compiler для автоматической оптимизации"}}
END_TOOL_CALL

TOOL_CALL:
{"tool": "add_task", "arguments": {"title": "Заменить ReactDOM.render на ReactDOM.createRoot во всех entry points"}}
END_TOOL_CALL

TOOL_CALL:
{"tool": "add_task", "arguments": {"title": "Изучить и внедрить новые хуки useActionState для form actions"}}
END_TOOL_CALL"

→ [TOOL_RESULT от add_task - задачи созданы]

→ LLM: "Готово! Создано 3 задачи на основе ключевых изменений React 19."
` : '';

    // 3. Секция КОГДА использовать инструменты
    const whenToUse = `
## ‼️ КРИТИЧНО! ТЫ ДОЛЖЕН ИСПОЛЬЗОВАТЬ ИНСТРУМЕНТЫ!

**ТЫ НЕ ИМЕЕШЬ ПРАВА отвечать без инструментов, когда пользователь:**
- Спрашивает о задачах ("какие задачи?", "покажи задачи", "что у меня в списке?") → **ОБЯЗАН** вызвать get_pending_tasks
- Просит добавить задачу ("добавь задачу", "создай задачу", "запиши") → **ОБЯЗАН** вызвать add_task
${hasRag ? '- **Задает ЛЮБОЙ вопрос, требующий поиска информации** → **ОБЯЗАН СНАЧАЛА** вызвать rag_data' : '- **Задает ЛЮБОЙ вопрос со словами "на проекте", "в проекте", "для проекта", "по проекту"** → **ОБЯЗАН СНАЧАЛА** вызвать rag_data'}
${hasRag ? '- **Спрашивает "как", "где", "какие", "что", "почему", "когда"** → **СНАЧАЛА** rag_data, потом отвечай' : '- **Просит информацию из проектной документации** ("найди в документации", "как настроить", "где в коде") → **ОБЯЗАН** вызвать rag_data'}
${hasRag ? '- **Просит найти информацию на любую тему** → **ОБЯЗАН** вызвать rag_data' : '- **Спрашивает про существующий код, архитектуру, конфигурацию, стратегии, подходы в проекте** → **ОБЯЗАН СНАЧАЛА** вызвать rag_data'}
${!hasRag ? '- **Спрашивает "как", "где", "какие", "что" в контексте разработки** → **СНАЧАЛА** rag_data, потом отвечай' : ''}
- Спрашивает о книгах или авторах ("найди книги") → **ОБЯЗАН** вызвать соответствующий инструмент
${hasTavily ? '- Просит информацию из интернета или составить список задач по обновлению → **ОБЯЗАН** вызвать tavily_search ПЕРВЫМ!' : ''}
${hasTavily ? '- Просит создать задачи на основе актуальной информации → **ОБЯЗАН** сначала tavily_search, потом add_task!' : ''}

**ЗАПРЕЩЕНО:**
- ❌ Отвечать текстом о задачах без вызова get_pending_tasks
- ❌ Говорить "я добавлю задачу" без реального вызова add_task
${hasRag ? '- **❌ КРИТИЧНО! Отвечать на вопросы, требующие поиска информации, из своих знаний - ВСЕГДА сначала rag_data!**' : '- **❌ КРИТИЧНО! Отвечать на вопросы про проект из своих знаний - ВСЕГДА сначала rag_data!**'}
${hasRag ? '- **❌ Отвечать "я не знаю" или "я не имею доступа к информации" - У ТЕБЯ ЕСТЬ RAG_DATA!**' : '- **❌ Отвечать "я не имею доступа к проекту" - У ТЕБЯ ЕСТЬ RAG_DATA!**'}
- **❌ Предлагать "опиши контекст" вместо вызова rag_data**
${hasRag ? '- **❌ Говорить про "общий подход" вместо поиска информации через rag_data**' : '- **❌ Говорить про "общий подход" вместо поиска в проектной документации**'}
- **❌ Угадывать содержимое файлов вместо использования rag_data**
${hasTavily ? '- ❌ Создавать список задач по обновлению без предварительного вызова tavily_search' : ''}
${hasTavily ? '- ❌ Использовать твои устаревшие знания вместо актуальной информации из tavily_search' : ''}

**ПРАВИЛО:** Если сомневаешься - вызови инструмент! Лучше лишний раз вызвать, чем отвечать без инструментов.

${hasRag ? '**ВАЖНО для RAG_DATA:** Инструмент rag_data доступен для поиска информации на ЛЮБУЮ тему. Используй его для любых вопросов, требующих поиска информации, независимо от темы!' : '**ВАЖНО для RAG_DATA:** Если пользователь спрашивает про "стратегии на проекте", "подходы в проекте", "как в проекте" - это вопрос к rag_data, НЕ общий вопрос!'}
${hasRag ? '\n\n**ПОМНИ:** После использования rag_data ОБЯЗАТЕЛЬНО укажи источники информации в ответе! Указывай конкретные файлы и их расположение (строки/локации). Ответ без источников НЕДОПУСТИМ!' : ''}
`;

    // 4. Секция КАК использовать
    const howToUse = `
## КАК использовать инструменты:

TOOL_CALL:
{
  "tool": "имя_инструмента",
  "arguments": {
    "параметр1": "значение1"
  }
}
END_TOOL_CALL

**ПРАВИЛА:**
1. Один блок TOOL_CALL для каждого вызова
2. Валидный JSON с двойными кавычками
3. Все обязательные параметры заполнены
4. Дожидайся TOOL_RESULT перед следующими действиями
${hasTavily ? '5. При необходимости поиска - СНАЧАЛА tavily-search, ПОТОМ действия' : ''}
`;

    // 5. Примеры с приоритетом для Tavily
    const examples = tools.slice(0, hasTavily ? 4 : 3).map(tool => {
      const required = tool.inputSchema.required || [];
      const properties = tool.inputSchema.properties || {};

      const exampleArgs: Record<string, unknown> = {};
      for (const paramName of required) {
        const paramSchema = properties[paramName];
        if (paramSchema) {
          if (tool.name === 'tavily-search' && paramName === 'query') {
            exampleArgs[paramName] = 'React 19 new features and migration guide';
          } else if (paramSchema.type === 'string') {
            exampleArgs[paramName] = `пример для ${paramName}`;
          } else if (paramSchema.type === 'number' || paramSchema.type === 'integer') {
            exampleArgs[paramName] = 42;
          } else if (paramSchema.type === 'boolean') {
            exampleArgs[paramName] = true;
          }
        }
      }

      const exampleJson = JSON.stringify({ tool: tool.name, arguments: exampleArgs }, null, 2);
      const userMessage = getExampleUserMessage(tool);

      return `Пример "${tool.name}" (${tool.serverName}):
User: "${userMessage}"
LLM: "Выполняю.

TOOL_CALL:
${exampleJson}
END_TOOL_CALL"`;
    }).join('\n\n');

    // 6. Множественные вызовы
    const multipleCallsInfo = `
**Множественные вызовы:**

TOOL_CALL:
{"tool": "first_tool", "arguments": {...}}
END_TOOL_CALL

TOOL_CALL:
{"tool": "second_tool", "arguments": {...}}
END_TOOL_CALL

**НЕ** придумывай несуществующие инструменты - используй только те, что указаны выше!
`;

    return `${basePrompt}

# ⚠️ ВНИМАНИЕ! У ТЕБЯ ЕСТЬ ДОСТУП К ИНСТРУМЕНТАМ!

Ты ОБЯЗАН использовать инструменты в формате TOOL_CALL, когда пользователь запрашивает действия с задачами, поиск информации или данные из внешних источников.

**НИКОГДА не отвечай текстом вместо вызова инструмента, если инструмент доступен!**

# ДОСТУПНЫЕ ИНСТРУМЕНТЫ

${toolsDescription}

${argumentExtractionInstructions}

${resultFormattingInstructions}

${pipelineInstructions}

${whenToUse}

${howToUse}

**ПРИМЕРЫ:**

${examples}

${multipleCallsInfo}

**ПОМНИ:** Результаты инструментов будут добавлены автоматически как TOOL_RESULT.
`;
  }, []);

  // Функция для парсинга запросов инструментов из ответа LLM
  const parseToolRequests = useCallback((llmResponse: string): ToolCallRequest[] => {
    // Regex для извлечения блоков TOOL_CALL ... END_TOOL_CALL
    // Поддерживает варианты: TOOL_CALL, TOOLCALL, TOOL CALL
    // И END_TOOL_CALL, END_TOOLCALL, ENDTOOLCALL, END TOOL CALL, END_TOOL CALL
    const toolCallPattern = /TOOL[\s_]?CALL:?\s*([\s\S]*?)\s*END[\s_]?TOOL[\s_]?CALL/gi;
    const toolCalls: ToolCallRequest[] = [];
    let match;

    while ((match = toolCallPattern.exec(llmResponse)) !== null) {
      const jsonString = match[1].trim();

      if (import.meta.env.DEV) {
        console.log('[parseToolRequests] Found TOOL_CALL block, JSON string:', jsonString);
      }

      try {
        const parsed = JSON.parse(jsonString);

        if (import.meta.env.DEV) {
          console.log('[parseToolRequests] Parsed JSON:', parsed);
        }

        // Валидация структуры
        if (typeof parsed === 'object' && parsed !== null && typeof parsed.tool === 'string') {
          const toolName = parsed.tool;
          let toolArgs = parsed.arguments;

          // Если arguments отсутствуют, считаем их пустым объектом.
          if (toolArgs === undefined) {
            toolArgs = {};
          }

          // Если arguments есть, но это не объект, это ошибка.
          if (typeof toolArgs !== 'object' || toolArgs === null) {
            console.warn(`[parseToolRequests] Invalid 'arguments' for tool '${toolName}'. Expected an object.`, parsed);
            continue; // Пропускаем этот вызов
          }

          const newToolCall: ToolCallRequest = {
            tool: toolName,
            arguments: toolArgs as Record<string, unknown>,
          };

          toolCalls.push(newToolCall);

          if (import.meta.env.DEV) {
            console.log('[parseToolRequests] Valid tool call added:', toolName);
          }
        } else {
          console.warn('[parseToolRequests] Invalid tool call structure:', parsed);
        }
      } catch (error) {
        console.warn('[parseToolRequests] Failed to parse tool call JSON:', jsonString, error);
      }
    }

    if (import.meta.env.DEV) {
      console.log('[parseToolRequests] Total tool calls found:', toolCalls.length);
    }

    return toolCalls;
  }, []);

  // Функция для валидации аргументов инструмента
  const validateToolArguments = (tool: MCPToolWithServer, args: Record<string, unknown>): string | null => {
    const required = tool.inputSchema.required || [];
    const properties = tool.inputSchema.properties || {};

    // Проверка обязательных параметров
    for (const paramName of required) {
      if (!(paramName in args) || args[paramName] === undefined || args[paramName] === null) {
        return `Отсутствует обязательный параметр: ${paramName}`;
      }
    }

    // Проверка типов параметров
    for (const [paramName, value] of Object.entries(args)) {
      // Для rag_data разрешаем параметр use_reranker, даже если его нет в схеме сервера
      if (tool.name === 'rag_data' && paramName === 'use_reranker') {
        // Проверяем только тип для use_reranker
        if (typeof value !== 'boolean') {
          return `Параметр ${paramName} должен быть boolean, получен ${typeof value}`;
        }
        continue; // Пропускаем дальнейшую валидацию для этого параметра
      }
      
      const paramSchema = properties[paramName];
      if (!paramSchema) {
        console.warn(`[validateToolArguments] Unknown parameter: ${paramName}`);
        continue;
      }

      const expectedType = paramSchema.type;
      const actualType = typeof value;

      if (expectedType === 'string' && actualType !== 'string') {
        return `Параметр ${paramName} должен быть string, получен ${actualType}`;
      }
      if ((expectedType === 'number' || expectedType === 'integer') && actualType !== 'number') {
        return `Параметр ${paramName} должен быть number, получен ${actualType}`;
      }
      if (expectedType === 'boolean' && actualType !== 'boolean') {
        return `Параметр ${paramName} должен быть boolean, получен ${actualType}`;
      }
    }

    return null; // Все валидно
  };

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

      // Получаем выбранные инструменты (только для описания в prompt)
      const selectedTools = mcpTools.filter(
        (tool) => mcpToolConfigs[tool.name]?.selected,
      );
      
      if (import.meta.env.DEV) {
        console.log('[handleSend] Selected tools:', selectedTools.map(t => t.name));
        console.log('[handleSend] Tool configs:', mcpToolConfigs);
      }

      // Строим system prompt с описанием инструментов
      const enhancedSystemPrompt = buildSystemPromptWithTools(systemPrompt, selectedTools);

      // Debug: логируем выбранные инструменты и system prompt
      if (import.meta.env.DEV) {
        console.log('[handleSend] Selected tools:', selectedTools.map(t => t.name));
        console.log('[handleSend] Enhanced system prompt length:', enhancedSystemPrompt.length);
        if (selectedTools.length > 0) {
          console.log('[handleSend] System prompt preview (first 500 chars):', enhancedSystemPrompt.substring(0, 500));
        }
      }

      // Первый запрос к LLM с описанием инструментов
      // Добавляем few-shot примеры ВСЕГДА, если есть выбранные инструменты
      let messagesToSendToAPI = getMessagesForAPI(baseMessages);

      if (selectedTools.length > 0) {
        // Базовые примеры для local tools
        const fewShotExamples: ChatMessage[] = [
          {
            role: 'user',
            content: 'Покажи список всех задач',
          },
          {
            role: 'assistant',
            content: `Сейчас проверю твои задачи.

TOOL_CALL:
{
  "tool": "get_pending_tasks",
  "arguments": {}
}
END_TOOL_CALL`,
          },
          {
            role: 'user',
            content: 'Добавь задачу: купить молоко',
          },
          {
            role: 'assistant',
            content: `Хорошо, добавляю задачу.

TOOL_CALL:
{
  "tool": "add_task",
  "arguments": {
    "title": "купить молоко"
  }
}
END_TOOL_CALL`,
          },
        ];

        // Добавляем пример tavily_search, если он доступен
        const hasTavily = selectedTools.some(t => t.name === 'tavily_search');
        if (hasTavily) {
          fewShotExamples.push(
            {
              role: 'user',
              content: 'Найди информацию о последних изменениях в TypeScript 5.5',
            },
            {
              role: 'assistant',
              content: `Сейчас найду актуальную информацию.

TOOL_CALL:
{
  "tool": "tavily_search",
  "arguments": {
    "query": "TypeScript 5.5 new features changes 2025"
  }
}
END_TOOL_CALL`,
            }
          );
        }

        // Добавляем пример rag_data, если он доступен
        const hasRag = selectedTools.some(t => t.name === 'rag_data');
        if (hasRag) {
          fewShotExamples.push(
            {
              role: 'user',
              content: 'Найди информацию о квантовых компьютерах',
            },
            {
              role: 'assistant',
              content: `Сейчас найду информацию.

TOOL_CALL:
{
  "tool": "rag_data",
  "arguments": {
    "query": "quantum computers principles applications"
  }
}
END_TOOL_CALL`,
            },
            {
              role: 'user',
              content: 'Как работает машинное обучение?',
            },
            {
              role: 'assistant',
              content: `Поищу информацию о машинном обучении.

TOOL_CALL:
{
  "tool": "rag_data",
  "arguments": {
    "query": "machine learning how it works algorithms"
  }
}
END_TOOL_CALL`,
            }
          );
        }

        // Вставляем few-shot примеры перед реальным сообщением пользователя
        messagesToSendToAPI = [...fewShotExamples, ...messagesToSendToAPI];

        if (import.meta.env.DEV) {
          console.log('[handleSend] Added few-shot examples, total messages:', messagesToSendToAPI.length);
        }
      }

      let firstResponse: string;
      let firstTokenUsage: TokenUsage | undefined;
      let firstTotalTokens: number | undefined;

      if (selectedModel.provider === 'gigachat') {
        const gigachatResponse = await sendGigaChatMessage(
          messagesToSendToAPI,
          enhancedSystemPrompt,
          temperature,
        );
        firstResponse = gigachatResponse.content;
        firstTokenUsage = gigachatResponse.tokenUsage;
      } else if (selectedModel.provider === 'openrouter') {
        const openRouterResponse = await sendOpenRouterMessage(
          messagesToSendToAPI,
          enhancedSystemPrompt,
          temperature,
        );
        firstResponse = openRouterResponse.content;
        firstTokenUsage = openRouterResponse.tokenUsage;
      } else {
        const hfResponse = await sendHuggingFaceMessage(
          messagesToSendToAPI,
          selectedModel.modelId as HuggingFaceModel,
          enhancedSystemPrompt,
          temperature,
        );
        firstResponse = hfResponse.content;
        firstTotalTokens = hfResponse.totalTokens;
      }

      // ЦИКЛ вызова инструментов - продолжаем, пока LLM генерирует TOOL_CALL
      let currentResponse = firstResponse;
      let currentMessages = [...baseMessages];
      let finalResponse = firstResponse;
      let finalTokenUsage = firstTokenUsage;
      let finalTotalTokens = firstTotalTokens;

      let iteration = 0;
      const MAX_ITERATIONS = 10; // Защита от бесконечного цикла

      while (iteration < MAX_ITERATIONS) {
        // Парсим текущий ответ на запросы инструментов
        const requestedToolCalls = parseToolRequests(currentResponse);

        if (requestedToolCalls.length === 0) {
          // Нет больше TOOL_CALL - выходим из цикла
          if (import.meta.env.DEV) {
            console.log(`[handleSend] No more tool calls found, finishing after ${iteration} iterations`);
          }
          break;
        }

        if (import.meta.env.DEV) {
          console.log(`[handleSend] Iteration ${iteration + 1}: Processing ${requestedToolCalls.length} tool calls`);
        }

        const toolResults: ChatMessage[] = [];

        for (const toolCall of requestedToolCalls) {
          const tool = selectedTools.find((t) => t.name === toolCall.tool);

          if (!tool) {
            if (import.meta.env.DEV) {
              console.warn(`[handleSend] Tool "${toolCall.tool}" not found in selected tools. Available:`, selectedTools.map(t => t.name));
            }
            toolResults.push({
              role: 'assistant',
              content: `TOOL_ERROR: ${toolCall.tool}\n\nИнструмент не найден или не активирован. Доступные инструменты: ${selectedTools.map(t => t.name).join(', ')}`,
            });
            continue;
          }
          
          if (import.meta.env.DEV) {
            console.log(`[handleSend] Processing tool call for "${tool.name}"`);
          }

          try {
            // Объединяем аргументы из конфига с аргументами из AI ответа
            const toolConfig = mcpToolConfigs[tool.name] || { selected: false, args: {} };
            
            // Начинаем с аргументов из AI
            const mergedArgs = { ...toolCall.arguments };
            
            // Для rag_data добавляем use_reranker из конфига, если он задан
            // (этот параметр не приходит от сервера, но нужен для работы)
            if (tool.name === 'rag_data' && toolConfig.args?.use_reranker !== undefined) {
              mergedArgs.use_reranker = toolConfig.args.use_reranker;
            }

            // Валидация аргументов (пропускаем проверку для use_reranker в rag_data)
            const validationError = validateToolArguments(tool, mergedArgs);
            if (validationError) {
              toolResults.push({
                role: 'assistant',
                content: `TOOL_ERROR: ${tool.name}\n\n${validationError}`,
              });
              continue;
            }

            // Вызов инструмента с объединенными аргументами
            if (import.meta.env.DEV) {
              console.log(`[handleSend] Calling tool "${tool.name}" with args:`, mergedArgs);
            }
            const rawResult = await callMCPTool(tool.name, mergedArgs);
            const prettyJson = JSON.stringify(rawResult, null, 2);

            toolResults.push({
              role: 'assistant',
              content: [
                `TOOL_RESULT: ${tool.name}`,
                '',
                'ARGUMENTS:',
                '```json',
                JSON.stringify(toolCall.arguments, null, 2),
                '```',
                '',
                'RESULT:',
                '```json',
                prettyJson,
                '```',
              ].join('\n'),
            });
          } catch (toolError) {
            const message =
              toolError instanceof Error
                ? toolError.message
                : `Failed to execute MCP tool "${tool.name}"`;

            toolResults.push({
              role: 'assistant',
              content: `TOOL_ERROR: ${tool.name}\n\n${message}`,
            });
          }
        }

        // Добавляем текущий ответ и результаты инструментов в контекст
        currentMessages = [
          ...currentMessages,
          {
            role: 'assistant',
            content: currentResponse,
          },
          ...toolResults,
        ];

        // Следующий запрос к LLM с результатами инструментов
        const messagesWithToolResults = getMessagesForAPI(currentMessages);

        if (selectedModel.provider === 'gigachat') {
          const gigachatResponse = await sendGigaChatMessage(
            messagesWithToolResults,
            enhancedSystemPrompt,
            temperature,
          );
          currentResponse = gigachatResponse.content;
          finalTokenUsage = gigachatResponse.tokenUsage;
        } else if (selectedModel.provider === 'openrouter') {
          const openRouterResponse = await sendOpenRouterMessage(
            messagesWithToolResults,
            enhancedSystemPrompt,
            temperature,
          );
          currentResponse = openRouterResponse.content;
          finalTokenUsage = openRouterResponse.tokenUsage;
        } else {
          const hfResponse = await sendHuggingFaceMessage(
            messagesWithToolResults,
            selectedModel.modelId as HuggingFaceModel,
            enhancedSystemPrompt,
            temperature,
          );
          currentResponse = hfResponse.content;
          finalTotalTokens = hfResponse.totalTokens;
        }

        iteration++;
      }

      // Финальный ответ и сообщения
      finalResponse = currentResponse;
      const messagesWithTools = currentMessages;

      const endTime = performance.now();
      const duration = endTime - startTime;

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: finalResponse,
        totalTokens: finalTotalTokens,
        tokenUsage: finalTokenUsage,
        duration,
      };

      const messagesWithAssistant = [...messagesWithTools, assistantMessage];
      setMessages(messagesWithAssistant);

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
  const handleAutoGenerateSummary = useCallback(async () => {
    console.log('Auto-generating task summary...');

    const summaryPrompt = 'Пожалуйста, проанализируй текущие невыполненные задачи и создай ежедневное саммари.';

    // Используем существующую функцию handleSend
    await handleSend(summaryPrompt);

    console.log('Auto-summary generation completed');
  }, [messages, isLoading, mcpTools, mcpToolConfigs, systemPrompt, selectedModel, temperature, assistantResponseCount]);

  // Подключаем hook для автоматической обработки задач от планировщика
  useAgentTasks({
    onGenerateSummary: handleAutoGenerateSummary,
    enabled: true,
  });

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
          {summaries.length > 0 && (
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
          )}

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



