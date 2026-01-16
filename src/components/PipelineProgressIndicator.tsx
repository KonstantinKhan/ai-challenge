import type { PipelineStepStatus } from '../types/pipeline';

interface PipelineProgressIndicatorProps {
  steps: PipelineStepStatus[];
  onClose?: () => void;
}

// Step labels in Russian
const STEP_LABELS: Record<string, string> = {
  priority_extraction: 'Извлечение приоритета',
  task_fetch: 'Получение задач',
  task_summarization: 'Суммаризация задач',
  rag_query: 'Запрос в базу знаний',
  recommendation_generation: 'Генерация рекомендаций',
};

// Status icons
const StatusIcon = ({ status }: { status: PipelineStepStatus['status'] }) => {
  switch (status) {
    case 'pending':
      return <span className="text-gray-400 text-lg">○</span>;
    case 'running':
      return (
        <span className="inline-block animate-spin text-blue-500 text-lg">⟳</span>
      );
    case 'complete':
      return <span className="text-green-500 text-lg">✓</span>;
    case 'error':
      return <span className="text-red-500 text-lg">✗</span>;
    default:
      return null;
  }
};

// Get CSS class based on status
const getStepClassName = (status: PipelineStepStatus['status']): string => {
  switch (status) {
    case 'pending':
      return 'text-gray-500';
    case 'running':
      return 'text-blue-600 font-medium';
    case 'complete':
      return 'text-green-700';
    case 'error':
      return 'text-red-600';
    default:
      return 'text-gray-500';
  }
};

export default function PipelineProgressIndicator({
  steps,
  onClose,
}: PipelineProgressIndicatorProps) {
  return (
    <div className="flex justify-center mb-4">
      <div className="bg-purple-50 border border-purple-200 rounded-lg px-6 py-4 max-w-md w-full">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-purple-900">
            Выполнение MCP Pipeline
          </h3>
          {onClose && (
            <button
              onClick={onClose}
              className="text-purple-400 hover:text-purple-600 text-sm"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>
        <div className="space-y-2">
          {steps.map(({ step, status, error }) => (
            <div key={step} className="flex items-center gap-3 text-sm">
              <StatusIcon status={status} />
              <span className={getStepClassName(status)}>
                {STEP_LABELS[step] || step}
              </span>
              {error && (
                <span className="text-red-600 text-xs truncate max-w-[200px]" title={error}>
                  ({error})
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
