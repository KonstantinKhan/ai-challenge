export type PipelineStep =
  | 'priority_extraction'
  | 'task_fetch'
  | 'task_summarization'
  | 'rag_query'
  | 'recommendation_generation';

export interface PipelineStepStatus {
  step: PipelineStep;
  status: 'pending' | 'running' | 'complete' | 'error';
  error?: string;
}

export interface PipelineResult {
  success: boolean;
  priority?: number;
  tasksData?: unknown;
  tasksSummary?: string;
  ragResults?: unknown;
  recommendations?: string;
  errors: Array<{ step: PipelineStep; error: string }>;
}

export interface PipelineConfig {
  enabled: boolean;
  ragReranker: boolean;  // Always true
}
