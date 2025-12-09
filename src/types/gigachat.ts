export interface OAuthResponse {
  access_token: string;
  expires_at: number; // unix timestamp в миллисекундах
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  totalTokens?: number;
  duration?: number; // длительность выполнения запроса в миллисекундах
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}

export interface ChatChoice {
  message: {
    content: string;
    role: 'assistant';
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

export type ModelProvider = 'gigachat' | 'huggingface';

export type HuggingFaceModel = 
  | 'deepseek-ai/DeepSeek-V3.2'
  | 'OpenBuddy/openbuddy-llama3.1-8b-v22.3-131k'
  | '0xfader/Qwen2.5-0.5B-Instruct-Gensyn-Swarm-sharp_soaring_rooster';

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  displayName: string;
}


