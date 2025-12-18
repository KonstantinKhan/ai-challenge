export interface SummariesConnectionCallbacks {
  onSummary: (id: string, text: string) => void;
  onError?: (error: Event) => void;
}

export interface SummariesConnection {
  close: () => void;
}

/**
 * Создает SSE соединение для получения summaries
 */
export function createSummariesConnection(
  callbacks: SummariesConnectionCallbacks
): SummariesConnection {
  const eventSource = new EventSource('/api/summaries/stream');

  // Обработка события new_summary
  eventSource.addEventListener('new_summary', (event: MessageEvent) => {
    const summaryId = event.lastEventId || '';
    const summaryText = event.data || '';

    if (summaryId && summaryText) {
      callbacks.onSummary(summaryId, summaryText);
    }
  });

  // Обработка heartbeat (игнорируем, но логируем в dev режиме)
  eventSource.addEventListener('heartbeat', () => {
    if (import.meta.env.DEV) {
      console.debug('[SSE] Heartbeat received');
    }
  });

  // Обработка ошибок
  eventSource.onerror = (error) => {
    if (callbacks.onError) {
      callbacks.onError(error);
    } else {
      console.error('[SSE] Connection error:', error);
    }
    // EventSource автоматически переподключается при ошибках
  };

  return {
    close: () => {
      eventSource.close();
    },
  };
}
