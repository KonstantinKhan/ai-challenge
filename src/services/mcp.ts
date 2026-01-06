/**
 * MCP (Model Context Protocol) Service - RAG Server
 *
 * This service manages MCP client connection to the RAG server
 * and provides functions to interact with it.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  MCPServerConfig,
  MCPToolWithServer,
  MultiServerMCPToolsResponse
} from '../types/mcp';
import { DualChannelTransport } from './mcpTransport.js';

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

  // RAG MCP server (единственный)
  const ragUrl = import.meta.env.DEV
    ? `${window.location.origin}/api/rag`
    : 'http://localhost:8082/';

  configs.push({
    name: 'rag',
    url: ragUrl,
    displayName: 'RAG Search',
    enabled: true,
  });

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
    // RAG server uses dual-channel protocol (HTTP+SSE)
    const transport: Transport = new DualChannelTransport(new URL(config.url));

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
      'RAG MCP server not configured. Check port 8082'
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
  // Initialize all servers and capture connection status
  const { failed: failedConnections } = await initMCPClient();

  const toolsWithServer: MCPToolWithServer[] = [];
  const serverStatuses: Record<string, {
    connected: boolean;
    error?: string;
    toolCount: number;
  }> = {};

  // Pre-populate statuses with connection failures
  failedConnections.forEach(({ name, error }) => {
    serverStatuses[name] = {
      connected: false,
      error: error || 'Failed to connect',
      toolCount: 0,
    };
  });

  // If no servers connected at all, return early
  if (mcpServers.size === 0) {
    console.warn('[MCP] No servers connected, returning empty tools list.');
    return {
      tools: [],
      serverStatuses,
    };
  }

  // Fetch tools from each successfully connected server
  const fetchResults = await Promise.allSettled(
    Array.from(mcpServers.entries()).map(async ([serverName, connection]) => {
      const result = await connection.client.listTools();
      return { serverName, config: connection.config, tools: result.tools };
    })
  );

  // Process results
  fetchResults.forEach((result) => {
    if (result.status === 'fulfilled') {
      const { serverName, config, tools } = result.value;

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
        serverUrl: config.url,
      }));

      toolsWithServer.push(...transformedTools);
      serverStatuses[serverName] = {
        connected: true,
        toolCount: transformedTools.length,
      };
    } else {
      // This case might be redundant if init handles all connection errors,
      // but it's good for catching tool-listing specific errors.
      // We need to find the server name for the failed promise.
      // This is complex as the original array is not directly available.
      // For now, we log a generic error. The connection error from initMCPClient
      // should already be in serverStatuses.
      console.error('[MCP] Error fetching tools from a connected server:', result.reason);
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

    // Always log the RAG response for debugging purposes
    if (toolName === 'rag_data') {
      console.log('[RAG Response] Raw response from server:', result);

      // Additional logging to understand the structure
      if (result && typeof result === 'object' && 'content' in result) {
        console.log('[RAG Response] Content array length:', Array.isArray((result as any).content) ? (result as any).content.length : 0);
      }
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