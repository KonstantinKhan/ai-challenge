/**
 * Streamable HTTP Transport for MCP
 *
 * Implements the new MCP Streamable HTTP transport protocol (2025-06-18)
 * Used for remote MCP servers like Tavily
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 */

import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';

/**
 * Transport for Streamable HTTP protocol
 */
export class StreamableHttpTransport implements Transport {
  private eventSource: EventSource | null = null;
  private baseUrl: URL;
  private apiKey: string | null = null;
  private isStarted = false;
  private isClosed = false;
  private sessionId: string | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  setProtocolVersion?: (version: string) => void;

  constructor(baseUrl: URL, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey || null;
  }

  /**
   * Starts the transport by opening SSE connection (GET)
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    if (this.isClosed) {
      throw new Error('Transport has been closed');
    }

    if (import.meta.env.DEV) {
      console.log('[StreamableHttpTransport] Opening SSE connection to:', this.baseUrl.toString());
    }

    // Open SSE stream for receiving server messages
    this.eventSource = new EventSource(this.baseUrl.toString());

    // Handle messages from server
    this.eventSource.onmessage = (event: MessageEvent) => {
      try {
        const data = event.data;
        if (!data || data.trim() === '' || data === 'ping') {
          // Skip empty messages and pings
          return;
        }

        const message: JSONRPCMessage = JSON.parse(data);

        if (import.meta.env.DEV) {
          console.log('[StreamableHttpTransport] Received message:', message);
        }

        // Extract session ID from InitializeResult
        if (message.jsonrpc === '2.0' && 'result' in message && message.result) {
          const result = message.result as any;
          if (result.capabilities && !this.sessionId) {
            // This is InitializeResult - check for session ID in headers
            // (will be set from response headers in send method)
          }
        }

        if (this.onmessage) {
          this.onmessage(message);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.debug('[StreamableHttpTransport] Failed to parse message:', error, 'Data:', event.data);
        }
      }
    };

    // Handle errors
    this.eventSource.onerror = (error) => {
      if (import.meta.env.DEV) {
        console.error('[StreamableHttpTransport] SSE error:', error);
      }

      if (this.onerror) {
        this.onerror(new Error('SSE connection error'));
      }
    };

    this.isStarted = true;
  }

  /**
   * Sends a JSON-RPC message via POST
   */
  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!this.isStarted) {
      throw new Error('Transport not started');
    }

    if (this.isClosed) {
      throw new Error('Transport has been closed');
    }

    if (import.meta.env.DEV) {
      console.log('[StreamableHttpTransport] Sending message:', message);
    }

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      };

      // Add API key as Bearer token if provided
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Add session ID if we have one
      if (this.sessionId) {
        headers['Mcp-Session-Id'] = this.sessionId;
      }

      const response = await fetch(this.baseUrl.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
      }

      // Extract session ID from response headers if this is InitializeRequest
      if ('method' in message && message.method === 'initialize') {
        const sessionIdHeader = response.headers.get('Mcp-Session-Id');
        if (sessionIdHeader) {
          this.sessionId = sessionIdHeader;
          if (import.meta.env.DEV) {
            console.log('[StreamableHttpTransport] Session ID:', this.sessionId);
          }
        }
      }

      const contentType = response.headers.get('Content-Type') || '';

      // Handle different response types
      if (contentType.includes('application/json')) {
        // Single JSON response
        const responseData = await response.json();
        if (import.meta.env.DEV) {
          console.log('[StreamableHttpTransport] Received JSON response:', responseData);
        }
        if (this.onmessage) {
          this.onmessage(responseData);
        }
      } else if (contentType.includes('text/event-stream')) {
        // SSE stream response - parse SSE format
        const text = await response.text();
        if (import.meta.env.DEV) {
          console.log('[StreamableHttpTransport] Server returned SSE stream:', text);
        }

        // Parse SSE format: lines starting with "data: "
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonData = line.substring(6); // Remove "data: " prefix
              const message = JSON.parse(jsonData);
              if (this.onmessage) {
                this.onmessage(message);
              }
            } catch (error) {
              console.error('[StreamableHttpTransport] Failed to parse SSE message:', error, line);
            }
          }
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[StreamableHttpTransport] Send error:', error);
      }
      throw error instanceof Error ? error : new Error('Failed to send message');
    }
  }

  /**
   * Closes the transport and cleans up resources
   */
  async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;

    // Send DELETE request to terminate session if we have session ID
    if (this.sessionId) {
      try {
        await fetch(this.baseUrl.toString(), {
          method: 'DELETE',
          headers: {
            'Mcp-Session-Id': this.sessionId,
          },
        });
      } catch (error) {
        console.error('[StreamableHttpTransport] Error terminating session:', error);
      }
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.onclose) {
      this.onclose();
    }
  }
}