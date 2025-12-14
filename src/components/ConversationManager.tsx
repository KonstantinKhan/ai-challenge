import { useState, useEffect } from 'react';
import { 
  listConversations, 
  deleteConversation, 
  loadConversation,
  setCurrentConversationId 
} from '../services/conversationStorage';
import type { SavedConversation } from '../types/conversation';

interface ConversationManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadConversation: (conversation: SavedConversation) => void;
}

export function ConversationManager({ isOpen, onClose, onLoadConversation }: ConversationManagerProps) {
  const [conversations, setConversations] = useState<SavedConversation[]>([]);

  useEffect(() => {
    if (isOpen) {
      setConversations(listConversations());
    }
  }, [isOpen]);

  const handleLoad = (conversation: SavedConversation) => {
    onLoadConversation(conversation);
    setCurrentConversationId(conversation.id);
    onClose();
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Вы уверены, что хотите удалить этот диалог?')) {
      deleteConversation(id);
      setConversations(listConversations());
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин. назад`;
    if (diffHours < 24) return `${diffHours} ч. назад`;
    if (diffDays < 7) return `${diffDays} дн. назад`;
    
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getMessageCount = (messages: SavedConversation['messages']): number => {
    return messages.filter(msg => msg.role !== 'system' || !msg.content.startsWith('[CONVERSATION SUMMARY]')).length;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-800">Сохраненные диалоги</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {conversations.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <p>Нет сохраненных диалогов</p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  onClick={() => handleLoad(conversation)}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-800 truncate">
                        {conversation.title}
                      </h3>
                      <div className="mt-1 text-sm text-gray-500 space-x-3">
                        <span>{getMessageCount(conversation.messages)} сообщений</span>
                        <span>•</span>
                        <span>{conversation.modelConfig.displayName}</span>
                        <span>•</span>
                        <span>{formatDate(conversation.updatedAt)}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDelete(conversation.id, e)}
                      className="ml-4 text-red-500 hover:text-red-700 px-3 py-1 rounded transition-colors text-sm"
                      title="Удалить диалог"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
