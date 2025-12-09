import { useState, type FormEvent } from 'react';

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  maxLength?: number;
  skipSystemPrompt?: boolean;
  onSkipSystemPromptChange?: (value: boolean) => void;
}

export function MessageInput({ 
  onSend, 
  disabled = false, 
  maxLength = 256,
  skipSystemPrompt = false,
  onSkipSystemPromptChange
}: MessageInputProps) {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= maxLength) {
      setMessage(value);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <textarea
            value={message}
            onChange={handleChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            disabled={disabled}
            placeholder="Введите сообщение..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed resize-none"
            rows={3}
            maxLength={maxLength}
          />
          <button
            type="submit"
            disabled={disabled || !message.trim()}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Отправить
          </button>
        </div>
        <div className="flex justify-between items-center text-sm text-gray-500">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={skipSystemPrompt}
              onChange={(e) => onSkipSystemPromptChange?.(e.target.checked)}
              disabled={disabled}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span>Отправить без системного промпта</span>
          </label>
          <span>
            {message.length} / {maxLength} символов
          </span>
        </div>
      </div>
    </form>
  );
}



