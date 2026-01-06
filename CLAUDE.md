# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React TypeScript application for chatting with multiple AI models (GigaChat, Hugging Face, and OpenRouter). The application features:
- Multi-provider AI chat with model switching
- Automatic conversation persistence and management via LocalStorage
- Smart message compression with conversation summarization
- MCP (Model Context Protocol) integration for tool discovery and execution
- SSE (Server-Sent Events) for real-time task summary streaming
- Agent task system for automated operations

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

Create `.env` file in project root (see `.env.example`):
```
VITE_AUTH_TOKEN=your_auth_token_here
VITE_SCOPE=your_scope_here
VITE_HF_API_KEY=your_huggingface_api_key_here
VITE_OPENROUTER_API_KEY=your_openrouter_api_key_here
YTJhMDZmOWYtNWNkMy00NjIxLWE2YzAtNzFlMTIzYmFjNzJhOmUxNTgxY2JhLTVjODctNDFlZi1iYThlLWRlOGJiNmIyYzc3Yw===your_mcp_server_url_here
```

- `VITE_AUTH_TOKEN` and `VITE_SCOPE`: Required for GigaChat API OAuth authentication
- `VITE_HF_API_KEY`: Required for Hugging Face Inference API (https://huggingface.co/settings/tokens)
- `VITE_OPENROUTER_API_KEY`: Required for OpenRouter API (https://openrouter.ai)
- `VITE_MCP_SERVER_URL`: Optional - URL to remote MCP server for tool discovery

## Architecture

### API Proxy Configuration

Vite dev server proxies API requests to avoid CORS issues (see `vite.config.ts:8-135`):

**AI Model APIs:**
- `/api/oauth` → GigaChat OAuth endpoint
- `/api/chat` → GigaChat chat completions
- `/api/huggingface` → Hugging Face Inference API
- `/api/openrouter` → OpenRouter chat completions

**Backend Services (localhost):**
- `/api/summaries` → Task summaries SSE stream (port 8080)
- `/api/agent/tasks` → Agent task management API (port 8080)
- `/api/rag` → RAG service endpoint (port 8082)

### Service Layer

#### GigaChat Service (`src/services/gigachat.ts`)

**OAuth Token Management:**
- Implements token caching with automatic refresh 5 minutes before expiration
- Uses `tokenCache` object with `access_token`, `expires_at`, and `refreshTimer`
- Token lifecycle managed via `setTimeout` callback that clears cache for renewal
- `getAccessToken()` function at line 161

**Chat API:**
- `sendMessage()` function handles all GigaChat API communication
- Accepts message history array, optional custom system prompt, optional temperature, and optional functions parameter (4th parameter)
- Functions parameter enables GigaChat Functions API for tool calling
- Returns object with response content and optional `function_call` when tool execution is requested
- Injects current UTC timestamp into system prompt for task date processing

#### Hugging Face Service (`src/services/huggingface.ts`)

**Chat API:**
- `sendMessage()` function handles Hugging Face Inference API communication
- Uses OpenAI-compatible chat completions endpoint
- Requires `VITE_HF_API_KEY` environment variable
- Supports models defined in `types/gigachat.ts` as `HuggingFaceModel` type
- Returns response content and token usage statistics

#### OpenRouter Service (`src/services/openrouter.ts`)

**Chat API:**
- `sendMessage()` function for OpenRouter API (model: `mistralai/mistral-7b-instruct:free`)
- Requires `VITE_OPENROUTER_API_KEY` environment variable
- Returns response content and token usage
- Includes HTTP-Referer and X-Title headers for OpenRouter tracking

#### MCP Service - RAG Only Integration (`src/services/mcp.ts`)

**Connection Management:**
- Implements singleton pattern for MCP client instance
- Uses DualChannelTransport for browser-compatible bidirectional communication
- Connects exclusively to RAG server on port 8082 (http://localhost:8082/rag)
- Lazy initialization - connects only when MCP Tools button is clicked
- `initMCPClient()` function establishes connection to RAG MCP server
- Connection state tracked to prevent multiple concurrent connections

**Tool Discovery:**
- `getMCPTools()` function fetches available tools list from RAG MCP server
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

#### Tool Converter Utility (`src/utils/toolConverter.ts`)

Converts MCP tool schemas to GigaChat Functions API format:
- `convertMCPToolToGigaChatTool()`: Converts single MCP tool to GigaChat Tool format
- `convertMCPToolsToGigaChatTools()`: Converts array of MCP tools
- Adds few-shot examples for rag_data tool to improve function calling accuracy
- Used by Chat component to prepare tools for GigaChat Functions API

#### Conversation Storage Service (`src/services/conversationStorage.ts`)

**Persistence Management:**
- Implements LocalStorage-based conversation persistence
- `saveConversation()`: Saves/updates conversation with auto-generated title from first user message
- `loadConversation(id)`: Retrieves conversation by ID
- `listConversations()`: Returns all conversations sorted by update time (newest first)
- `deleteConversation(id)`: Removes conversation and clears current ID if deleted
- `getCurrentConversationId()` / `setCurrentConversationId()`: Tracks active conversation
- `createNewConversation()`: Factory function with auto-generated ID and timestamp
- `generateConversationTitle()`: Creates title from first user message (max 50 chars)
- Storage keys: `ai-chat-conversations` and `ai-chat-current-id`

#### Compression Service (`src/services/compression.ts`)

**Smart Message Compression:**
- Implements conversation summarization to manage context length
- `compressMessages()`: Generates summary using selected AI model at 0.3 temperature
- Cumulative compression: integrates previous summary with new messages
- `getMessagesForAPI()`: Returns optimized message array for API calls
  - If compression exists: returns `[summary + last 2 messages]`
  - Otherwise: returns all messages
- `extractMessagesForCompression()`: Separates messages into summary/compress/keep buckets
- Summary marker: `[CONVERSATION SUMMARY]` prefix in system messages
- Uses `COMPRESSION_SYSTEM_PROMPT` for focused summarization

#### Summaries Service (`src/services/summaries.ts`)

**SSE Connection for Task Summaries:**
- `createSummariesConnection()`: Establishes EventSource connection to `/api/summaries/stream`
- Handles `new_summary` events with ID and text payload
- Includes heartbeat event handling (logged in dev mode)
- Auto-reconnection on errors via EventSource
- Returns connection object with `close()` method

#### Agent Tasks Service (`src/services/agentTasks.ts`)

**Agent Task Management:**
- REST API client for backend task system
- `getPendingAgentTasks()`: Fetches tasks with status 'pending'
- `completeAgentTask(id)`: Marks task as completed
- `failAgentTask(id, error)`: Marks task as failed with error message
- Task types: `generate_summary` (currently implemented)
- Base endpoint: `/api/agent/tasks`

### Hooks

**useAgentTasks (`src/hooks/useAgentTasks.ts`):**
- Custom hook for automatic agent task processing
- Polls `/api/agent/tasks/pending` every 60 seconds
- Processes `generate_summary` tasks by calling `onGenerateSummary` callback
- Tracks processed task IDs to prevent duplicate processing
- Handles task completion/failure via `completeAgentTask()` / `failAgentTask()`

### Component Structure

**Chat Component (`src/components/Chat.tsx`):**
- Main chat interface with comprehensive state management
- Key state:
  - `messages`: Array of ChatMessage objects (user/assistant/system)
  - `currentConversationId`: Tracks active conversation for persistence
  - `assistantResponseCount`: Used for compression trigger (every 5 responses)
  - `selectedModel`: ModelConfig (provider + modelId + displayName)
  - `temperature`: AI temperature setting (default 0.87)
  - `systemPrompt`: Editable system prompt (minimal prompt approach)
  - `mcpTools` / `mcpToolConfigs`: MCP tool management
  - `summaries`: Task summaries from SSE stream
- Key functions:
  - `buildMinimalSystemPrompt()`: Creates minimal system prompt without tool instructions
  - `formatToolResult()`: Formats RAG results with source extraction and structured display
  - `handleSend()`: Single API call with functions parameter, triggers immediate tool execution if `function_call` is present in response
  - `autoSaveConversation()`: Debounced (500ms) LocalStorage persistence
  - `handleLoadConversation()`: Restores conversation from ConversationManager
  - MCP integration: `handleMCPToolsClick()`, `callMCPTool()` for tool execution
- Uses `useAgentTasks` hook for automated summary generation
- Establishes SSE connection on mount via `createSummariesConnection()`

**ConversationManager Component (`src/components/ConversationManager.tsx`):**
- Modal for managing saved conversations
- Lists all conversations with title, message count, model name, and timestamp
- Implements relative time formatting (e.g., "5 min. ago", "2 days ago")
- Click conversation to load, delete button per conversation with confirmation
- Filters out summary messages from count display
- Calls `setCurrentConversationId()` on load

**ModelSelector Component (`src/components/ModelSelector.tsx`):**
- Dropdown for AI model selection
- Models defined in Chat component state (GigaChat, Hugging Face variants, OpenRouter)
- Disabled during API requests

**PromptEditor Component (`src/components/PromptEditor.tsx`):**
- Modal for editing system prompt
- Save/Reset/Close actions

**TemperatureSlider Component (`src/components/TemperatureSlider.tsx`):**
- Slider control for AI temperature parameter

**MessageInput Component (`src/components/MessageInput.tsx`):**
- User input component with send button
- Disabled during loading

**MCPToolsModal Component (`src/components/MCPToolsModal.tsx`):**
- Modal for MCP tool discovery and execution
- Master-detail layout: tool list (left 1/3) + details (right 2/3)
- Displays tool schemas, parameters, annotations (read-only, destructive, idempotent)
- Tool selection and argument configuration UI

### Type Definitions

**`src/types/gigachat.ts`:**
- `OAuthResponse`: OAuth token response with `access_token` and `expires_at`
- `ChatMessage`: Message with `role`, `content`, optional `tokenUsage` and `duration`
- `TokenUsage`: Token statistics (prompt, completion, precached, total)
- `ChatRequest`/`ChatResponse`: API request/response structures
- `ModelProvider`: Type for AI provider ('gigachat' | 'huggingface' | 'openrouter')
- `HuggingFaceModel`: Union type of supported Hugging Face model IDs
- `ModelConfig`: Configuration object with provider, modelId, and displayName

**`src/types/conversation.ts`:**
- `SavedConversation`: Complete conversation state including id, title, timestamps, messages, modelConfig, temperature, assistantResponseCount

**`src/types/mcp.ts`:**
- `MCPTool`, `MCPConnectionState`, `MCPError`, `MCPToolsResponse`

**`src/types/summaries.ts`:**
- `TaskSummary`: Summary structure from SSE stream

**`src/types/tool.ts`:**
- Tool-related types for MCP integration

**`src/types/fewshot.ts`:**
- Few-shot learning example types

## Tech Stack

- **React 19.2.0** with TypeScript
- **Vite 7.2.4** for build tooling
- **Axios 1.13.2** for HTTP requests
- **@modelcontextprotocol/sdk 1.24.3** for MCP integration
- **react-markdown 9.0.1** for message rendering
- **Tailwind CSS 3.4.18** for styling
- **ESLint** with typescript-eslint and React hooks plugins

## Project Structure

```
src/
├── components/               # React components
│   ├── Chat.tsx                  # Main chat interface with state orchestration
│   ├── ConversationManager.tsx   # Saved conversations modal
│   ├── MessageInput.tsx          # User input component
│   ├── PromptEditor.tsx          # System prompt editor modal
│   ├── TemperatureSlider.tsx     # Temperature control slider
│   ├── ModelSelector.tsx         # Model selection dropdown
│   └── MCPToolsModal.tsx         # MCP tools display modal
├── services/                # Business logic and API clients
│   ├── gigachat.ts              # GigaChat OAuth + chat API
│   ├── huggingface.ts           # Hugging Face Inference API
│   ├── openrouter.ts            # OpenRouter API client
│   ├── mcp.ts                   # MCP tool discovery/execution (RAG only)
│   ├── mcpTransport.ts          # MCP transport layer
│   ├── streamableHttpTransport.ts  # HTTP transport for MCP
│   ├── conversationStorage.ts   # LocalStorage persistence
│   ├── compression.ts           # Message compression/summarization
│   ├── summaries.ts             # SSE summaries connection
│   └── agentTasks.ts            # Agent task API client
├── hooks/                   # Custom React hooks
│   └── useAgentTasks.ts         # Agent task polling/processing
├── utils/                   # Utility functions
│   └── toolConverter.ts         # MCP to GigaChat tool converter
├── types/                   # TypeScript type definitions
│   ├── gigachat.ts              # API types and model configs
│   ├── conversation.ts          # Conversation persistence types
│   ├── mcp.ts                   # MCP tool types
│   ├── summaries.ts             # Summary types
│   ├── tool.ts                  # Tool-related types
│   └── fewshot.ts               # Few-shot example types
├── App.tsx                  # Root component
└── main.tsx                 # Entry point
```

## Key Implementation Details

### Conversation Persistence Flow

1. **Auto-save with Debouncing:**
   - Chat component auto-saves conversation to LocalStorage on every message change
   - 500ms debounce prevents excessive writes
   - Title auto-generated from first user message (max 50 chars)

2. **Conversation Lifecycle:**
   - New conversation: `createNewConversation()` generates unique ID
   - Load conversation: `loadConversation(id)` restores full state (messages, model, temperature)
   - Current conversation tracked via `currentConversationId` in both state and LocalStorage

3. **State Restoration:**
   - On component mount, attempts to load last active conversation via `getCurrentConversationId()`
   - ConversationManager modal allows browsing/loading/deleting saved conversations

### Message Compression Workflow

1. **Compression Trigger:**
   - Every 5 assistant responses (`assistantResponseCount % 5 === 0`)
   - Calls `compressMessages()` with current messages and selected model

2. **Compression Process:**
   - Extracts previous summary (if exists) and messages to compress
   - Keeps last 2 messages (1 user + 1 assistant pair) uncompressed
   - Sends compression prompt to AI model at 0.3 temperature
   - Returns new summary message with `[CONVERSATION SUMMARY]` marker

3. **API Message Selection:**
   - `getMessagesForAPI()` determines what to send to AI:
     - If summary exists: `[summary + last 2 messages]`
     - Otherwise: all messages
   - Reduces context length while preserving conversation continuity

### Token Management (GigaChat)

- Single token cache with automatic refresh 5 minutes before expiration
- Refresh timer clears cache rather than proactively fetching
- Next API call triggers renewal via `getAccessToken()`

### Message Flow

1. User types in MessageInput → Chat.handleSend()
2. Append user message to state
3. Check compression trigger (every 5 responses)
4. If triggered: call `compressMessages()`, insert summary into messages
5. Get optimized messages via `getMessagesForAPI()`
6. Route to appropriate service based on `selectedModel.provider`:
   - `gigachat` → `sendGigaChatMessage()`
   - `openrouter` → `sendOpenRouterMessage()`
   - `huggingface` → `sendHuggingFaceMessage()`
7. Append assistant response with token usage and duration
8. Auto-save conversation (debounced)
9. On error: rollback user message, display error

### MCP Integration

- Single RAG server integration (port 8082)
- Tool discovery: `getMCPTools()` returns available tools from RAG server
- Tool execution: `callMCPTool(toolName, args)` executes tools on RAG server
- Tools converted to GigaChat Functions API format via `convertMCPToolsToGigaChatTools()`
- Function calling handled by GigaChat API with automatic tool execution on `function_call` response

### SSE Integration

- Summaries connection established on Chat mount via `createSummariesConnection()`
- Listens for `new_summary` events with ID and text
- Deduplicates via `receivedIdsRef` to prevent duplicate display
- Connection cleaned up on unmount

### Agent Task System

- `useAgentTasks` hook polls for pending tasks every 60 seconds
- Currently supports `generate_summary` task type
- Task processing: call provided callback → mark complete/failed
- Prevents duplicate processing via `processedTaskIds` ref

## Common Patterns

### Adding New AI Provider

1. **Create Service:** Add new service file in `src/services/` (e.g., `newprovider.ts`)
   - Implement `sendMessage()` function matching signature: `(messages, customSystemPrompt?, temperature?) => Promise<{ content: string; tokenUsage: TokenUsage }>`
   - Handle API authentication and error formatting

2. **Update Types:** In `src/types/gigachat.ts`:
   - Add provider to `ModelProvider` union type
   - Add model IDs to appropriate type union if needed

3. **Add Proxy:** In `vite.config.ts`, add proxy configuration for CORS handling

4. **Update Chat Component:** In `src/components/Chat.tsx`:
   - Import new service
   - Add case in `handleSend()` provider routing logic
   - Add model config to available models state

5. **Update Compression:** In `src/services/compression.ts`:
   - Add case in `compressMessages()` for new provider

### Adding New Component

- Place in `src/components/`
- Follow existing modal pattern (PromptEditor, ConversationManager) for consistency
- Use Tailwind CSS for styling (match existing color scheme)
- Communicate with parent via callback props (onClose, onSave, etc.)

### Working with Conversation State

- Always use `autoSaveConversation()` after state mutations
- Use `getMessagesForAPI()` when sending messages to AI (handles compression)
- Track `assistantResponseCount` for compression triggers
- Update `currentConversationId` when creating/loading conversations

### Error Handling Strategy

- API errors caught in Chat.handleSend()
- Failed user messages removed from history (rollback)
- Error displayed in UI via `error` state
- Service errors logged to console with context

### State Management Principles

- All state managed via React hooks (useState) in components
- No external state management library
- Persistence via LocalStorage (conversations)
- Debouncing for performance (auto-save, etc.)
