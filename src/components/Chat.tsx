import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { sendMessage as sendGigaChatMessage } from '../services/gigachat';
import { sendMessage as sendHuggingFaceMessage } from '../services/huggingface';
import { sendMessage as sendOpenRouterMessage } from '../services/openrouter';
import { compressMessages, SUMMARY_MARKER, getMessagesForAPI } from '../services/compression';
import {
  saveConversation,
  loadConversation,
  getCurrentConversationId,
  setCurrentConversationId,
  generateConversationTitle,
  createNewConversation
} from '../services/conversationStorage';
import { MessageInput } from './MessageInput';
import { PromptEditor } from './PromptEditor';
import { TemperatureSlider } from './TemperatureSlider';
import { ModelSelector } from './ModelSelector';
import { UserIdSelector } from './UserIdSelector';
import { ConversationManager } from './ConversationManager';
import { MCPToolsModal } from './MCPToolsModal';
import { getMCPTools, callMCPTool } from '../services/mcp';
import { convertMCPToolsToGigaChatTools } from '../utils/toolConverter';
import { parseCommand } from '../utils/commandParser';
import type { ChatMessage, ModelConfig, HuggingFaceModel, TokenUsage } from '../types/gigachat';
import type { SavedConversation } from '../types/conversation';
import type { MCPToolWithServer } from '../types/mcp';

type MCPToolConfig = {
  selected: boolean;
  args?: Record<string, unknown>;
};

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.87);
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelConfig>({
    provider: 'gigachat',
    modelId: 'GigaChat-2-Pro',
    displayName: 'GigaChat',
  });
  const [assistantResponseCount, setAssistantResponseCount] = useState<number>(0);
  const [currentConversationId, setCurrentConversationIdState] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number>(101);
  const [isConversationManagerOpen, setIsConversationManagerOpen] = useState(false);
  const [isMCPModalOpen, setIsMCPModalOpen] = useState(false);
  const [mcpTools, setMcpTools] = useState<MCPToolWithServer[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpToolConfigs, setMcpToolConfigs] = useState<Record<string, MCPToolConfig>>({});
  const [mcpServerStatuses, setMcpServerStatuses] = useState<Record<string, {
    connected: boolean;
    error?: string;
    toolCount: number;
  }>>({});
  const [helpModeActive, setHelpModeActive] = useState<boolean>(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);
  const helpToolConfigsRef = useRef<Record<string, MCPToolConfig> | null>(null);
  const helpToolsRef = useRef<MCPToolWithServer[] | null>(null);
  const helpModeActiveRef = useRef<boolean>(false);
 

  const formatDuration = (ms: number): string => {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Автосохранение диалога с дебаунсом
  const autoSaveConversation = useCallback(() => {
    if (messages.length === 0) return;

    // Очищаем предыдущий таймер
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Устанавливаем новый таймер с дебаунсом 500ms
    saveTimeoutRef.current = setTimeout(() => {
      try {
        const existingConversation = currentConversationId 
          ? loadConversation(currentConversationId) 
          : null;

        const conversation: SavedConversation = {
          id: currentConversationId || (existingConversation?.id || ''),
          title: generateConversationTitle(messages),
          createdAt: existingConversation?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          systemPrompt,
          messages,
          modelConfig: selectedModel,
          temperature,
          assistantResponseCount,
          selectedUserId,
        };

        // Если нет ID, создаем новый диалог
        if (!conversation.id) {
          const newConversation = createNewConversation(
            systemPrompt,
            selectedModel,
            temperature
          );
          conversation.id = newConversation.id;
          conversation.createdAt = newConversation.createdAt;
        }

        saveConversation(conversation);
        setCurrentConversationIdState(conversation.id);
        setCurrentConversationId(conversation.id);
      } catch (error) {
        console.error('Ошибка при автосохранении диалога:', error);
      }
    }, 500);
  }, [messages, systemPrompt, selectedModel, temperature, assistantResponseCount, selectedUserId, currentConversationId]);

  // Загрузка диалога при монтировании
  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      const savedId = getCurrentConversationId();
      
      if (savedId) {
        const savedConversation = loadConversation(savedId);
        if (savedConversation) {
          setMessages(savedConversation.messages);
          setSystemPrompt(savedConversation.systemPrompt);
          setSelectedModel(savedConversation.modelConfig);
          setTemperature(savedConversation.temperature);
          setAssistantResponseCount(savedConversation.assistantResponseCount);
          setSelectedUserId(savedConversation.selectedUserId || 101);
          setCurrentConversationIdState(savedConversation.id);
        }
      }
    }
  }, []);

  // Автосохранение при изменении данных
  useEffect(() => {
    if (!isInitialLoadRef.current) {
      autoSaveConversation();
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [messages, systemPrompt, selectedModel, temperature, assistantResponseCount, selectedUserId, autoSaveConversation]);

  const handleToggleMCPTool = (toolName: string) => {
    setMcpToolConfigs((prev) => {
      const prevConfig = prev[toolName] || { selected: false };
      return {
        ...prev,
        [toolName]: {
          ...prevConfig,
          selected: !prevConfig.selected,
        },
      };
    });
  };

  const handleUpdateToolArgs = (toolName: string, args: Record<string, unknown>) => {
    setMcpToolConfigs((prev) => {
      const prevConfig = prev[toolName] || { selected: false, args: {} };
      return {
        ...prev,
        [toolName]: {
          selected: prevConfig.selected, // Сохраняем состояние selected
          args: { ...(prevConfig.args || {}), ...args },
        },
      };
    });
  };

  const buildMinimalSystemPrompt = useCallback((basePrompt: string, hasTools: boolean): string => {
    if (!hasTools) {
      return basePrompt;
    }

    const functionsHint = `
Ты - полезный AI ассистент с доступом к инструментам поиска информации.

Когда пользователь задает вопрос, требующий поиска в документации или проектных файлах, используй доступные функции для получения актуальной информации.

ОБЯЗАТЕЛЬНО указывай источники информации в ответе (файлы и строки).
`;

    return basePrompt ? `${basePrompt}\n\n${functionsHint}` : functionsHint;
  }, []);

  // Функция для форматирования результата вызова инструмента
  const formatToolResult = useCallback((
    toolName: string,
    _args: Record<string, unknown>,
    result: unknown
  ): string => {
    if (toolName === 'rag_data') {
      // Log the RAG response for debugging
      console.log('[RAG Response] Raw result for formatting:', result);

      // Handle the nested RAG response structure
      let contentText = '';
      let sources: string[] = [];

      // Check if result has the expected structure with content array
      if (result && typeof result === 'object' && 'content' in result) {
        const resultObj = result as { content: Array<{ type: string; text: string }> };

        if (Array.isArray(resultObj.content) && resultObj.content.length > 0) {
          // Extract text content from each item in the content array
          contentText = resultObj.content
            .filter(item => item.type === 'text')
            .map(item => item.text)
            .join('\n\n');

          // Extract sources from the content text
          const fileMatches = contentText.match(/File: ([^\n\r]+)/g) || [];
          sources = fileMatches.map(match => match.replace('File: ', '').trim());
        } else {
          // Fallback: try to stringify the whole result
          contentText = JSON.stringify(result, null, 2);
        }
      } else {
        // Fallback: try to stringify the whole result
        contentText = JSON.stringify(result, null, 2);
      }

      console.log('[RAG Response] Extracted content text:', contentText);
      console.log('[RAG Response] Extracted sources:', sources);

      let formatted = '**Результаты поиска:**\n\n';
      formatted += '```\n' + contentText + '\n```';

      if (sources.length > 0) {
        formatted += '\n\n**Источники:**\n';
        sources.forEach(source => {
          formatted += `- \`${source}\`\n`;
        });
      }

      return formatted;
    }

    // Special formatting for git_status
    if (toolName === 'git_status') {
      // Log git tool result for debugging
      if (import.meta.env.DEV) {
        console.log('[Git Tool] Raw result for git_status:', result);
      }

      // Parse git status result structure
      const gitResult = result as {
        branch?: string;
        staged?: Array<{ path: string; status: string }>;
        unstaged?: Array<{ path: string; status: string }>;
        untracked?: string[];
        diff?: string;
      };

      let formatted = '';

      // 1. Prominently display current branch
      if (gitResult.branch) {
        formatted += `**Текущая ветка:** \`${gitResult.branch}\`\n\n`;
      }

      // 2. Display file statistics
      const stagedCount = gitResult.staged?.length || 0;
      const unstagedCount = gitResult.unstaged?.length || 0;
      const untrackedCount = gitResult.untracked?.length || 0;

      formatted += `**Статус файлов:**\n`;
      if (stagedCount > 0) {
        formatted += `- Staged: ${stagedCount} файл(ов)\n`;
      }
      if (unstagedCount > 0) {
        formatted += `- Unstaged: ${unstagedCount} файл(ов)\n`;
      }
      if (untrackedCount > 0) {
        formatted += `- Untracked: ${untrackedCount} файл(ов)\n`;
      }

      if (stagedCount === 0 && unstagedCount === 0 && untrackedCount === 0) {
        formatted += `- Рабочая директория чистая\n`;
      }

      formatted += `\n`;

      // 3. List staged files if any
      if (gitResult.staged && gitResult.staged.length > 0) {
        formatted += `**Staged файлы:**\n`;
        gitResult.staged.forEach(file => {
          formatted += `- \`${file.path}\` (${file.status})\n`;
        });
        formatted += `\n`;
      }

      // 4. List unstaged files if any
      if (gitResult.unstaged && gitResult.unstaged.length > 0) {
        formatted += `**Unstaged изменения:**\n`;
        gitResult.unstaged.forEach(file => {
          formatted += `- \`${file.path}\` (${file.status})\n`;
        });
        formatted += `\n`;
      }

      // 5. List untracked files if any (limit to first 10)
      if (gitResult.untracked && gitResult.untracked.length > 0) {
        formatted += `**Untracked файлы:**\n`;
        const displayCount = Math.min(gitResult.untracked.length, 10);
        gitResult.untracked.slice(0, displayCount).forEach(file => {
          formatted += `- \`${file}\`\n`;
        });
        if (gitResult.untracked.length > displayCount) {
          formatted += `... и ещё ${gitResult.untracked.length - displayCount} файл(ов)\n`;
        }
        formatted += `\n`;
      }

      // 6. Include diff if present
      if (gitResult.diff && gitResult.diff.trim().length > 0) {
        formatted += `**Diff:**\n\`\`\`diff\n${gitResult.diff}\n\`\`\`\n`;
      }

      return formatted;
    }

    // Log other git tools for debugging
    if (import.meta.env.DEV && toolName.startsWith('git_')) {
      console.log(`[Git Tool] Raw result for ${toolName}:`, result);
    }

    return `**Результат ${toolName}:**\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }, []);

  // Build enhanced system prompt with aggregated tool data
  const buildEnhancedSystemPromptWithToolData = useCallback((
    basePrompt: string,
    aggregatedResults: {
      rag_results?: Array<{ toolName: string; content: unknown; serverUrl: string }>;
      other_results: Array<{ toolName: string; result: unknown; serverUrl: string }>;
    }
  ): string => {
    // Start with base instruction in English
    let enhancedPrompt = basePrompt || '';

    // Add base instruction for using tool data
    enhancedPrompt += '\n\nYou are an assistant who answers user questions based on user data and information obtained from RAG.\n\n';

    // Helper function to extract text content from tool results (similar to formatToolResult)
    const extractToolContent = (toolName: string, result: unknown): string => {
      // RAG data extraction
      if (toolName.includes('rag_data') || toolName.startsWith('rag_')) {
        let contentText = '';

        if (result && typeof result === 'object' && 'content' in result) {
          const resultObj = result as { content: Array<{ type: string; text: string }> };

          if (Array.isArray(resultObj.content) && resultObj.content.length > 0) {
            contentText = resultObj.content
              .filter(item => item.type === 'text')
              .map(item => item.text)
              .join('\n\n');
          } else {
            contentText = JSON.stringify(result, null, 2);
          }
        } else {
          contentText = JSON.stringify(result, null, 2);
        }

        return contentText;
      }

      // Git tool data extraction
      if (toolName.startsWith('git_')) {
        const gitResult = result as {
          branch?: string;
          staged?: Array<{ path: string; status: string }>;
          unstaged?: Array<{ path: string; status: string }>;
          untracked?: string[];
          diff?: string;
        };

        let formatted = '';

        if (gitResult.branch) {
          formatted += `Current branch: ${gitResult.branch}\n`;
        }

        const stagedCount = gitResult.staged?.length || 0;
        const unstagedCount = gitResult.unstaged?.length || 0;
        const untrackedCount = gitResult.untracked?.length || 0;

        if (stagedCount > 0 || unstagedCount > 0 || untrackedCount > 0) {
          formatted += `File status: ${stagedCount} staged, ${unstagedCount} unstaged, ${untrackedCount} untracked\n`;
        }

        if (gitResult.staged && gitResult.staged.length > 0) {
          formatted += '\nStaged files:\n';
          gitResult.staged.forEach(file => {
            formatted += `- ${file.path} (${file.status})\n`;
          });
        }

        if (gitResult.unstaged && gitResult.unstaged.length > 0) {
          formatted += '\nUnstaged changes:\n';
          gitResult.unstaged.forEach(file => {
            formatted += `- ${file.path} (${file.status})\n`;
          });
        }

        if (gitResult.diff && gitResult.diff.trim().length > 0) {
          formatted += `\nDiff:\n${gitResult.diff}\n`;
        }

        return formatted;
      }

      // Generic tool data
      return JSON.stringify(result, null, 2);
    };

    // Add RAG data section if present
    if (aggregatedResults.rag_results && aggregatedResults.rag_results.length > 0) {
      enhancedPrompt += '## Information from RAG:\n\n';

      aggregatedResults.rag_results.forEach(({ toolName, content }) => {
        const extracted = extractToolContent(toolName, content);
        // Truncate if too long (max 5000 chars per tool)
        const truncated = extracted.length > 5000
          ? extracted.substring(0, 5000) + '\n... (truncated)'
          : extracted;

        enhancedPrompt += `${truncated}\n\n`;
      });
    }

    // Add other tool data sections
    if (aggregatedResults.other_results.length > 0) {
      aggregatedResults.other_results.forEach(({ toolName, result }) => {
        enhancedPrompt += `## Data from ${toolName}:\n\n`;

        const extracted = extractToolContent(toolName, result);
        // Truncate if too long (max 5000 chars per tool)
        const truncated = extracted.length > 5000
          ? extracted.substring(0, 5000) + '\n... (truncated)'
          : extracted;

        enhancedPrompt += `${truncated}\n\n`;
      });
    }

    // Add instruction to cite sources and use provided data
    enhancedPrompt += 'IMPORTANT: Use the information provided above to answer the user\'s question. Always cite your sources (files, line numbers, etc.) when referencing information from the tools.\n';

    if (import.meta.env.DEV) {
      console.log('[Enhanced System Prompt] Length:', enhancedPrompt.length);
      console.log('[Enhanced System Prompt] Preview (first 500 chars):', enhancedPrompt.substring(0, 500));
    }

    return enhancedPrompt;
  }, []);

  // Helper: Get default repository path for /help command
  const getDefaultRepositoryPath = useCallback((): string => {
    return import.meta.env.VITE_DEFAULT_REPO_PATH ||
           '/Users/khan/Projects/ai-challenge'; // Current working directory
  }, []);

  // Helper: Disable all tools (cleanup after /help one-time use)
  const disableAllTools = useCallback(() => {
    setMcpToolConfigs({});
  }, []);

  // Helper: Enable all MCP tools for /help mode
  const enableHelpModeTools = useCallback(async (repositoryPath: string): Promise<{
    success: boolean;
    error?: string;
    toolsEnabled: string[];
    toolConfigs?: Record<string, MCPToolConfig>;
    tools?: MCPToolWithServer[];
  }> => {
    try {
      // Fetch tools from all MCP servers
      const mcpResponse = await getMCPTools();

      if (import.meta.env.DEV) {
        console.log('[Help Mode] MCP Tools Response:', mcpResponse);
        console.log('[Help Mode] Server Statuses:', mcpResponse.serverStatuses);
      }

      // Check if any servers are connected
      const connectedServers = Object.entries(mcpResponse.serverStatuses)
        .filter(([_, status]) => status.connected)
        .map(([name]) => name);

      if (connectedServers.length === 0) {
        return {
          success: false,
          error: 'Cannot connect to MCP servers',
          toolsEnabled: [],
        };
      }

      // Store tools for later use
      setMcpTools(mcpResponse.tools);
      setMcpServerStatuses(mcpResponse.serverStatuses);

      // Configure tools: enable all with appropriate arguments
      const newToolConfigs: Record<string, MCPToolConfig> = {};
      const toolsEnabled: string[] = [];

      mcpResponse.tools.forEach(tool => {
        let args: Record<string, unknown> = {};

        // For RAG tools (from rag server), enable reranker
        if (tool.serverName === 'rag') {
          args = { use_reranker: true };

          if (import.meta.env.DEV) {
            console.log(`[Help Mode] Enabling RAG tool: ${tool.name} with use_reranker=true`);
          }
        }

        // For Git tools (from git server), set repository path
        if (tool.serverName === 'git' && tool.inputSchema?.properties) {
          // Find the parameter that represents the repository path
          // Look for common names: path, repo, repository, repo_path, directory
          const pathParamNames = ['path', 'repo', 'repository', 'repo_path', 'directory', 'dir'];
          const pathParam = Object.keys(tool.inputSchema.properties).find(param =>
            pathParamNames.some(name => param.toLowerCase().includes(name))
          );

          if (pathParam) {
            args = { [pathParam]: repositoryPath };

            if (import.meta.env.DEV) {
              console.log(`[Help Mode] Enabling Git tool: ${tool.name} with ${pathParam}=${repositoryPath}`);
            }
          } else if (import.meta.env.DEV) {
            console.warn(`[Help Mode] Git tool ${tool.name} has no recognizable path parameter`);
          }
        }

        // Enable the tool
        newToolConfigs[tool.name] = {
          selected: true,
          args,
        };

        toolsEnabled.push(tool.name);
      });

      // Update tool configurations
      setMcpToolConfigs(newToolConfigs);

      if (import.meta.env.DEV) {
        console.log('[Help Mode] Enabled tools:', toolsEnabled);
        console.log('[Help Mode] Tool configs:', newToolConfigs);
      }

      return {
        success: true,
        toolsEnabled,
        toolConfigs: newToolConfigs,
        tools: mcpResponse.tools,
      };

    } catch (err) {
      console.error('[Help Mode] Error enabling tools:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        toolsEnabled: [],
      };
    }
  }, []);

  // Orchestrate tool calls: call all selected tools sequentially (RAG first if present)
  const orchestrateToolCalls = useCallback(async (
    selectedTools: MCPToolWithServer[],
    userMessage: string,
    toolConfigs: Record<string, MCPToolConfig>
  ): Promise<{
    rag_results?: Array<{ toolName: string; content: unknown; serverUrl: string }>;
    other_results: Array<{ toolName: string; result: unknown; serverUrl: string }>;
  }> => {
    if (import.meta.env.DEV) {
      console.log('[Tool Orchestration] Starting orchestration for tools:', selectedTools.map(t => t.name));
    }

    // 1. Separate RAG tools from others
    const ragTools = selectedTools.filter(tool =>
      tool.name.includes('rag_data') || tool.name.startsWith('rag_')
    );
    const otherTools = selectedTools.filter(tool =>
      !tool.name.includes('rag_data') && !tool.name.startsWith('rag_')
    );

    const totalTools = selectedTools.length;
    let currentToolIndex = 0;

    // 2. Call RAG tools first
    const rag_results: Array<{ toolName: string; content: unknown; serverUrl: string }> = [];

    if (ragTools.length > 0 && import.meta.env.DEV) {
      console.log('[RAG Priority] Calling RAG tools first:', ragTools.map(t => t.name));
    }

    for (const tool of ragTools) {
      currentToolIndex++;

      if (import.meta.env.DEV) {
        console.log(`[Tool Call] Calling ${tool.name} (${currentToolIndex}/${totalTools})...`);
      }

      // Get args from config, merge with defaults
      const toolConfig = toolConfigs[tool.name] || { selected: false, args: {} };
      const mergedArgs = {
        ...(toolConfig.args || {}),
      };

      // Add query if not provided
      if (!mergedArgs.query) {
        mergedArgs.query = userMessage;
      }

      try {
        const result = await callMCPTool(tool.name, mergedArgs, tool.serverName);
        rag_results.push({
          toolName: tool.name,
          content: result,
          serverUrl: tool.serverUrl
        });

        if (import.meta.env.DEV) {
          console.log(`[Tool Call] ${tool.name} completed successfully`);
        }
      } catch (error) {
        console.error(`[Tool Orchestration] Error calling ${tool.name}:`, error);
        // Continue with next tool
      }
    }

    // 3. Call other tools sequentially
    const other_results: Array<{ toolName: string; result: unknown; serverUrl: string }> = [];

    for (const tool of otherTools) {
      currentToolIndex++;

      if (import.meta.env.DEV) {
        console.log(`[Tool Call] Calling ${tool.name} (${currentToolIndex}/${totalTools})...`);
      }

      const toolConfig = toolConfigs[tool.name] || { selected: false, args: {} };
      const mergedArgs = { ...(toolConfig.args || {}) };

      // Special handling for Git tools: if no path, use default
      if (tool.serverName === 'git' && tool.inputSchema?.properties) {
        const pathParamNames = ['path', 'repo', 'repository', 'repo_path', 'directory', 'dir'];
        const pathParam = Object.keys(tool.inputSchema.properties).find(param =>
          pathParamNames.some(name => param.toLowerCase().includes(name))
        );

        if (pathParam && !mergedArgs[pathParam]) {
          mergedArgs[pathParam] = import.meta.env.VITE_DEFAULT_REPO_PATH || '/Users/khan/Projects/ai-challenge';
        }
      }

      // Inject user_id for cloud_flow tools
      if (tool.serverName === 'cloud_flow') {
        mergedArgs.user_id = selectedUserId;
      }

      try {
        const result = await callMCPTool(tool.name, mergedArgs, tool.serverName);
        other_results.push({
          toolName: tool.name,
          result: result,
          serverUrl: tool.serverUrl
        });

        if (import.meta.env.DEV) {
          console.log(`[Tool Call] ${tool.name} completed successfully`);
        }
      } catch (error) {
        console.error(`[Tool Orchestration] Error calling ${tool.name}:`, error);
        // Continue with next tool
      }
    }

    // 4. Return aggregated results
    const aggregated = {
      rag_results: rag_results.length > 0 ? rag_results : undefined,
      other_results
    };

    if (import.meta.env.DEV) {
      console.log('[Aggregated Results]', aggregated);
    }

    return aggregated;
  }, []);

  const handleSend = async (userMessage: string) => {
    if (isLoading) return;

    // Command detection and processing
    const commandResult = parseCommand(userMessage);

    if (commandResult.isCommand && commandResult.commandType === 'help') {
      const path = commandResult.extractedPath || getDefaultRepositoryPath();

      setIsLoading(true); // Show loading during tool enablement
      setError(null);

      try {
        const enableResult = await enableHelpModeTools(path);

        if (!enableResult.success) {
          setError(enableResult.error || 'Failed to enable help mode tools');
          setIsLoading(false);
          return;
        }

        if (enableResult.toolsEnabled.length === 0) {
          setError('No tools available for help mode');
          setIsLoading(false);
          return;
        }

        // Mark help mode active for cleanup
        setHelpModeActive(true);
        helpModeActiveRef.current = true;

        // Store tool configs and tools in refs for immediate use (bypasses state update queue)
        const helpToolConfigs = enableResult.toolConfigs || {};
        const helpTools = enableResult.tools || [];
        helpToolConfigsRef.current = helpToolConfigs;
        helpToolsRef.current = helpTools;

        // Log in dev mode
        if (import.meta.env.DEV) {
          console.log('[Help Mode] Activated with path:', path);
          console.log('[Help Mode] Enabled tools:', enableResult.toolsEnabled);
          console.log('[Help Mode] Tool configs (local):', helpToolConfigs);
          console.log('[Help Mode] Tools (local):', helpTools.map(t => t.name));
        }

        // Use stripped message (remove /help prefix)
        userMessage = commandResult.strippedMessage.trim();

        // If stripped message is empty, show error
        if (!userMessage) {
          setError('Please provide a question after /help command');
          setIsLoading(false);
          setHelpModeActive(false);
          helpModeActiveRef.current = false;
          helpToolConfigsRef.current = null;
          helpToolsRef.current = null;
          return;
        }

      } catch (err) {
        setError(`Help mode error: ${err instanceof Error ? err.message : String(err)}`);
        setIsLoading(false);
        helpModeActiveRef.current = false;
        helpToolConfigsRef.current = null;
        helpToolsRef.current = null;
        return;
      }

      setIsLoading(false); // Reset before continuing to normal flow
    }

    const newUserMessage: ChatMessage = {
      role: 'user',
      content: userMessage,
    };

    const baseMessages = [...messages, newUserMessage];

    setIsLoading(true);
    setError(null);

    try {
      const startTime = performance.now();

      // Use helpToolConfigsRef and helpToolsRef if available (from /help), otherwise use state
      const activeToolConfigs = helpToolConfigsRef.current || mcpToolConfigs;
      const activeTools = helpToolsRef.current || mcpTools;

      if (import.meta.env.DEV) {
        console.log('[handleSend] DEBUG: mcpTools state:', mcpTools.length);
        console.log('[handleSend] DEBUG: helpToolsRef.current:', helpToolsRef.current?.length);
        console.log('[handleSend] DEBUG: activeTools:', activeTools.length);
        console.log('[handleSend] DEBUG: activeTools names:', activeTools.map(t => t.name));
        console.log('[handleSend] DEBUG: helpToolConfigsRef.current:', helpToolConfigsRef.current);
        console.log('[handleSend] DEBUG: mcpToolConfigs state:', mcpToolConfigs);
        console.log('[handleSend] DEBUG: activeToolConfigs:', activeToolConfigs);
        console.log('[handleSend] DEBUG: helpModeActive state:', helpModeActive);
        console.log('[handleSend] DEBUG: helpModeActiveRef:', helpModeActiveRef.current);
      }

      // Получаем выбранные инструменты
      const selectedTools = activeTools.filter(
        (tool) => activeToolConfigs[tool.name]?.selected,
      );

      if (import.meta.env.DEV) {
        console.log('[handleSend] Active tool configs:', activeToolConfigs);
        console.log('[handleSend] Selected tools:', selectedTools.map(t => t.name));
        console.log('[handleSend] Using help mode configs:', helpToolConfigsRef.current !== null);
      }

      // ====== NEW ORCHESTRATION LOGIC ======
      // Determine if orchestration is needed:
      // 1. Multiple tools selected, OR
      // 2. Single RAG tool selected
      const needsOrchestration =
        selectedTools.length > 1 ||
        (selectedTools.length === 1 && (
          selectedTools[0].name.includes('rag_data') || selectedTools[0].name.startsWith('rag_')
        ));

      if (import.meta.env.DEV) {
        console.log('[handleSend] Needs orchestration:', needsOrchestration);
      }

      // If orchestration is needed, use new flow
      if (needsOrchestration && selectedTools.length > 0) {
        if (import.meta.env.DEV) {
          console.log('[handleSend] Using orchestration flow for tools:', selectedTools.map(t => t.name));
        }

        // 1. Orchestrate all tool calls sequentially (RAG first if present)
        const orchestratedResults = await orchestrateToolCalls(
          selectedTools,
          userMessage,
          activeToolConfigs
        );

        // 2. Build enhanced system prompt with aggregated tool data
        const enhancedSystemPromptWithData = buildEnhancedSystemPromptWithToolData(
          systemPrompt,
          orchestratedResults
        );

        // 3. Prepare messages for API
        const messagesToSendToAPI = getMessagesForAPI(baseMessages);

        // 4. Make single LLM call WITHOUT tools parameter (no function calling)
        let assistantResponse: string;
        let tokenUsage: TokenUsage | undefined;
        let totalTokens: number | undefined;

        if (selectedModel.provider === 'gigachat') {
          const gigachatResponse = await sendGigaChatMessage(
            messagesToSendToAPI,
            enhancedSystemPromptWithData,
            temperature,
            undefined, // No tools parameter - no function calling
          );
          assistantResponse = gigachatResponse.content;
          tokenUsage = gigachatResponse.tokenUsage;
        } else if (selectedModel.provider === 'openrouter') {
          const openRouterResponse = await sendOpenRouterMessage(
            messagesToSendToAPI,
            enhancedSystemPromptWithData,
            temperature,
          );
          assistantResponse = openRouterResponse.content;
          tokenUsage = openRouterResponse.tokenUsage;
        } else {
          const hfResponse = await sendHuggingFaceMessage(
            messagesToSendToAPI,
            selectedModel.modelId as HuggingFaceModel,
            enhancedSystemPromptWithData,
            temperature,
          );
          assistantResponse = hfResponse.content;
          totalTokens = hfResponse.totalTokens;
        }

        // Calculate duration
        const totalEndTime = performance.now();
        const totalDuration = totalEndTime - startTime;

        // Create assistant message
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: assistantResponse,
          totalTokens,
          tokenUsage,
          duration: totalDuration,
        };

        // Update messages
        const messagesWithAssistant = [...baseMessages, assistantMessage];
        setMessages(messagesWithAssistant);

        // Update response count and check for compression
        const newCount = assistantResponseCount + 1;
        setAssistantResponseCount(newCount);

        if (newCount % 5 === 0) {
          performCompression(messagesWithAssistant);
        }

        // Cleanup help mode tools (one-time use)
        if (helpModeActiveRef.current) {
          disableAllTools();
          setHelpModeActive(false);
          helpModeActiveRef.current = false;
          helpToolConfigsRef.current = null;
          helpToolsRef.current = null;

          if (import.meta.env.DEV) {
            console.log('[Help Mode] Tools disabled after orchestration');
          }
        }

        // Exit early - orchestration flow complete
        setIsLoading(false);
        return;
      }

      // ====== EXISTING REACTIVE FLOW (for single non-RAG tool or no tools) ======
      if (import.meta.env.DEV && !needsOrchestration) {
        console.log('[handleSend] Using existing reactive flow (single non-RAG tool or no tools)');
      }

      // Конвертируем MCP инструменты в формат GigaChat (только для GigaChat)
      const gigaChatTools = selectedModel.provider === 'gigachat' && selectedTools.length > 0
        ? convertMCPToolsToGigaChatTools(selectedTools)
        : undefined;

      // Строим минимальный system prompt
      const enhancedSystemPrompt = buildMinimalSystemPrompt(
        systemPrompt,
        selectedTools.length > 0
      );

      if (import.meta.env.DEV) {
        console.log('[handleSend] Enhanced system prompt length:', enhancedSystemPrompt.length);
        if (gigaChatTools) {
          console.log('[handleSend] GigaChat tools:', gigaChatTools.map(t => t.name));
        }
      }

      // Подготавливаем сообщения для отправки в API
      const messagesToSendToAPI = getMessagesForAPI(baseMessages);

      // Делаем ОДИН запрос к LLM
      let assistantResponse: string;
      let tokenUsage: TokenUsage | undefined;
      let totalTokens: number | undefined;
      let functionCallData: { name: string; arguments: Record<string, unknown> } | undefined;

      if (selectedModel.provider === 'gigachat') {
        const gigachatResponse = await sendGigaChatMessage(
          messagesToSendToAPI,
          enhancedSystemPrompt,
          temperature,
          gigaChatTools, // Передаем functions только для GigaChat
        );
        assistantResponse = gigachatResponse.content;
        tokenUsage = gigachatResponse.tokenUsage;
        functionCallData = gigachatResponse.function_call;
      } else if (selectedModel.provider === 'openrouter') {
        const openRouterResponse = await sendOpenRouterMessage(
          messagesToSendToAPI,
          enhancedSystemPrompt,
          temperature,
        );
        assistantResponse = openRouterResponse.content;
        tokenUsage = openRouterResponse.tokenUsage;
      } else {
        const hfResponse = await sendHuggingFaceMessage(
          messagesToSendToAPI,
          selectedModel.modelId as HuggingFaceModel,
          enhancedSystemPrompt,
          temperature,
        );
        assistantResponse = hfResponse.content;
        totalTokens = hfResponse.totalTokens;
      }

      // Обработка function_call (если получен от GigaChat)
      if (functionCallData && selectedModel.provider === 'gigachat') {
        if (import.meta.env.DEV) {
          console.log('[handleSend] Function call received from GigaChat API:', functionCallData);
          console.log('[handleSend] This suggests GigaChat should handle MCP tools internally, but it returned a function call instead');
        }

        try {
          // Use active tool configs (from ref or state)
          const activeToolConfigs = helpToolConfigsRef.current || mcpToolConfigs;

          // Объединяем аргументы из конфига с аргументами из function_call
          const toolConfig = activeToolConfigs[functionCallData.name] || { selected: false, args: {} };

          // ✅ Сначала применяем предустановленные аргументы из конфига, затем аргументы от GigaChat
          const mergedArgs = {
            ...(toolConfig.args || {}),           // Предустановленные аргументы из /help или ручной настройки
            ...functionCallData.arguments,        // Динамические аргументы от GigaChat (приоритет)
          };

          // Для rag_data добавляем query из пользовательского сообщения, если его нет
          if (functionCallData.name === 'rag_data') {
            if (!mergedArgs.query) {
              mergedArgs.query = userMessage;
            }
          }

          // Inject user_id for cloud_flow tools
          const activeTools = helpToolsRef.current || mcpTools;
          const toolInfo = activeTools?.find((t: MCPToolWithServer) => t.name === functionCallData.name);
          if (toolInfo?.serverName === 'cloud_flow') {
            mergedArgs.user_id = selectedUserId;
          }

          // Логирование для отладки
          if (import.meta.env.DEV) {
            console.log(`[handleSend] Tool config args:`, toolConfig.args);
            console.log(`[handleSend] GigaChat function_call args:`, functionCallData.arguments);
            console.log(`[handleSend] Merged args for "${functionCallData.name}":`, mergedArgs);
          }

          const toolResult = await callMCPTool(functionCallData.name, mergedArgs);

          // Log the RAG response for debugging
          if (functionCallData.name === 'rag_data') {
            console.log('[RAG Response] Tool result received:', toolResult);

            // Additional logging to understand the structure
            if (toolResult && typeof toolResult === 'object' && 'content' in toolResult) {
              console.log('[RAG Response] Content structure:', (toolResult as any).content);
            }
          }

          // Transform the RAG response to a format compatible with GigaChat API
          let processedResult = toolResult;

          if (functionCallData.name === 'rag_data') {
            if (toolResult && typeof toolResult === 'object' && 'content' in toolResult) {
              const resultObj = toolResult as { content: Array<{ type: string; text: string }> };

              if (Array.isArray(resultObj.content) && resultObj.content.length > 0) {
                // Log the original structure for debugging
                console.log('[RAG Response] Original structure for API:', toolResult);

                // For GigaChat API, we should send back the result in the same schema as defined in return_parameters
                // which matches the original RAG response structure: { content: [...] }
                processedResult = toolResult; // Send the original structure back

                console.log('[RAG Response] Sending back to API:', processedResult);
              } else {
                // If the expected structure is not found, log an error
                console.error('[RAG Response] Expected content array not found in RAG response:', toolResult);
                // Fallback: send the original result
                processedResult = toolResult;
              }
            } else {
              // If the response doesn't have the expected structure, log an error
              console.error('[RAG Response] Unexpected RAG response structure:', toolResult);
              // Fallback: send the original result
              processedResult = toolResult;
            }
          }

          const functionResultMessage: ChatMessage = {
            role: 'user',
            content: `[Результат выполнения функции "${functionCallData.name}"]\n\n${formatToolResult(functionCallData.name, mergedArgs, processedResult)}`,
          };

          // Create a new conversation with the function result
          const messagesWithFunctionResult = [...baseMessages, {
            role: 'assistant' as const,
            content: assistantResponse, // Initial response that triggered the function call
            tokenUsage,
            duration: performance.now() - startTime,
          }, functionResultMessage];

          // Make a second request to get the final response incorporating the function result
          // Send full context instead of slice(-10) to avoid losing important information
          // Pass tools again to allow additional tool calls if needed
          const finalResponse = await sendGigaChatMessage(
            messagesWithFunctionResult,
            enhancedSystemPrompt,
            temperature,
            gigaChatTools, // ✅ Pass tools again for potential additional calls
          );

          assistantResponse = finalResponse.content;
          tokenUsage = finalResponse.tokenUsage;

          if (import.meta.env.DEV) {
            console.log('[handleSend] Final response after function execution received');
            if (finalResponse.function_call) {
              console.log('[handleSend] Additional function call received:', finalResponse.function_call);
            }
          }

          // In help mode, force call all remaining tools even if GigaChat doesn't request them
          let forcedToolCall: { name: string; arguments: Record<string, unknown> } | null = null;

          if (helpModeActiveRef.current && !finalResponse.function_call) {
            // Find tools that haven't been called yet
            const calledToolName = functionCallData.name;
            const remainingTools = selectedTools.filter(tool =>
              tool.name !== calledToolName && activeToolConfigs[tool.name]?.selected
            );

            if (remainingTools.length > 0) {
              // Force call the first remaining tool (usually rag_data)
              const toolToCall = remainingTools[0];
              forcedToolCall = {
                name: toolToCall.name,
                arguments: activeToolConfigs[toolToCall.name]?.args || {},
              };

              if (import.meta.env.DEV) {
                console.log('[Help Mode] Forcing call to remaining tool:', forcedToolCall);
              }
            }
          }

          // Handle additional function call if present (e.g., rag_data after git_status)
          // OR forced tool call in help mode
          if (finalResponse.function_call || forcedToolCall) {
            const secondFunctionCall = finalResponse.function_call || forcedToolCall!;

            try {
              // Merge arguments for second tool
              const secondToolConfig = activeToolConfigs[secondFunctionCall.name] || { selected: false, args: {} };
              const secondMergedArgs = {
                ...(secondToolConfig.args || {}),
                ...secondFunctionCall.arguments,
              };

              if (secondFunctionCall.name === 'rag_data' && !secondMergedArgs.query) {
                secondMergedArgs.query = userMessage;
              }

              // Inject user_id for cloud_flow tools
              const secondToolInfo = activeTools?.find((t: MCPToolWithServer) => t.name === secondFunctionCall.name);
              if (secondToolInfo?.serverName === 'cloud_flow') {
                secondMergedArgs.user_id = selectedUserId;
              }

              if (import.meta.env.DEV) {
                console.log(`[handleSend] Executing second tool "${secondFunctionCall.name}" with args:`, secondMergedArgs);
              }

              const secondToolResult = await callMCPTool(secondFunctionCall.name, secondMergedArgs);

              const secondFunctionResultMessage: ChatMessage = {
                role: 'user',
                content: `[Результат выполнения функции "${secondFunctionCall.name}"]\n\n${formatToolResult(secondFunctionCall.name, secondMergedArgs, secondToolResult)}`,
              };

              // Create conversation with both tool results
              const messagesWithBothResults = [...messagesWithFunctionResult, {
                role: 'assistant' as const,
                content: assistantResponse,
                tokenUsage,
                duration: performance.now() - startTime,
              }, secondFunctionResultMessage];

              // Final request with both tool results (no tools this time)
              const finalFinalResponse = await sendGigaChatMessage(
                messagesWithBothResults,
                enhancedSystemPrompt,
                temperature,
                undefined, // No more tools after second call
              );

              assistantResponse = finalFinalResponse.content;
              tokenUsage = finalFinalResponse.tokenUsage;

              if (import.meta.env.DEV) {
                console.log('[handleSend] Final response after second function execution received');
              }
            } catch (secondToolError) {
              console.error('[handleSend] Error executing second tool:', secondToolError);
              // Continue with previous response
            }
          }
        } catch (toolError) {
          console.error('[handleSend] Error executing tool:', toolError);

          // If tool execution fails, inform the user
          const errorMessage = toolError instanceof Error
            ? toolError.message
            : `Failed to execute tool "${functionCallData.name}"`;
          assistantResponse = `**Ошибка выполнения инструмента ${functionCallData.name}:**\n\n${errorMessage}`;
        }
      }

      // Вычисляем общую длительность запроса (включая обработку функций)
      const totalEndTime = performance.now();
      const totalDuration = totalEndTime - startTime;

      // Создаем сообщение ассистента
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: assistantResponse,
        totalTokens,
        tokenUsage,
        duration: totalDuration,
      };

      // Обновляем состояние сообщений
      const messagesWithAssistant = [...baseMessages, assistantMessage];
      setMessages(messagesWithAssistant);

      // Увеличиваем счетчик ответов и проверяем на необходимость сжатия
      const newCount = assistantResponseCount + 1;
      setAssistantResponseCount(newCount);

      if (newCount % 5 === 0) {
        performCompression(messagesWithAssistant);
      }

      // Cleanup help mode tools (one-time use)
      if (helpModeActiveRef.current) {
        disableAllTools();
        setHelpModeActive(false);
        helpModeActiveRef.current = false;
        helpToolConfigsRef.current = null;
        helpToolsRef.current = null;

        if (import.meta.env.DEV) {
          console.log('[Help Mode] Tools disabled after one-time use');
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Произошла ошибка при отправке сообщения',
      );
      setMessages(messages);

      // Cleanup help mode on error
      if (helpModeActiveRef.current) {
        disableAllTools();
        setHelpModeActive(false);
        helpModeActiveRef.current = false;
        helpToolConfigsRef.current = null;
        helpToolsRef.current = null;
      }
    } finally {
      setIsLoading(false);
    }
  };

  const performCompression = async (currentMessages: ChatMessage[]) => {
    try {
      const summaryMessage = await compressMessages(
        currentMessages,
        selectedModel
      );

      // APPEND summary to messages (don't replace - keep all messages visible)
      setMessages(prevMessages => {
        // Remove old summary if exists
        const withoutOldSummary = prevMessages.filter(msg =>
          !(msg.role === 'system' && msg.content.startsWith(SUMMARY_MARKER))
        );

        // Append new summary at the end
        return [...withoutOldSummary, summaryMessage];
      });

      console.log('Compression successful');
    } catch (error) {
      console.error('Compression failed, continuing without compression:', error);
      // Do nothing - messages remain unchanged
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
    setAssistantResponseCount(0);
    setCurrentConversationIdState(null);
    setCurrentConversationId(null);
  };

  const handleNewConversation = () => {
    // Если есть сообщения, сохраняем текущий диалог
    if (messages.length > 0) {
      const existingConversation = currentConversationId 
        ? loadConversation(currentConversationId) 
        : null;

      const conversation: SavedConversation = {
        id: currentConversationId || '',
        title: generateConversationTitle(messages),
        createdAt: existingConversation?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        systemPrompt,
        messages,
        modelConfig: selectedModel,
        temperature,
        assistantResponseCount,
        selectedUserId,
      };

      // Если нет ID, создаем новый
      if (!conversation.id) {
        const newConv = createNewConversation(systemPrompt, selectedModel, temperature);
        conversation.id = newConv.id;
        conversation.createdAt = newConv.createdAt;
      }

      saveConversation(conversation);
    }

    // Очищаем состояние для нового диалога
    setMessages([]);
    setError(null);
    setAssistantResponseCount(0);
    setCurrentConversationIdState(null);
    setCurrentConversationId(null);
  };

  const handleLoadConversation = (conversation: SavedConversation) => {
    setMessages(conversation.messages);
    setSystemPrompt(conversation.systemPrompt);
    setSelectedModel(conversation.modelConfig);
    setTemperature(conversation.temperature);
    setAssistantResponseCount(conversation.assistantResponseCount);
    setSelectedUserId(conversation.selectedUserId || 101);
    setCurrentConversationIdState(conversation.id);
    setError(null);
  };

  const handleOpenMCPTools = async () => {
    setIsMCPModalOpen(true);
    setMcpLoading(true);
    setMcpError(null);

    try {
      const response = await getMCPTools();
      setMcpTools(response.tools);
      setMcpServerStatuses(response.serverStatuses);

      // Log connection summary
      const connected = Object.entries(response.serverStatuses)
        .filter(([, status]) => status.connected)
        .map(([name]) => name);
      console.log('[MCP] Connected servers:', connected.join(', '));
    } catch (error) {
      setMcpError(
        error instanceof Error
          ? error.message
          : 'Failed to fetch MCP tools'
      );
    } finally {
      setMcpLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex justify-between items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-800">AI Chat</h1>

          <div className="flex-1 flex justify-center items-center gap-4">
            <ModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              disabled={isLoading}
            />
            <TemperatureSlider
              value={temperature}
              onChange={setTemperature}
            />
            <UserIdSelector
              value={selectedUserId}
              onChange={setSelectedUserId}
              disabled={isLoading}
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setIsConversationManagerOpen(true)}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
            >
              Сохраненные диалоги
            </button>
            <button
              onClick={() => setIsPromptEditorOpen(true)}
              className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm"
            >
              Редактировать промпт
            </button>
            <button
              onClick={handleOpenMCPTools}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm"
            >
              MCP Tools
            </button>
            <button
              onClick={handleNewConversation}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm"
            >
              Создать новый диалог
            </button>
            <button
              onClick={handleClear}
              disabled={messages.length === 0}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm"
            >
              Очистить диалог
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 mt-20">
              <p className="text-lg">Начните диалог с AI</p>
            </div>
          )}

          {messages
            .filter(message =>
              !(message.role === 'system' && message.content.startsWith(SUMMARY_MARKER))
            )
            .map((message, index) => {
            const isUser = message.role === 'user';
            return (
              <div
                key={index}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    isUser
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-800 border border-gray-200'
                  }`}
                >
                  <ReactMarkdown
                    className="break-words"
                    components={{
                      h1: ({ children }) => (
                        <h1 className={`text-2xl font-bold mt-4 mb-2 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className={`text-xl font-bold mt-3 mb-2 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className={`text-lg font-semibold mt-2 mb-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h3>
                      ),
                      h4: ({ children }) => (
                        <h4 className={`text-base font-semibold mt-2 mb-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h4>
                      ),
                      h5: ({ children }) => (
                        <h5 className={`text-sm font-semibold mt-1 mb-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h5>
                      ),
                      h6: ({ children }) => (
                        <h6 className={`text-xs font-semibold mt-1 mb-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </h6>
                      ),
                      p: ({ children }) => (
                        <p className={`mb-2 last:mb-0 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </p>
                      ),
                      ul: ({ children }) => (
                        <ul className={`list-disc list-inside mb-2 space-y-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className={`list-decimal list-inside mb-2 space-y-1 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => (
                        <li className={`ml-2 ${isUser ? 'text-white' : 'text-gray-800'}`}>
                          {children}
                        </li>
                      ),
                      strong: ({ children }) => (
                        <strong className={`font-bold ${isUser ? 'text-white' : 'text-gray-900'}`}>
                          {children}
                        </strong>
                      ),
                      em: ({ children }) => (
                        <em className={`italic ${isUser ? 'text-white' : 'text-gray-700'}`}>
                          {children}
                        </em>
                      ),
                      code: ({ children, className }) => {
                        const isInline = !className;
                        if (isInline) {
                          return (
                            <code
                              className={`px-1 py-0.5 rounded text-sm font-mono ${
                                isUser
                                  ? 'bg-blue-600 bg-opacity-50 text-white'
                                  : 'bg-gray-100 text-gray-900'
                              }`}
                            >
                              {children}
                            </code>
                          );
                        }
                        return <code className={className}>{children}</code>;
                      },
                      pre: ({ children }) => (
                        <pre
                          className={`p-3 rounded-lg overflow-x-auto mb-2 text-sm font-mono ${
                            isUser
                              ? 'bg-blue-600 bg-opacity-50 text-white'
                              : 'bg-gray-900 text-gray-100'
                          }`}
                        >
                          {children}
                        </pre>
                      ),
                      a: ({ children, href }) => (
                        <a
                          href={href}
                          className={`underline hover:opacity-80 ${
                            isUser ? 'text-blue-200' : 'text-blue-600'
                          }`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
                {!isUser && (message.tokenUsage || message.totalTokens !== undefined || message.duration !== undefined) && (
                  <div className="mt-2 px-4">
                    <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700 space-y-1.5 border border-gray-200">
                      {message.tokenUsage ? (
                        <>
                          <div>
                            Токены запроса: <span className="text-blue-600 font-semibold">{message.tokenUsage.prompt_tokens}</span> • 
                            Токены генерации: <span className="text-green-600 font-semibold">{message.tokenUsage.completion_tokens}</span>
                            {message.tokenUsage.precached_prompt_tokens !== undefined && (
                              <> • Кэшированные: <span className="text-indigo-600 font-semibold">{message.tokenUsage.precached_prompt_tokens}</span></>
                            )}
                          </div>
                          <div>
                            Всего токенов (к тарификации): <span className="text-amber-600 font-semibold">{message.tokenUsage.total_tokens}</span>
                            {message.duration !== undefined && (
                              <> • Время выполнения: <span className="text-slate-600 font-medium">{formatDuration(message.duration)}</span></>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {message.totalTokens !== undefined && (
                            <>
                              Токенов использовано: <span className="text-amber-600 font-semibold">{message.totalTokens}</span>
                            </>
                          )}
                          {message.totalTokens !== undefined && message.duration !== undefined && ' • '}
                          {message.duration !== undefined && (
                            <>
                              Время выполнения: <span className="text-slate-600 font-medium">{formatDuration(message.duration)}</span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                  <span className="text-gray-600">Думаю...</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg">
              <p className="font-semibold">Ошибка:</p>
              <p>{error}</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-t border-gray-200 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <MessageInput 
            onSend={handleSend} 
            disabled={isLoading}
          />
        </div>
      </div>

      <PromptEditor
        isOpen={isPromptEditorOpen}
        currentPrompt={systemPrompt}
        defaultPrompt={''}
        onClose={() => setIsPromptEditorOpen(false)}
        onSave={(prompt) => setSystemPrompt(prompt)}
        onReset={() => setSystemPrompt('')}
      />

      <ConversationManager
        isOpen={isConversationManagerOpen}
        onClose={() => setIsConversationManagerOpen(false)}
        onLoadConversation={handleLoadConversation}
      />

      <MCPToolsModal
        isOpen={isMCPModalOpen}
        onClose={() => setIsMCPModalOpen(false)}
        tools={mcpTools}
        isLoading={mcpLoading}
        error={mcpError}
        toolConfigs={mcpToolConfigs}
        onToggleTool={handleToggleMCPTool}
        onUpdateToolArgs={handleUpdateToolArgs}
        serverStatuses={mcpServerStatuses}
      />
    </div>
  );
}
