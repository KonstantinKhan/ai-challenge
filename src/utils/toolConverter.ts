import type { MCPToolWithServer } from '../types/mcp';
import type { Tool } from '../types/tool';
import type { FewShot } from '../types/fewshot';

/**
 * Конвертирует MCP инструмент в формат GigaChat Tool
 */
export function convertMCPToolToGigaChatTool(mcpTool: MCPToolWithServer): Tool {
  // Генерируем few-shot примеры на основе имени инструмента
  const fewShotExamples = generateFewShotExamples(mcpTool);

  // Для rag_data используем специфичное определение параметров
  let parameters;
  if (mcpTool.name === 'rag_data') {
    parameters = {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'User query'
        },
        use_reranker: {
          type: 'boolean',
          description: 'Flag indicating whether to apply reranking to RAG results'
        },
      },
      required: ['query'],
    };
  } else {
    // Преобразуем inputSchema в требуемый формат
    parameters = {
      type: mcpTool.inputSchema.type || 'object',
      properties: mcpTool.inputSchema.properties || {},
      required: mcpTool.inputSchema.required || [],
    };
  }

  // Преобразуем outputSchema в требуемый формат
  // Для rag_data используем специфичную структуру возврата, соответствующую ответу RAG сервера
  const returnParameters = mcpTool.name === 'rag_data' ? {
    type: 'object',
    properties: {
      content: {
        type: 'array',
        description: 'Array of content items returned by RAG',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Type of content (e.g., text, image)'
            },
            text: {
              type: 'string',
              description: 'Text content'
            }
          },
          required: ['type', 'text']
        }
      }
    },
    required: ['content']
  } : mcpTool.outputSchema ? {
    type: mcpTool.outputSchema.type || 'object',
    properties: mcpTool.outputSchema.properties || {},
    required: mcpTool.outputSchema.required || [],
  } : {
    type: 'object',
    properties: {},
    required: [],
  };

  return {
    name: mcpTool.name,
    description: mcpTool.name === 'rag_data'
      ? 'Returns data from RAG'
      : (mcpTool.description || `Инструмент: ${mcpTool.name}`),
    parameters,
    few_shot_examples: fewShotExamples,
    return_parameters: returnParameters,
  };
}

/**
 * Генерирует few-shot примеры для конкретных инструментов
 */
function generateFewShotExamples(tool: MCPToolWithServer): FewShot[] {
  const examples: Record<string, FewShot[]> = {
    'rag_data': [
      {
        request: 'What is a coroutine?',
        params: { query: 'What is a coroutine?' }
      }
    ],
  };

  return examples[tool.name] || [
    {
      request: `Используй ${tool.name}`,
      params: {}
    }
  ];
}

/**
 * Конвертирует массив MCP инструментов в массив GigaChat Tools
 */
export function convertMCPToolsToGigaChatTools(mcpTools: MCPToolWithServer[]): Tool[] {
  return mcpTools.map(convertMCPToolToGigaChatTool);
}
