import type { ChatMessage, ModelConfig } from './gigachat';

export interface SavedConversation {
  id: string;
  title: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  systemPrompt: string;
  messages: ChatMessage[];
  modelConfig: ModelConfig;
  temperature: number;
  assistantResponseCount: number;
}
