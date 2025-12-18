/**
 * MCP (Model Context Protocol) Type Definitions
 *
 * These types define the structure for MCP tools, connection state,
 * and service responses used throughout the application.
 */

/**
 * MCP Tool representation
 * Describes a tool available from an MCP server
 */
/**
 * JSON Schema property definition
 */
export interface JSONSchemaProperty {
  type?: string;
  description?: string;
  [key: string]: unknown;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
  outputSchema?: {
    type: 'object';
    properties?: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/**
 * MCP Connection state
 * Tracks the current state of the MCP client connection
 */
export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * MCP Error types
 * Structured error information for MCP operations
 */
export interface MCPError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * MCP Service response
 * Response structure from getMCPTools service function
 */
export interface MCPToolsResponse {
  tools: MCPTool[];
  nextCursor?: string;
}

/**
 * MCP Server configuration
 * Defines connection details for a specific MCP server
 */
export interface MCPServerConfig {
  name: string;           // Unique identifier (e.g., 'local', 'tavily')
  url: string;            // Full URL to MCP endpoint
  displayName: string;    // Human-readable name for UI
  enabled: boolean;       // Whether this server should be connected
  apiKey?: string;        // Optional API key for Authorization header
}

/**
 * MCP Tool with server metadata
 * Extends MCPTool to include information about which server provides it
 */
export interface MCPToolWithServer extends MCPTool {
  serverName: string;     // Which server provides this tool
  serverUrl: string;      // Server URL for debugging/logging
}

/**
 * Multi-server MCP response
 * Response structure when fetching tools from multiple MCP servers
 */
export interface MultiServerMCPToolsResponse {
  tools: MCPToolWithServer[];
  serverStatuses: Record<string, {
    connected: boolean;
    error?: string;
    toolCount: number;
  }>;
}
