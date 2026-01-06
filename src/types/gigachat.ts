import type { Tool } from "./tool";

export interface OAuthResponse {
  access_token: string;
  expires_at: number; // unix timestamp в миллисекундах
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  precached_prompt_tokens?: number;
  total_tokens: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  totalTokens?: number;
  tokenUsage?: TokenUsage;
  duration?: number;
  functions_state_id?: string;
  attachments?: string[][];
}

export interface ChatRequest {
  model: string; // Модель может быть 'GigaChat', 'GigaChat:latest', 'GigaChat-Pro-preview', и т.д.
  messages: ChatMessage[];
  temperature?: number;
  functions?: Tool[];
  top_p?: number;
  stream?: boolean;
  max_tokens?: number;
  repetition_penalty?: number;
  update_interval?: number;
  function_call?: 'none' | 'auto' | {
    name: string;
  };
}

export interface ChatChoice {
  message: {
    content: string;
    role: 'assistant';
    function_call?: {
      name: string;
      arguments: string; // JSON строка
    };
  };
  index: number;
  finish_reason: string;
}

export interface ChatResponse {
  choices: ChatChoice[];
  created: number;
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    precached_prompt_tokens?: number;
  };
}

export type ModelProvider = 'gigachat' | 'huggingface' | 'openrouter';

export type HuggingFaceModel = 
  | 'deepseek-ai/DeepSeek-V3.2'
  | 'OpenBuddy/openbuddy-llama3.1-8b-v22.3-131k'
  | '0xfader/Qwen2.5-0.5B-Instruct-Gensyn-Swarm-sharp_soaring_rooster';

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  displayName: string;
}


