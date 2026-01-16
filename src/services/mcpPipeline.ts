import type { PipelineStep, PipelineResult } from '../types/pipeline';
import type { ModelConfig, ChatMessage } from '../types/gigachat';
import { callMCPTool } from './mcp';
import { sendMessage as sendGigaChatMessage } from './gigachat';
import { sendMessage as sendHuggingFaceMessage } from './huggingface';
import { sendMessage as sendOpenRouterMessage } from './openrouter';
import {
  parsePriorityFromResponse,
  formatTasksForLLM,
  buildRecommendationsInput,
  mapPriorityToString,
} from '../utils/pipelineHelpers';

// Pipeline configuration constants
const PIPELINE_CONFIG = {
  PRIORITY_DEFAULT: 3,
  TIMEOUT_PER_STEP: 10000, // 10 seconds
  TEMPERATURE_PRIORITY: 0.3,
  TEMPERATURE_SUMMARY: 0.5,
  TEMPERATURE_RECOMMENDATIONS: 0.7,
  RAG_RERANKER: true,
};

// System prompts for different pipeline steps
const PRIORITY_EXTRACTION_PROMPT = `Ты - аналитик приоритетов задач. Твоя задача - определить приоритет на основе сообщения пользователя.

ПРАВИЛА:
- Анализируй сообщение пользователя и определи приоритет от 1 до 5
- 1 = критический, срочный
- 2 = высокий приоритет
- 3 = средний приоритет
- 4 = низкий приоритет
- 5 = минимальный приоритет, рутина
- Если приоритет не очевиден, используй 3 (средний)
- Верни ТОЛЬКО число от 1 до 5, без дополнительного текста`;

const TASK_SUMMARIZATION_PROMPT = `Ты - аналитик задач. Твоя задача - создать краткое резюме списка задач.

ПРАВИЛА:
- Суммируй основные задачи и их статусы
- Выдели ключевые проблемы и приоритеты
- Используй структурированный формат (маркированный список)
- Максимум 5-7 предложений
- Если задач нет, так и напиши`;

const RECOMMENDATIONS_PROMPT = `Ты - эксперт по управлению задачами и анализу данных. Твоя задача - дать пользователю конкретные рекомендации на основе доступных данных.

КОНТЕКСТ:
Ты имеешь доступ к трём источникам информации:
1. **Сообщение пользователя** - что пользователь хочет узнать или сделать
2. **Задачи из системы** - текущие задачи с указанными приоритетами
3. **База знаний (RAG)** - релевантная документация и справочная информация

ТВОЯ ЗАДАЧА:
Проанализировать все данные и дать 3-5 конкретных, практичных рекомендаций о том, с чего начать работу.

ПРАВИЛА:
- Приоритизируй задачи по срочности и важности
- Используй данные из базы знаний для обоснования рекомендаций
- Будь конкретным: не "посмотри на задачи", а "начни с задачи X, потому что Y"
- Учитывай взаимосвязи между задачами
- Если задач нет или данных мало, предложи общие рекомендации
- Формат ответа: нумерованный список рекомендаций
- Каждая рекомендация: одно предложение + краткое обоснование
- Не повторяй очевидное, фокусируйся на действиях
- Если видишь критические задачи, выдели их явно

ПРИМЕР ФОРМАТА ОТВЕТА:
1. **Начните с задачи "Исправить критический баг в API"** - это задача приоритета 1, блокирует работу команды
2. **Ознакомьтесь с документацией по модулю auth** - в базе знаний есть актуальная информация по этой теме
3. **Запланируйте код-ревью для задачи "Новая фича"** - она находится в статусе "Готово к ревью"

Теперь проанализируй предоставленные данные и дай свои рекомендации.`;

/**
 * Call LLM with timeout support
 */
async function callLLMWithTimeout(
  messages: ChatMessage[],
  modelConfig: ModelConfig,
  systemPrompt: string,
  temperature: number,
  timeout: number
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LLM call timeout')), timeout)
  );

  const llmPromise = (async () => {
    let response;

    switch (modelConfig.provider) {
      case 'gigachat':
        response = await sendGigaChatMessage(messages, systemPrompt, temperature);
        break;
      case 'huggingface':
        response = await sendHuggingFaceMessage(
          messages,
          modelConfig.modelId as import('../types/gigachat').HuggingFaceModel,
          systemPrompt,
          temperature
        );
        break;
      case 'openrouter':
        response = await sendOpenRouterMessage(messages, systemPrompt, temperature);
        break;
      default:
        throw new Error(`Unknown provider: ${modelConfig.provider}`);
    }

    return response.content;
  })();

  return Promise.race([llmPromise, timeoutPromise]);
}

/**
 * Step 1: Extract priority from user message using LLM
 */
async function extractPriority(
  userMessage: string,
  modelConfig: ModelConfig,
  onProgress?: (step: PipelineStep, status: 'running' | 'complete' | 'error') => void
): Promise<{ priority: number; error?: string }> {
  if (onProgress) onProgress('priority_extraction', 'running');

  try {
    const messages: ChatMessage[] = [
      { role: 'user', content: userMessage },
    ];

    const response = await callLLMWithTimeout(
      messages,
      modelConfig,
      PRIORITY_EXTRACTION_PROMPT,
      PIPELINE_CONFIG.TEMPERATURE_PRIORITY,
      PIPELINE_CONFIG.TIMEOUT_PER_STEP
    );

    const priority = parsePriorityFromResponse(response);

    if (import.meta.env.DEV) {
      console.log('[Pipeline] Priority extraction result:', { response, priority });
    }

    if (onProgress) onProgress('priority_extraction', 'complete');
    return { priority };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Pipeline] Priority extraction error:', errorMessage);

    if (onProgress) onProgress('priority_extraction', 'error');
    return { priority: PIPELINE_CONFIG.PRIORITY_DEFAULT, error: errorMessage };
  }
}

/**
 * Step 2: Fetch tasks with priority from mcp_tasks server
 */
async function fetchTasksWithPriority(
  priority: number,
  onProgress?: (step: PipelineStep, status: 'running' | 'complete' | 'error') => void
): Promise<{ tasksData: unknown; error?: string }> {
  if (onProgress) onProgress('task_fetch', 'running');

  try {
    // Convert numeric priority to string for mcp_tasks server
    const priorityString = mapPriorityToString(priority);

    if (import.meta.env.DEV) {
      console.log(`[Pipeline] Mapped priority ${priority} → "${priorityString}"`);
    }

    const tasksData = await callMCPTool(
      'get_task_with_priority',
      { priority: priorityString },
      'mcp_tasks'
    );

    if (import.meta.env.DEV) {
      console.log('[Pipeline] Tasks fetch result:', tasksData);
    }

    if (onProgress) onProgress('task_fetch', 'complete');
    return { tasksData };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Pipeline] Tasks fetch error:', errorMessage);

    if (onProgress) onProgress('task_fetch', 'error');
    return { tasksData: null, error: errorMessage };
  }
}

/**
 * Step 3: Summarize tasks using LLM
 */
async function summarizeTasks(
  tasksData: unknown,
  modelConfig: ModelConfig,
  onProgress?: (step: PipelineStep, status: 'running' | 'complete' | 'error') => void
): Promise<{ tasksSummary: string; error?: string }> {
  if (onProgress) onProgress('task_summarization', 'running');

  // Skip if no tasks data
  if (!tasksData) {
    if (onProgress) onProgress('task_summarization', 'complete');
    return { tasksSummary: 'Задачи отсутствуют' };
  }

  try {
    const formattedTasks = formatTasksForLLM(tasksData);

    const messages: ChatMessage[] = [
      { role: 'user', content: formattedTasks },
    ];

    const tasksSummary = await callLLMWithTimeout(
      messages,
      modelConfig,
      TASK_SUMMARIZATION_PROMPT,
      PIPELINE_CONFIG.TEMPERATURE_SUMMARY,
      PIPELINE_CONFIG.TIMEOUT_PER_STEP
    );

    if (import.meta.env.DEV) {
      console.log('[Pipeline] Tasks summarization result:', tasksSummary);
    }

    if (onProgress) onProgress('task_summarization', 'complete');
    return { tasksSummary };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Pipeline] Tasks summarization error:', errorMessage);

    // Fallback to formatted tasks
    const tasksSummary = formatTasksForLLM(tasksData);

    if (onProgress) onProgress('task_summarization', 'error');
    return { tasksSummary, error: errorMessage };
  }
}

/**
 * Step 4: Query RAG with summary
 */
async function queryRAG(
  tasksSummary: string,
  onProgress?: (step: PipelineStep, status: 'running' | 'complete' | 'error') => void
): Promise<{ ragResults: unknown; error?: string }> {
  if (onProgress) onProgress('rag_query', 'running');

  try {
    const ragResults = await callMCPTool(
      'rag_data',
      { query: tasksSummary, use_reranker: PIPELINE_CONFIG.RAG_RERANKER },
      'rag'
    );

    if (import.meta.env.DEV) {
      console.log('[Pipeline] RAG query result:', ragResults);
    }

    if (onProgress) onProgress('rag_query', 'complete');
    return { ragResults };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Pipeline] RAG query error:', errorMessage);

    if (onProgress) onProgress('rag_query', 'error');
    return { ragResults: null, error: errorMessage };
  }
}

/**
 * Step 5: Generate recommendations combining all data
 */
async function generateRecommendations(
  userMessage: string,
  tasksData: unknown,
  ragResults: unknown,
  modelConfig: ModelConfig,
  onProgress?: (step: PipelineStep, status: 'running' | 'complete' | 'error') => void
): Promise<{ recommendations: string; error?: string }> {
  if (onProgress) onProgress('recommendation_generation', 'running');

  try {
    const inputMessage = buildRecommendationsInput(userMessage, tasksData, ragResults);

    const messages: ChatMessage[] = [
      { role: 'user', content: inputMessage },
    ];

    const recommendations = await callLLMWithTimeout(
      messages,
      modelConfig,
      RECOMMENDATIONS_PROMPT,
      PIPELINE_CONFIG.TEMPERATURE_RECOMMENDATIONS,
      PIPELINE_CONFIG.TIMEOUT_PER_STEP
    );

    if (import.meta.env.DEV) {
      console.log('[Pipeline] Recommendations result:', recommendations);
    }

    if (onProgress) onProgress('recommendation_generation', 'complete');
    return { recommendations };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Pipeline] Recommendations generation error:', errorMessage);

    // Generate fallback recommendations
    const recommendations = 'На основе ваших задач рекомендую начать с приоритетных задач и обратиться к доступной документации.';

    if (onProgress) onProgress('recommendation_generation', 'error');
    return { recommendations, error: errorMessage };
  }
}

/**
 * Main pipeline executor
 * Orchestrates all 5 steps and returns combined result
 */
export async function executePipeline(
  userMessage: string,
  modelConfig: ModelConfig,
  _temperature: number,
  onProgress?: (step: PipelineStep, status: 'running' | 'complete' | 'error') => void
): Promise<PipelineResult> {
  const errors: Array<{ step: PipelineStep; error: string }> = [];

  if (import.meta.env.DEV) {
    console.log('[Pipeline] Starting execution for message:', userMessage);
  }

  // Step 1: Extract priority
  const { priority, error: priorityError } = await extractPriority(
    userMessage,
    modelConfig,
    onProgress
  );

  if (priorityError) {
    errors.push({ step: 'priority_extraction', error: priorityError });
  }

  // Step 2: Fetch tasks
  const { tasksData, error: tasksError } = await fetchTasksWithPriority(
    priority,
    onProgress
  );

  if (tasksError) {
    errors.push({ step: 'task_fetch', error: tasksError });
  }

  // Step 3: Summarize tasks
  const { tasksSummary, error: summaryError } = await summarizeTasks(
    tasksData,
    modelConfig,
    onProgress
  );

  if (summaryError) {
    errors.push({ step: 'task_summarization', error: summaryError });
  }

  // Step 4: Query RAG
  const { ragResults, error: ragError } = await queryRAG(tasksSummary, onProgress);

  if (ragError) {
    errors.push({ step: 'rag_query', error: ragError });
  }

  // Step 5: Generate recommendations
  const { recommendations, error: recommendationsError } = await generateRecommendations(
    userMessage,
    tasksData,
    ragResults,
    modelConfig,
    onProgress
  );

  if (recommendationsError) {
    errors.push({ step: 'recommendation_generation', error: recommendationsError });
  }

  const result: PipelineResult = {
    success: errors.length === 0,
    priority,
    tasksData,
    tasksSummary,
    ragResults,
    recommendations,
    errors,
  };

  if (import.meta.env.DEV) {
    console.log('[Pipeline] Execution complete:', result);
  }

  return result;
}
