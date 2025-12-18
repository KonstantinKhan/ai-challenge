import { useState, useEffect } from 'react';
import type { MCPToolWithServer, JSONSchemaProperty } from '../types/mcp';

interface MCPToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tools: MCPToolWithServer[];
  isLoading: boolean;
  error: string | null;

  toolConfigs: Record<
    string,
    {
      selected: boolean;
    }
  >;
  onToggleTool: (toolName: string) => void;
  serverStatuses?: Record<string, {
    connected: boolean;
    error?: string;
    toolCount: number;
  }>;
}

export function MCPToolsModal({
  isOpen,
  onClose,
  tools,
  isLoading,
  error,
  toolConfigs,
  onToggleTool,
  serverStatuses,
}: MCPToolsModalProps) {
  const [selectedTool, setSelectedTool] = useState<MCPToolWithServer | null>(null);

  // Reset selected tool when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedTool(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Side panel modal */}
      <div className="fixed right-0 top-0 h-full w-full max-w-3xl bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-800">
              MCP Tools
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Close"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex">
            {/* Tools list (left panel) */}
            <div className="w-1/3 border-r border-gray-200 overflow-y-auto">
              {/* Server Status */}
              {serverStatuses && Object.keys(serverStatuses).length > 0 && (
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                  <h3 className="text-xs font-semibold text-gray-600 mb-2 uppercase">Server Status</h3>
                  <div className="space-y-1">
                    {Object.entries(serverStatuses).map(([serverName, status]) => (
                      <div key={serverName} className="flex items-center gap-2 text-xs">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            status.connected ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        />
                        <span className="font-medium capitalize">
                          {serverName === 'tavily' ? 'Tavily' : serverName}
                        </span>
                        <span className="text-gray-500">
                          ({status.connected ? `${status.toolCount} tools` : status.error || 'disconnected'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isLoading && (
                <div className="flex items-center justify-center p-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
              )}

              {error && (
                <div className="p-4 m-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                  <p className="font-semibold">Error:</p>
                  <p className="text-sm">{error}</p>
                </div>
              )}

              {!isLoading && !error && tools.length === 0 && (
                <div className="p-8 text-center text-gray-500">
                  <p>No tools available</p>
                </div>
              )}

              {!isLoading && !error && tools.length > 0 && (
                <div className="p-2">
                  {/* Group tools by server */}
                  {Object.entries(
                    tools.reduce((acc, tool) => {
                      if (!acc[tool.serverName]) {
                        acc[tool.serverName] = [];
                      }
                      acc[tool.serverName].push(tool);
                      return acc;
                    }, {} as Record<string, MCPToolWithServer[]>)
                  ).map(([serverName, serverTools]) => (
                    <div key={serverName} className="mb-4">
                      {/* Server group header */}
                      <div className="px-2 py-1 mb-2 bg-gray-100 rounded">
                        <h4 className="text-xs font-semibold text-gray-600 uppercase">
                          {serverName === 'tavily' ? 'Web Search (Tavily)' : `${serverName} Tools`}
                        </h4>
                      </div>

                      {/* Tools in this server */}
                      {serverTools.map((tool) => {
                        const config =
                          toolConfigs[tool.name] || {
                            selected: false,
                            args: {},
                          };
                        const isSelected = config.selected;

                        return (
                          <div
                            key={tool.name}
                            className={`w-full px-4 py-3 rounded-lg mb-2 border-2 transition-colors cursor-pointer ${
                              selectedTool?.name === tool.name
                                ? 'bg-blue-100 border-blue-500'
                                : 'bg-gray-50 hover:bg-gray-100 border-transparent'
                            }`}
                            onClick={() => setSelectedTool(tool)}
                          >
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex-1">
                                <div className="font-medium text-gray-800">
                                  {tool.annotations?.title || tool.name}
                                </div>
                                {tool.description && (
                                  <div className="text-sm text-gray-600 mt-1 line-clamp-2">
                                    {tool.description}
                                  </div>
                                )}
                                {/* Server badge */}
                                <div className="mt-1">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                    tool.serverName === 'tavily'
                                      ? 'bg-purple-100 text-purple-700'
                                      : 'bg-blue-100 text-blue-700'
                                  }`}>
                                    {tool.serverName}
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-1">
                                <label className="flex items-center gap-1 text-xs text-gray-600">
                                  <input
                                    type="checkbox"
                                    className="rounded border-gray-300"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      onToggleTool(tool.name);
                                    }}
                                  />
                                  <span>Use</span>
                                </label>
                                {isSelected && (
                                  <span className="text-[10px] text-purple-600 font-semibold">
                                    Selected
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tool details (right panel) */}
            <div className="flex-1 overflow-y-auto p-6">
              {selectedTool ? (
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">
                    {selectedTool.annotations?.title || selectedTool.name}
                  </h3>

                  <div className="mb-4">
                    <span className="inline-block px-2 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded">
                      {selectedTool.name}
                    </span>
                  </div>

                  {selectedTool.description && (
                    <div className="mb-6">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">
                        Description
                      </h4>
                      <p className="text-gray-600">{selectedTool.description}</p>
                    </div>
                  )}

                  {/* Annotations/Hints */}
                  {selectedTool.annotations &&
                    (selectedTool.annotations.readOnlyHint ||
                      selectedTool.annotations.destructiveHint ||
                      selectedTool.annotations.idempotentHint) && (
                      <div className="mb-6">
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">
                          Properties
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {selectedTool.annotations.readOnlyHint && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                              Read Only
                            </span>
                          )}
                          {selectedTool.annotations.destructiveHint && (
                            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">
                              Destructive
                            </span>
                          )}
                          {selectedTool.annotations.idempotentHint && (
                            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                              Idempotent
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                  {/* Output Schema */}
                  {selectedTool.outputSchema && (
                    <div className="mb-6">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">
                        Output Schema
                      </h4>
                      <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono overflow-x-auto">
                        {JSON.stringify(selectedTool.outputSchema, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <p>Select a tool to view details</p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
