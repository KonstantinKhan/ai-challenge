import { useEffect, useRef } from 'react';
import {
  getPendingAgentTasks,
  completeAgentTask,
  failAgentTask,
  type AgentTask,
} from '../services/agentTasks';

interface UseAgentTasksParams {
  /**
   * Функция для выполнения задачи "generate_summary"
   * Должна вызвать агента с промптом для генерации саммари
   */
  onGenerateSummary: () => Promise<void>;

  /**
   * Включить автоматическую обработку задач при загрузке
   */
  enabled?: boolean;
}

export function useAgentTasks({
  onGenerateSummary,
  enabled = true,
}: UseAgentTasksParams) {
  const processedTaskIds = useRef(new Set<number>());

  useEffect(() => {
    if (!enabled) return;

    async function checkAndProcessTasks() {
      try {
        const tasks = await getPendingAgentTasks();

        for (const task of tasks) {
          // Пропускаем уже обработанные задачи
          if (processedTaskIds.current.has(task.id)) {
            continue;
          }

          // Отмечаем как обрабатываемую
          processedTaskIds.current.add(task.id);

          await processTask(task);
        }
      } catch (error) {
        console.error('Error checking agent tasks:', error);
      }
    }

    async function processTask(task: AgentTask) {
      console.log(`Processing agent task: ${task.type} (ID: ${task.id})`);

      try {
        if (task.type === 'generate_summary') {
          // Вызываем функцию для генерации саммари
          await onGenerateSummary();

          // Отмечаем задачу как выполненную
          await completeAgentTask(task.id);
          console.log(`Task ${task.id} completed successfully`);
        } else {
          console.warn(`Unknown task type: ${task.type}`);
          await failAgentTask(task.id, `Unknown task type: ${task.type}`);
        }
      } catch (error) {
        console.error(`Error processing task ${task.id}:`, error);

        // Отмечаем задачу как failed
        const errorMessage = error instanceof Error ? error.message : String(error);
        await failAgentTask(task.id, errorMessage);
      }
    }

    // Проверяем задачи при монтировании
    checkAndProcessTasks();

    // Опционально: периодическая проверка (каждые 60 секунд)
    const interval = setInterval(checkAndProcessTasks, 60_000);

    return () => clearInterval(interval);
  }, [enabled, onGenerateSummary]);
}
