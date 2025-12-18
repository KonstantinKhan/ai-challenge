/**
 * MCP (Model Context Protocol) Service - Multi-Server Support
 *
 * This service manages multiple MCP client connections and provides
 * functions to interact with multiple remote MCP servers.
 *
 * Supports graceful degradation - if one server fails, others continue to work.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  MCPTool,
  MCPServerConfig,
  MCPToolWithServer,
  MultiServerMCPToolsResponse
} from '../types/mcp';
import { DualChannelTransport } from './mcpTransport.js';
import { StreamableHttpTransport } from './streamableHttpTransport.js';

// Server connection registry (replaces singleton pattern)
interface ServerConnection {
  client: Client;
  transport: Transport;
  config: MCPServerConfig;
}

const mcpServers = new Map<string, ServerConnection>();
const connectingServers = new Set<string>();

/**
 * Get server configurations from environment variables
 */
function getServerConfigs(): MCPServerConfig[] {
  const configs: MCPServerConfig[] = [];

  // Primary MCP server (existing local server)
  const primaryUrl = import.meta.env.VITE_MCP_SERVER_URL;
  if (primaryUrl) {
    configs.push({
      name: 'local',
      url: primaryUrl,
      displayName: 'Local MCP Server',
      enabled: true,
    });
  }

  // Tavily MCP server (new web search server)
  const tavilyApiKey = import.meta.env.VITE_TAWILY_KEY;
  if (tavilyApiKey) {
    console.log('[MCP] Tavily API key found:', tavilyApiKey ? 'Yes' : 'No');

    // Use proxy in dev mode to avoid CORS
    // API key will be sent via Authorization header instead of query parameter
    const tavilyUrl = import.meta.env.DEV
      ? `${window.location.origin}/api/tavily-mcp`
      : `https://mcp.tavily.com/mcp/`;

    console.log('[MCP] Tavily URL will be:', tavilyUrl);
    configs.push({
      name: 'tavily',
      url: tavilyUrl,
      displayName: 'Tavily Web Search',
      enabled: true,
      apiKey: tavilyApiKey, // API key for Authorization header
    });
  } else {
    console.log('[MCP] Tavily API key NOT found - server will not be configured');
  }

  return configs;
}

/**
 * Initialize connection to a specific MCP server
 * Returns existing connection if already connected
 */
async function initMCPServer(config: MCPServerConfig): Promise<Client> {
  // Return existing connection
  const existing = mcpServers.get(config.name);
  if (existing) {
    return existing.client;
  }

  // Prevent concurrent initialization
  if (connectingServers.has(config.name)) {
    throw new Error(`Connection to ${config.name} already in progress`);
  }

  console.log(`[MCP] Connecting to ${config.displayName} at:`, config.url);
  connectingServers.add(config.name);

  try {
    // Choose appropriate transport based on server
    // - Local server uses old dual-channel protocol (HTTP+SSE with endpoint event)
    // - Tavily uses new Streamable HTTP protocol (2025-06-18)
    const transport: Transport = config.name === 'tavily'
      ? new StreamableHttpTransport(new URL(config.url), config.apiKey)
      : new DualChannelTransport(new URL(config.url));

    if (import.meta.env.DEV) {
      console.log(`[MCP] Using ${config.name === 'tavily' ? 'StreamableHttpTransport' : 'DualChannelTransport'} for ${config.name}`);
    }

    // Create client with basic configuration
    const client = new Client(
      {
        name: `ai-chat-client-${config.name}`,
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // Connect to server
    await client.connect(transport);

    // Store connection
    mcpServers.set(config.name, {
      client,
      transport,
      config,
    });

    console.log(`[MCP] ✓ Connected to ${config.displayName}`);
    return client;
  } catch (error) {
    console.error(`[MCP] ✗ Failed to connect to ${config.displayName}:`, error);
    throw new Error(
      `Failed to connect to ${config.displayName}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  } finally {
    connectingServers.delete(config.name);
  }
}

/**
 * Initialize all configured MCP servers
 * Returns partial success - connects to available servers even if some fail
 */
export async function initMCPClient(): Promise<{
  connected: string[];
  failed: Array<{ name: string; error: string }>;
}> {
  const configs = getServerConfigs();

  if (configs.length === 0) {
    throw new Error(
      'No MCP servers configured. Please set VITE_MCP_SERVER_URL or VITE_TAWILY_KEY'
    );
  }

  // Try to connect to all enabled servers in parallel
  const results = await Promise.allSettled(
    configs.filter(c => c.enabled).map(config => initMCPServer(config))
  );

  const connected: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  results.forEach((result, index) => {
    const config = configs.filter(c => c.enabled)[index];
    if (result.status === 'fulfilled') {
      connected.push(config.name);
    } else {
      failed.push({
        name: config.name,
        error: result.reason.message,
      });
    }
  });

  if (connected.length > 0) {
    console.log(`[MCP] Connected to servers: ${connected.join(', ')}`);
  }
  if (failed.length > 0) {
    console.warn(`[MCP] Failed servers: ${failed.map(f => f.name).join(', ')}`);
  }

  return { connected, failed };
}

/**
 * Fetch tools from all connected MCP servers
 * Merges tools and adds server metadata
 */
export async function getMCPTools(): Promise<MultiServerMCPToolsResponse> {
  // Initialize all servers if not connected
  if (mcpServers.size === 0) {
    await initMCPClient();
  }

  if (mcpServers.size === 0) {
    throw new Error('No MCP servers connected');
  }

  const toolsWithServer: MCPToolWithServer[] = [];
  const serverStatuses: Record<string, {
    connected: boolean;
    error?: string;
    toolCount: number;
  }> = {};

  // Fetch tools from each server in parallel
  const fetchResults = await Promise.allSettled(
    Array.from(mcpServers.entries()).map(async ([serverName, connection]) => {
      const result = await connection.client.listTools();
      return { serverName, config: connection.config, tools: result.tools };
    })
  );

  // Process results
  fetchResults.forEach((result, index) => {
    const [serverName, connection] = Array.from(mcpServers.entries())[index];

    if (result.status === 'fulfilled') {
      const { tools } = result.value;

      // Transform and tag tools with server info
      const transformedTools: MCPToolWithServer[] = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object' as const,
          properties: tool.inputSchema.properties as Record<string, {
            type?: string;
            description?: string;
            [key: string]: unknown;
          }> | undefined,
          required: tool.inputSchema.required,
        },
        outputSchema: tool.outputSchema ? {
          type: 'object' as const,
          properties: tool.outputSchema.properties as Record<string, {
            type?: string;
            description?: string;
            [key: string]: unknown;
          }> | undefined,
          required: tool.outputSchema.required as string[] | undefined,
        } : undefined,
        annotations: tool.annotations ? {
          title: tool.annotations.title,
          readOnlyHint: tool.annotations.readOnlyHint,
          destructiveHint: tool.annotations.destructiveHint,
          idempotentHint: tool.annotations.idempotentHint,
          openWorldHint: tool.annotations.openWorldHint,
        } : undefined,
        serverName,
        serverUrl: connection.config.url,
      }));

      toolsWithServer.push(...transformedTools);

      serverStatuses[serverName] = {
        connected: true,
        toolCount: transformedTools.length,
      };
    } else {
      // Server exists but tool fetch failed
      serverStatuses[serverName] = {
        connected: false,
        error: result.reason?.message || 'Failed to fetch tools',
        toolCount: 0,
      };
    }
  });

  return {
    tools: toolsWithServer,
    serverStatuses,
  };
}

/**
 * Call a specific MCP tool by name with provided arguments
 * Automatically routes to correct server based on tool->server mapping
 */
export async function callMCPTool(
  toolName: string,
  args: Record<string, unknown> = {},
  serverName?: string  // Optional: specify server explicitly
): Promise<unknown> {
  try {
    let connection: ServerConnection | undefined;

    // If server specified, use it directly
    if (serverName) {
      connection = mcpServers.get(serverName);
      if (!connection) {
        throw new Error(`Server "${serverName}" not connected`);
      }
    } else {
      // Find server that provides this tool
      const toolsResponse = await getMCPTools();
      const tool = toolsResponse.tools.find(t => t.name === toolName);

      if (!tool) {
        const availableTools = toolsResponse.tools.map(t => t.name).join(', ');
        throw new Error(
          `Tool "${toolName}" not found in any connected server. ` +
          `Available tools: ${availableTools}`
        );
      }

      connection = mcpServers.get(tool.serverName);

      if (!connection) {
        throw new Error(
          `Server "${tool.serverName}" for tool "${toolName}" not connected. ` +
          `Check MCP Tools modal for server status.`
        );
      }
    }

    // Call the tool
    if (import.meta.env.DEV) {
      console.log(`[callMCPTool] Calling tool "${toolName}" on server "${connection.config.name}"`, args);
    }

    const result = await connection.client.callTool({
      name: toolName,
      arguments: args,
    });

    if (import.meta.env.DEV) {
      console.log(`[callMCPTool] Tool "${toolName}" returned:`, result);
    }

    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to call MCP tool "${toolName}": ${error.message}`);
    }
    throw new Error(`Failed to call MCP tool "${toolName}": Unknown error`);
  }
}

/**
 * Close all MCP connections and clean up resources
 */
export async function closeMCPConnection(): Promise<void> {
  const closePromises = Array.from(mcpServers.values()).map(
    connection => connection.transport.close()
  );

  await Promise.allSettled(closePromises);
  mcpServers.clear();
  console.log('[MCP] All connections closed');
}

/**
 * Check if any MCP servers are currently connected
 */
export function isMCPConnected(): boolean {
  return mcpServers.size > 0;
}

/**
 * Get list of connected server names
 */
export function getConnectedServers(): string[] {
  return Array.from(mcpServers.keys());
}

/**
 * Get specific server configuration
 */
export function getServerInfo(serverName: string): MCPServerConfig | undefined {
  return mcpServers.get(serverName)?.config;
}