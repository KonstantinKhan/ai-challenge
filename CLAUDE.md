# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React TypeScript application for chatting with multiple AI models (GigaChat and Hugging Face) - an interactive task formulation assistant that helps users create well-defined tasks through conversation. The app uses a three-phase conversational flow to collect task information (formulation, planned date, priority) and outputs structured JSON task data. Users can switch between different AI models via the UI.

## Development Commands

```bash
# Install dependencies
npm install

# Development server (http://localhost:5173)
npm run dev

# Type check and build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

## Environment Setup

Create `.env` file in project root with:
```
VITE_AUTH_TOKEN=your_auth_token_here
VITE_SCOPE=your_scope_here
VITE_HF_API_KEY=your_huggingface_api_key_here
VITE_MCP_SERVER_URL=your_mcp_server_url_here
```

- `VITE_AUTH_TOKEN` and `VITE_SCOPE`: Required for GigaChat API OAuth authentication
- `VITE_HF_API_KEY`: Required for Hugging Face Inference API. Get your API key from https://huggingface.co/settings/tokens
- `VITE_MCP_SERVER_URL`: Required for MCP (Model Context Protocol) integration. URL to remote MCP server for tool discovery (e.g., `https://context7.example.com/mcp`)

## Architecture

### API Proxy Configuration

Vite dev server proxies API requests to avoid CORS issues:
- `/api/oauth` → `https://ngw.devices.sberbank.ru:9443/api/v2/oauth`
- `/api/chat` → `https://gigachat.devices.sberbank.ru/api/v1/chat/completions`
- `/api/huggingface` → `https://router.huggingface.co/v1/chat/completions` (optional, direct requests also work)

Configuration in `vite.config.ts:8-22`

### Service Layer

#### GigaChat Service (`src/services/gigachat.ts`)

**OAuth Token Management:**
- Implements token caching with automatic refresh 5 minutes before expiration
- Uses `tokenCache` object with `access_token`, `expires_at`, and `refreshTimer`
- Token lifecycle managed via `setTimeout` callback that clears cache for renewal
- `getAccessToken()` function at line 161

**Chat API:**
- `sendMessage()` function at line 225 handles all GigaChat API communication
- Accepts message history array and optional custom system prompt
- Injects current UTC timestamp into system prompt for task date processing
- Returns assistant response text

**System Prompt (`SYSTEM_PROMPT` at line 7):**
- Contains comprehensive three-phase conversational flow logic
- Phase 1: Sequential data collection (task formulation → planned date → priority)
- Phase 2: Final confirmation with markdown summary
- Phase 3: JSON output with specific field requirements
- Critical rule: ONE question per message in Phase 1
- Custom prompts can override default via `systemPrompt` state in Chat component

#### Hugging Face Service (`src/services/huggingface.ts`)

**Chat API:**
- `sendMessage()` function handles Hugging Face Inference API communication
- Uses OpenAI-compatible chat completions endpoint: `https://router.huggingface.co/v1/chat/completions`
- Requires `VITE_HF_API_KEY` environment variable
- Supports three models:
  - `meta-llama/Meta-Llama-3-70B-Instruct` (top popularity)
  - `microsoft/Phi-3-medium-4k-instruct` (middle popularity)
  - `01-ai/Yi-1.5-9B-Chat` (lower popularity)
- Accepts message history array, model ID, optional custom system prompt, and temperature
- Injects current UTC timestamp into system prompt (same as GigaChat)
- Returns assistant response text
- Uses same `SYSTEM_PROMPT` as GigaChat for consistency

#### MCP Service (`src/services/mcp.ts`)

**Connection Management:**
- Implements singleton pattern for MCP client instance
- Uses StreamableHTTP transport for browser compatibility
- Lazy initialization - connects only when MCP Tools button is clicked
- `initMCPClient()` function establishes connection to remote MCP server
- Connection state tracked to prevent multiple concurrent connections

**Tool Discovery:**
- `getMCPTools()` function fetches available tools list from MCP server
- Automatically initializes connection if not already connected
- Transforms MCP SDK types to application-specific types
- Returns `MCPToolsResponse` with tools array and optional pagination cursor
- `closeMCPConnection()` function for cleanup and resource management
- `isMCPConnected()` function to check current connection state

**Type Definitions (`src/types/mcp.ts`):**
- `MCPTool`: Tool structure with name, description, inputSchema, outputSchema, and annotations
- `MCPConnectionState`: Connection status tracking ('disconnected' | 'connecting' | 'connected' | 'error')
- `MCPError`: Structured error information for MCP operations
- `MCPToolsResponse`: Service response format with tools array and pagination support

### Component Structure

**Chat Component (`src/components/Chat.tsx`):**
- Main chat interface managing conversation state
- State management:
  - `messages`: Array of ChatMessage objects (user/assistant/system)
  - `isLoading`: Boolean for API request status
  - `systemPrompt`: Current system prompt (editable)
  - `isPromptEditorOpen`: Modal visibility control
  - `selectedModel`: Current selected model configuration (provider + modelId)
- Functions:
  - `handleSend()`: Appends user message, calls appropriate API service based on selected model, updates with response
  - `handleClear()`: Resets conversation
- UI features: header with model selector, temperature slider, prompt editor button and clear dialog button, message display area with loading spinner, message input at bottom

**ModelSelector Component (`src/components/ModelSelector.tsx`):**
- Dropdown component for selecting AI model
- Available models:
  - GigaChat (default)
  - Llama-3-70B (Hugging Face)
  - Phi-3-medium (Hugging Face)
  - Yi-1.5-9B (Hugging Face)
- Disabled during API requests
- Styled to match existing UI components

**MessageInput Component (`src/components/MessageInput.tsx`):**
- Handles user input with validation
- No specific character limit enforcement in current version
- Disabled state during loading

**PromptEditor Component (`src/components/PromptEditor.tsx`):**
- Modal for editing system prompt
- Features: Save custom prompt, Reset to default, Close without saving
- Communicates with Chat via `onSave`, `onReset`, and `onClose` callbacks

**MCPToolsModal Component (`src/components/MCPToolsModal.tsx`):**
- Modal for displaying MCP tools from remote server
- Master-detail layout: tool list (left panel, 1/3 width) + details (right panel, 2/3 width)
- Features:
  - Displays tool name, description from MCP server
  - Shows input parameters with required/optional indicators
  - Displays output schema as formatted JSON
  - Annotations rendered as visual badges (read-only, destructive, idempotent)
  - Loading states with spinner during tool fetch
  - Error handling with user-friendly messages
  - Empty state when no tools available
- Follows PromptEditor modal pattern for consistent UI/UX
- Communicates with Chat via `onClose` callback
- Props: `isOpen`, `onClose`, `tools`, `isLoading`, `error`

### Type Definitions (`src/types/gigachat.ts`)

Key interfaces:
- `OAuthResponse`: OAuth token response with `access_token` and `expires_at`
- `ChatMessage`: Message with `role` ('user' | 'assistant' | 'system') and `content`
- `ChatRequest`/`ChatResponse`: API request/response structures
- `ModelProvider`: Type for AI provider ('gigachat' | 'huggingface')
- `HuggingFaceModel`: Type for Hugging Face model identifiers
- `ModelConfig`: Configuration object with provider, modelId, and displayName

## Tech Stack

- **React 19.2.0** with TypeScript
- **Vite 7.2.4** for build tooling
- **Axios 1.13.2** for HTTP requests
- **@modelcontextprotocol/sdk** for MCP (Model Context Protocol) integration
- **Tailwind CSS 3.4.18** for styling
- **ESLint** with typescript-eslint and React hooks plugins

## Project Structure

```
src/
├── components/       # React components
│   ├── Chat.tsx            # Main chat interface
│   ├── MessageInput.tsx    # User input component
│   ├── PromptEditor.tsx    # System prompt editor modal
│   ├── MCPToolsModal.tsx   # MCP tools display modal
│   ├── TemperatureSlider.tsx  # Temperature control slider
│   └── ModelSelector.tsx    # Model selection dropdown
├── services/         # API integration
│   ├── gigachat.ts         # GigaChat API client with OAuth
│   ├── huggingface.ts      # Hugging Face Inference API client
│   └── mcp.ts              # MCP client for tool discovery
├── types/           # TypeScript definitions
│   ├── gigachat.ts         # API types and model configurations
│   └── mcp.ts              # MCP tool types and interfaces
├── App.tsx          # Root component (renders Chat)
└── main.tsx         # Entry point
```

## Key Implementation Details

**Token Management Strategy:**
The application maintains a single token cache that automatically refreshes before expiration. When the refresh timer fires, it clears the cache (sets to `null`) rather than proactively fetching a new token. The next API call will trigger token renewal via `getAccessToken()`.

**Message Flow:**
1. User types in MessageInput
2. Chat.handleSend() appends to messages array
3. Based on selectedModel.provider, either GigaChat or Hugging Face sendMessage() is called
4. sendMessage() receives full message history + system prompt + model configuration
5. System prompt has UTC timestamp injected at top (for date parsing)
6. Response appended to messages array
7. On error, user message is rolled back

**System Prompt Customization:**
The default SYSTEM_PROMPT in `services/gigachat.ts` can be overridden at runtime via the PromptEditor UI. The Chat component maintains customized prompt in state and passes it to `sendMessage()`. This allows testing different conversational flows without code changes.

## Common Patterns

**Adding New API Endpoints:**
1. Add proxy configuration to `vite.config.ts` (if needed for CORS)
2. Create/update TypeScript interfaces in `src/types/`
3. Implement service function in `src/services/` with `sendMessage()` signature matching existing services
4. Add model configuration to ModelSelector component
5. Update Chat component to handle new provider in handleSend()

**State Management:**
All state is managed via React hooks (useState) in component layer. No external state management library is used.

**Error Handling:**
API errors are caught in Chat component and displayed in red error box below messages. Failed user messages are removed from conversation history to maintain clean state.
