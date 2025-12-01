export interface OAuthResponse {
  access_token: string;
  expires_at: number; // unix timestamp в миллисекундах
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
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
    precached_prompt_tokens: number;
  };
}

