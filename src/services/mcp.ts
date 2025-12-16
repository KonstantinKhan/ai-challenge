/**
 * MCP (Model Context Protocol) Service
 *
 * This service manages the MCP client connection and provides
 * functions to interact with remote MCP servers.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { MCPTool, MCPToolsResponse } from '../types/mcp';

// Singleton pattern for MCP client
let mcpClient: Client | null = null;
let mcpTransport: Transport | null = null;
let isConnecting = false;

/**
 * Initialize MCP client connection
 * Returns existing client if already connected
 * Uses StreamableHTTP transport for browser compatibility
 */
export async function initMCPClient(): Promise<Client> {
  // Return existing client if available
  if (mcpClient && mcpTransport) {
    return mcpClient;
  }

  // Prevent concurrent initialization
  if (isConnecting) {
    throw new Error('MCP client connection already in progress');
  }

  const serverUrl = import.meta.env.VITE_MCP_SERVER_URL;

  if (!serverUrl) {
    throw new Error(
      'VITE_MCP_SERVER_URL must be set in environment variables. ' +
      'Please add it to your .env file.'
    );
  }

  // Log URL for debugging
  console.log('Connecting to MCP server at:', serverUrl);

  isConnecting = true;

  try {
    // Create SSE transport (compatible with current Ktor MCP server)
    // Explicitly set headers to ensure proper SSE connection
    mcpTransport = new SSEClientTransport(new URL(serverUrl), {
      eventSourceInit: {
        // EventSource automatically sets Accept: text/event-stream,
        // but we can add additional headers if needed
        withCredentials: false,
      },
    });

    // Create client with basic configuration
    mcpClient = new Client(
      {
        name: 'ai-chat-client',
        version: '1.0.0',
      },
      {
        capabilities: {
          // No sampling or roots capabilities needed for tool listing
        },
      }
    );

    // Connect to server
    await mcpClient.connect(mcpTransport);

    return mcpClient;
  } catch (error) {
    // Clean up on failure
    mcpClient = null;
    mcpTransport = null;

    if (error instanceof Error) {
      // Log more details for debugging
      console.error('MCP connection error:', {
        message: error.message,
        name: error.name,
        stack: error.stack,
        serverUrl,
      });
      throw new Error(`Failed to connect to MCP server: ${error.message}`);
    }
    throw new Error('Failed to connect to MCP server: Unknown error');
  } finally {
    isConnecting = false;
  }
}

/**
 * Fetch available tools from MCP server
 * Automatically initializes connection if not already connected
 */
export async function getMCPTools(): Promise<MCPToolsResponse> {
  try {
    const client = await initMCPClient();

    // Request tools list from server
    const result = await client.listTools();

    // Transform SDK types to application types
    const tools: MCPTool[] = result.tools.map((tool) => ({
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
      annotations: tool.annotations
        ? {
            title: tool.annotations.title,
            readOnlyHint: tool.annotations.readOnlyHint,
            destructiveHint: tool.annotations.destructiveHint,
            idempotentHint: tool.annotations.idempotentHint,
            openWorldHint: tool.annotations.openWorldHint,
          }
        : undefined,
    }));

    return {
      tools,
      nextCursor: result.nextCursor,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch MCP tools: ${error.message}`);
    }
    throw new Error('Failed to fetch MCP tools: Unknown error');
  }
}

/**
 * Call a specific MCP tool by name with provided arguments
 * Automatically initializes connection if not already connected
 */
export async function callMCPTool(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    const client = await initMCPClient();

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to call MCP tool "${toolName}": ${error.message}`,
      );
    }
    throw new Error(
      `Failed to call MCP tool "${toolName}": Unknown error`,
    );
  }
}

/**
 * Close MCP connection and clean up resources
 * Should be called when the application unmounts or connection is no longer needed
 */
export async function closeMCPConnection(): Promise<void> {
  if (mcpTransport) {
    await mcpTransport.close();
    mcpTransport = null;
  }
  mcpClient = null;
}

/**
 * Check if MCP client is currently connected
 */
export function isMCPConnected(): boolean {
  return mcpClient !== null && mcpTransport !== null;
}
