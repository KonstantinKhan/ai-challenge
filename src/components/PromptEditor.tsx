import { useState, useEffect } from 'react';

interface PromptEditorProps {
  isOpen: boolean;
  currentPrompt: string;
  defaultPrompt: string;
  onClose: () => void;
  onSave: (prompt: string) => void;
  onReset: () => void;
}

export function PromptEditor({
  isOpen,
  currentPrompt,
  defaultPrompt,
  onClose,
  onSave,
  onReset,
}: PromptEditorProps) {
  const [editedPrompt, setEditedPrompt] = useState(currentPrompt);

  // Обновляем editedPrompt при изменении currentPrompt
  useEffect(() => {
    setEditedPrompt(currentPrompt);
  }, [currentPrompt]);

  const handleSave = () => {
    onSave(editedPrompt);
    onClose();
  };

  const handleReset = () => {
    setEditedPrompt(defaultPrompt);
    onReset();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Затемнение фона */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Боковая панель */}
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out">
        <div className="flex flex-col h-full">
          {/* Шапка панели */}
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-800">
              Редактирование системного промпта
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Закрыть"
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

          {/* Контент панели */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="h-full flex flex-col">
              <label
                htmlFor="prompt-textarea"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Системный промпт
              </label>
              <textarea
                id="prompt-textarea"
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                className="flex-1 w-full min-h-[400px] px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none font-mono text-sm"
                placeholder="Введите системный промпт..."
              />
            </div>
          </div>

          {/* Футер с кнопками */}
          <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between gap-3">
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
            >
              Сбросить
            </button>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

