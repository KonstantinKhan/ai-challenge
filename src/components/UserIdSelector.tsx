interface UserIdSelectorProps {
  value: number;
  onChange: (userId: number) => void;
  disabled?: boolean;
}

const USER_IDS = [101, 103, 104, 109];

export function UserIdSelector({
  value,
  onChange,
  disabled = false,
}: UserIdSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
        User ID:
      </label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed min-w-[100px]"
      >
        {USER_IDS.map((userId) => (
          <option key={userId} value={userId}>
            {userId}
          </option>
        ))}
      </select>
    </div>
  );
}
