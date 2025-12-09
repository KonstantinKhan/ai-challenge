# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React TypeScript application for chatting with GigaChat API - an interactive task formulation assistant that helps users create well-defined tasks through conversation. The app uses a three-phase conversational flow to collect task information (formulation, planned date, priority) and outputs structured JSON task data.

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
```

These credentials are required for GigaChat API OAuth authentication.

## Architecture

### API Proxy Configuration

Vite dev server proxies API requests to avoid CORS issues:
- `/api/oauth` → `https://ngw.devices.sberbank.ru:9443/api/v2/oauth`
- `/api/chat` → `https://gigachat.devices.sberbank.ru/api/v1/chat/completions`

Configuration in `vite.config.ts:8-22`

### Service Layer (`src/services/gigachat.ts`)

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

### Component Structure

**Chat Component (`src/components/Chat.tsx`):**
- Main chat interface managing conversation state
- State management:
  - `messages`: Array of ChatMessage objects (user/assistant/system)
  - `isLoading`: Boolean for API request status
  - `systemPrompt`: Current system prompt (editable)
  - `isPromptEditorOpen`: Modal visibility control
- Functions:
  - `handleSend()` at line 14: Appends user message, calls API, updates with response
  - `handleClear()` at line 45: Resets conversation
- UI features: header with prompt editor button and clear dialog button, message display area with loading spinner, message input at bottom

**MessageInput Component (`src/components/MessageInput.tsx`):**
- Handles user input with validation
- No specific character limit enforcement in current version
- Disabled state during loading

**PromptEditor Component (`src/components/PromptEditor.tsx`):**
- Modal for editing system prompt
- Features: Save custom prompt, Reset to default, Close without saving
- Communicates with Chat via `onSave`, `onReset`, and `onClose` callbacks

### Type Definitions (`src/types/gigachat.ts`)

Key interfaces:
- `OAuthResponse`: OAuth token response with `access_token` and `expires_at`
- `ChatMessage`: Message with `role` ('user' | 'assistant' | 'system') and `content`
- `ChatRequest`/`ChatResponse`: API request/response structures

## Tech Stack

- **React 19.2.0** with TypeScript
- **Vite 7.2.4** for build tooling
- **Axios 1.13.2** for HTTP requests
- **Tailwind CSS 3.4.18** for styling
- **ESLint** with typescript-eslint and React hooks plugins

## Project Structure

```
src/
├── components/       # React components
│   ├── Chat.tsx            # Main chat interface
│   ├── MessageInput.tsx    # User input component
│   └── PromptEditor.tsx    # System prompt editor modal
├── services/         # API integration
│   └── gigachat.ts         # GigaChat API client with OAuth
├── types/           # TypeScript definitions
│   └── gigachat.ts         # API types
├── App.tsx          # Root component (renders Chat)
└── main.tsx         # Entry point
```

## Key Implementation Details

**Token Management Strategy:**
The application maintains a single token cache that automatically refreshes before expiration. When the refresh timer fires, it clears the cache (sets to `null`) rather than proactively fetching a new token. The next API call will trigger token renewal via `getAccessToken()`.

**Message Flow:**
1. User types in MessageInput
2. Chat.handleSend() appends to messages array
3. sendMessage() called with full message history + system prompt
4. System prompt has UTC timestamp injected at top (for date parsing)
5. Response appended to messages array
6. On error, user message is rolled back

**System Prompt Customization:**
The default SYSTEM_PROMPT in `services/gigachat.ts` can be overridden at runtime via the PromptEditor UI. The Chat component maintains customized prompt in state and passes it to `sendMessage()`. This allows testing different conversational flows without code changes.

## Common Patterns

**Adding New API Endpoints:**
1. Add proxy configuration to `vite.config.ts`
2. Create/update TypeScript interfaces in `src/types/`
3. Implement service function in `src/services/` using `getAccessToken()` for auth
4. Handle response in component layer

**State Management:**
All state is managed via React hooks (useState) in component layer. No external state management library is used.

**Error Handling:**
API errors are caught in Chat component and displayed in red error box below messages. Failed user messages are removed from conversation history to maintain clean state.
