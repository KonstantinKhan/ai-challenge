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
