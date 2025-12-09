import type { ModelConfig } from '../types/gigachat';

interface ModelSelectorProps {
  value: ModelConfig;
  onChange: (model: ModelConfig) => void;
  disabled?: boolean;
}

const MODELS: ModelConfig[] = [
  {
    provider: 'gigachat',
    modelId: 'GigaChat',
    displayName: 'GigaChat',
  },
  {
    provider: 'huggingface',
    modelId: 'deepseek-ai/DeepSeek-V3.2',
    displayName: 'DeepSeek-V3.2',
  },
  {
    provider: 'huggingface',
    modelId: 'OpenBuddy/openbuddy-llama3.1-8b-v22.3-131k',
    displayName: 'OpenBuddy-8B',
  },
  {
    provider: 'huggingface',
    modelId: '0xfader/Qwen2.5-0.5B-Instruct-Gensyn-Swarm-sharp_soaring_rooster',
    displayName: 'Qwen2.5-0.5B',
  },
];

export function ModelSelector({
  value,
  onChange,
  disabled = false,
}: ModelSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
        Модель:
      </label>
      <select
        value={`${value.provider}:${value.modelId}`}
        onChange={(e) => {
          const [provider, ...modelIdParts] = e.target.value.split(':');
          const modelId = modelIdParts.join(':');
          const selectedModel = MODELS.find(
            (m) => m.provider === provider && m.modelId === modelId
          );
          if (selectedModel) {
            onChange(selectedModel);
          }
        }}
        disabled={disabled}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed min-w-[150px]"
      >
        {MODELS.map((model) => (
          <option
            key={`${model.provider}:${model.modelId}`}
            value={`${model.provider}:${model.modelId}`}
          >
            {model.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

