import { sendMessage as sendGigaChatMessage } from './gigachat';
import { sendMessage as sendOpenRouterMessage } from './openrouter';
import { sendMessage as sendHuggingFaceMessage } from './huggingface';
import type { ChatMessage, ModelConfig, HuggingFaceModel } from '../types/gigachat';

export const SUMMARY_MARKER = '[CONVERSATION SUMMARY]';

const COMPRESSION_SYSTEM_PROMPT = `Ты - система сжатия диалогов. Твоя задача - создать краткое резюме истории разговора, сохраняя всю критически важную информацию.

ПРАВИЛА:
- Сохраняй ключевые факты, решения и контекст
- Соблюдай хронологический порядок событий
- Используй чёткий, структурированный формат
- Если существует предыдущее резюме, интегрируй новые сообщения с ним
- Выводи ТОЛЬКО текст резюме, без метаданных или маркеров`;

/**
 * Filters messages to send to API
 * If compression has happened, returns [summary + last 2 messages]
 * Otherwise returns all messages
 */
export function getMessagesForAPI(messages: ChatMessage[]): ChatMessage[] {
  const summary = messages.find(msg =>
    msg.role === 'system' && msg.content.startsWith(SUMMARY_MARKER)
  );

  if (summary) {
    // Compression has happened - send only summary + last 2 non-summary messages
    const nonSummaryMessages = messages.filter(msg =>
      !(msg.role === 'system' && msg.content.startsWith(SUMMARY_MARKER))
    );
    const last2 = nonSummaryMessages.slice(-2);
    return [summary, ...last2];
  } else {
    // No compression yet - send all messages
    return messages;
  }
}

interface CompressionExtraction {
  previousSummary: string | null;
  messagesToCompress: ChatMessage[];
  messagesToKeep: ChatMessage[];
}

function extractMessagesForCompression(messages: ChatMessage[]): CompressionExtraction {
  // Step 1: Filter out all system role messages with SUMMARY_MARKER
  const nonSummaryMessages = messages.filter(msg =>
    !(msg.role === 'system' && msg.content.startsWith(SUMMARY_MARKER))
  );

  // Step 2: Find the most recent summary (if any) from original messages array
  const summaries = messages.filter(msg =>
    msg.role === 'system' && msg.content.startsWith(SUMMARY_MARKER)
  );
  const previousSummary = summaries.length > 0
    ? summaries[summaries.length - 1].content.replace(SUMMARY_MARKER + '\n', '')
    : null;

  // Step 3: Keep last 2 messages (1 user + 1 assistant pair)
  const messagesToKeep = nonSummaryMessages.slice(-2);

  // Step 4: Everything else gets compressed
  const messagesToCompress = nonSummaryMessages.slice(0, -2);

  // Validation: Need at least some messages to compress
  if (messagesToCompress.length === 0) {
    throw new Error('Insufficient messages for compression');
  }

  return { previousSummary, messagesToCompress, messagesToKeep };
}

function buildCompressionPrompt(
  previousSummary: string | null,
  messagesToCompress: ChatMessage[]
): ChatMessage[] {
  if (previousSummary) {
    // Cumulative compression: combine previous summary + new messages
    return [
      {
        role: 'user' as const,
        content: `Предыдущее резюме разговора:
${previousSummary}

Новые сообщения для интеграции:
${messagesToCompress.map((m, i) => `${i + 1}. [${m.role}]: ${m.content}`).join('\n')}

Пожалуйста, создай обновлённое резюме, которое интегрирует предыдущее резюме с этими новыми сообщениями.`
      }
    ];
  } else {
    // First compression: no previous summary
    return [
      {
        role: 'user' as const,
        content: `Разговор для суммаризации:
${messagesToCompress.map((m, i) => `${i + 1}. [${m.role}]: ${m.content}`).join('\n')}

Пожалуйста, создай краткое резюме этого разговора.`
      }
    ];
  }
}

export async function compressMessages(
  messages: ChatMessage[],
  selectedModel: ModelConfig
): Promise<ChatMessage> {
  // Extract messages
  const { previousSummary, messagesToCompress } =
    extractMessagesForCompression(messages);

  // Build compression prompt
  const compressionMessages = buildCompressionPrompt(
    previousSummary,
    messagesToCompress
  );

  // Call appropriate service based on provider
  let summaryContent: string;

  try {
    if (selectedModel.provider === 'gigachat') {
      const response = await sendGigaChatMessage(
        compressionMessages,
        COMPRESSION_SYSTEM_PROMPT,
        0.3 // Lower temperature for more focused summarization
      );
      summaryContent = response.content;
    } else if (selectedModel.provider === 'openrouter') {
      const response = await sendOpenRouterMessage(
        compressionMessages,
        COMPRESSION_SYSTEM_PROMPT,
        0.3
      );
      summaryContent = response.content;
    } else {
      const response = await sendHuggingFaceMessage(
        compressionMessages,
        selectedModel.modelId as HuggingFaceModel,
        COMPRESSION_SYSTEM_PROMPT,
        0.3
      );
      summaryContent = response.content;
    }

    // Create summary message with marker
    return {
      role: 'system',
      content: `${SUMMARY_MARKER}\n${summaryContent}`
    };
  } catch (error) {
    console.error('Compression failed:', error);
    throw new Error(`Failed to compress conversation: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
