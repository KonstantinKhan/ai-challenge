/**
 * Custom MCP Transport for Dual-Channel Architecture
 * 
 * This transport implements the dual-channel pattern:
 * - GET /mcp: SSE connection for receiving server responses
 * - POST /mcp/messages?sessionId=<id>: Sending JSON-RPC requests
 */

import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';

interface EndpointEvent {
  endpoint: string;
}

/**
 * Custom transport for dual-channel MCP server architecture
 */
export class DualChannelTransport implements Transport {
  private eventSource: EventSource | null = null;
  private messagesEndpoint: string | null = null;
  private baseUrl: URL;
  private isStarted = false;
  private isClosed = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  constructor(baseUrl: URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Starts the transport by opening SSE connection to GET /mcp
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    if (this.isClosed) {
      throw new Error('Transport has been closed');
    }

    return new Promise((resolve, reject) => {
      const sseUrl = this.baseUrl.toString();
      
      if (import.meta.env.DEV) {
        console.log('[DualChannelTransport] Opening SSE connection to:', sseUrl);
      }

      this.eventSource = new EventSource(sseUrl);

      // Handle endpoint event - this gives us the sessionId and messages endpoint
      this.eventSource.addEventListener('endpoint', (event: MessageEvent) => {
        try {
          const rawData = event.data;
          if (!rawData) {
            reject(new Error('Empty endpoint event data'));
            return;
          }

          // Try to parse as JSON first, if that fails, treat as plain string
          let endpointPath: string;
          try {
            const parsed = JSON.parse(rawData);
            // If it's an object with endpoint property
            if (typeof parsed === 'object' && parsed !== null && 'endpoint' in parsed) {
              endpointPath = parsed.endpoint;
            } else if (typeof parsed === 'string') {
              // If JSON parsing returns a string (quoted string)
              endpointPath = parsed;
            } else {
              throw new Error('Unexpected endpoint format');
            }
          } catch {
            // If JSON.parse fails, treat rawData as the endpoint path directly
            endpointPath = rawData;
          }
          
          // Handle both absolute and relative URLs
          let endpointUrl: URL;
          try {
            endpointUrl = new URL(endpointPath);
          } catch {
            // If relative URL, resolve against base URL
            endpointUrl = new URL(endpointPath, this.baseUrl);
          }
          
          this.messagesEndpoint = endpointUrl.toString();
          
          // Extract sessionId from query parameter
          const sessionIdParam = endpointUrl.searchParams.get('sessionId');
          if (sessionIdParam) {
            this.sessionId = sessionIdParam;
          }

          if (import.meta.env.DEV) {
            console.log('[DualChannelTransport] Received endpoint:', this.messagesEndpoint);
            console.log('[DualChannelTransport] Session ID:', this.sessionId);
          }

          if (!this.messagesEndpoint) {
            reject(new Error('Failed to get messages endpoint from server'));
            return;
          }

          this.isStarted = true;
          resolve();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(`Failed to parse endpoint event: ${error.message}`);
          reject(err);
        }
      });

      // Handle JSON-RPC messages from server
      // SSE events can come with different event types:
      // - Events with type "message" (handled by addEventListener)
      // - Default events without type (handled by onmessage)
      // - Custom event types (we'll listen for common ones)
      const handleMessage = (event: MessageEvent) => {
        // Skip endpoint events - they're handled separately
        if (event.type === 'endpoint') {
          return;
        }

        try {
          const data = event.data;
          if (!data || data.trim() === '') {
            return;
          }

          const message: JSONRPCMessage = JSON.parse(data);
          
          if (import.meta.env.DEV) {
            console.log('[DualChannelTransport] Received message:', message);
          }

          // Always call onmessage callback - the Client will handle routing
          if (this.onmessage) {
            this.onmessage(message);
          }
        } catch (error) {
          // Only log parsing errors, don't fail on non-JSON data (like heartbeats)
          if (import.meta.env.DEV) {
            console.debug('[DualChannelTransport] Failed to parse message:', error, 'Data:', event.data);
          }
        }
      };

      // Listen for 'message' event type (if server uses it)
      this.eventSource.addEventListener('message', handleMessage);
      
      // Also listen for default events (some servers send JSON-RPC as default event)
      this.eventSource.onmessage = handleMessage;

      // Handle errors
      this.eventSource.onerror = (error) => {
        if (import.meta.env.DEV) {
          console.error('[DualChannelTransport] SSE error:', error);
        }

        // If not started yet, reject the start promise
        if (!this.isStarted) {
          reject(new Error('Failed to establish SSE connection'));
          return;
        }

        // Otherwise, report error via callback
        if (this.onerror) {
          this.onerror(new Error('SSE connection error'));
        }
      };

      // Set timeout for endpoint event
      setTimeout(() => {
        if (!this.isStarted) {
          reject(new Error('Timeout waiting for endpoint event'));
        }
      }, 10000); // 10 second timeout
    });
  }

  /**
   * Sends a JSON-RPC message via POST to /mcp/messages?sessionId=<id>
   */
  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!this.isStarted || !this.messagesEndpoint) {
      throw new Error('Transport not started or endpoint not available');
    }

    if (this.isClosed) {
      throw new Error('Transport has been closed');
    }

    // Just send the message - responses will come via SSE
    await this.sendRequest(message);
  }

  /**
   * Internal method to send HTTP POST request
   */
  private async sendRequest(message: JSONRPCMessage): Promise<void> {
    if (!this.messagesEndpoint) {
      throw new Error('Messages endpoint not available');
    }

    if (import.meta.env.DEV) {
      console.log('[DualChannelTransport] Sending message:', message);
    }

    try {
      const response = await fetch(this.messagesEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
      }

      // For requests, response will come via SSE, not HTTP response body
      // So we don't need to parse the response here
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[DualChannelTransport] Send error:', error);
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

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }


    if (this.onclose) {
      this.onclose();
    }
  }
}
