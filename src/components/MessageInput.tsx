import { useState, type FormEvent } from 'react';

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  maxLength?: number;
}

export function MessageInput({ 
  onSend, 
  disabled = false, 
  maxLength
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
    setMessage(e.target.value);
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
            {...(maxLength !== undefined ? { maxLength } : {})}
          />
          <button
            type="submit"
            disabled={disabled || !message.trim()}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Отправить
          </button>
        </div>
        <div className="flex justify-end items-center text-sm text-gray-500">
          <span>
            {message.length} {maxLength !== undefined ? `/ ${maxLength}` : ''} символов
          </span>
        </div>
      </div>
    </form>
  );
}



