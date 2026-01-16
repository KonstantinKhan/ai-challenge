/**
 * Parse priority from LLM response
 * Handles various formats like "3", "Priority: 3", "Приоритет 3", etc.
 * Returns a number between 1-5, defaults to 3 on error
 */
export function parsePriorityFromResponse(response: string): number {
  // Clean the response
  const cleaned = response.trim().toLowerCase();

  // Try to extract number using regex
  const match = cleaned.match(/(\d+)/);

  if (match) {
    const priority = parseInt(match[1], 10);
    // Validate priority is between 1-5
    if (priority >= 1 && priority <= 5) {
      return priority;
    }
  }

  // Default to medium priority
  return 3;
}

/**
 * Format tasks data for LLM consumption
 * Converts tasks object/array to readable string format
 */
export function formatTasksForLLM(tasksData: unknown): string {
  if (!tasksData) {
    return 'Задачи отсутствуют';
  }

  try {
    // Try to format as JSON with indentation
    const formatted = JSON.stringify(tasksData, null, 2);

    // Truncate if too long (max 5000 chars)
    if (formatted.length > 5000) {
      return formatted.substring(0, 5000) + '\n... (truncated)';
    }

    return formatted;
  } catch (error) {
    // Fallback to string conversion
    return String(tasksData);
  }
}

/**
 * Format RAG results for LLM consumption
 * Handles the nested RAG response structure
 */
export function formatRAGResultsForLLM(ragResults: unknown): string {
  if (!ragResults) {
    return 'Данные из базы знаний отсутствуют';
  }

  try {
    // Check if it has the content array structure
    if (
      typeof ragResults === 'object' &&
      ragResults !== null &&
      'content' in ragResults &&
      Array.isArray((ragResults as any).content)
    ) {
      const content = (ragResults as any).content;

      // Extract text from content array
      const texts = content
        .filter((item: any) => item.type === 'text' && item.text)
        .map((item: any) => item.text)
        .join('\n\n');

      if (texts) {
        // Truncate if too long (max 5000 chars)
        if (texts.length > 5000) {
          return texts.substring(0, 5000) + '\n... (truncated)';
        }
        return texts;
      }
    }

    // Fallback to JSON format
    const formatted = JSON.stringify(ragResults, null, 2);

    // Truncate if too long
    if (formatted.length > 5000) {
      return formatted.substring(0, 5000) + '\n... (truncated)';
    }

    return formatted;
  } catch (error) {
    return String(ragResults);
  }
}

/**
 * Build structured input message for recommendations LLM call
 * Combines user message, tasks data, and RAG results
 */
export function buildRecommendationsInput(
  userMessage: string,
  tasksData: unknown,
  ragResults: unknown
): string {
  const parts: string[] = [];

  // User message section
  parts.push('## Сообщение пользователя:');
  parts.push(userMessage);
  parts.push('');

  // Tasks section
  parts.push('## Задачи из системы:');
  parts.push(formatTasksForLLM(tasksData));
  parts.push('');

  // RAG section
  parts.push('## Данные из базы знаний:');
  parts.push(formatRAGResultsForLLM(ragResults));
  parts.push('');

  return parts.join('\n');
}

/**
 * Map numeric priority (1-5) to string value for mcp_tasks server
 * @param priority - Numeric priority from LLM (1-5)
 * @returns String priority for server ("HIGH", "MEDIUM", "LOW")
 */
export function mapPriorityToString(priority: number): string {
  // Map 5 levels to 3 values
  if (priority <= 2) {
    return 'HIGH';     // 1 (критический), 2 (высокий)
  } else if (priority === 3) {
    return 'MEDIUM';   // 3 (средний)
  } else {
    return 'LOW';      // 4 (низкий), 5 (минимальный)
  }
}
