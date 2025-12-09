interface TemperatureSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function TemperatureSlider({
  value,
  onChange,
  min = 0,
  max = 2,
  step = 0.1,
}: TemperatureSliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
        Temperature:
      </span>
      <div className="relative flex-1 min-w-[200px] max-w-[300px]">
        <div className="h-2 rounded-full temperature-gradient" />

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-2 opacity-0 cursor-pointer"
          aria-label="Temperature control"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
        />

        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-blue-500 rounded-full pointer-events-none shadow-md"
          style={{ left: `calc(${percentage}% - 8px)` }}
        />
      </div>

      <span className="text-sm font-semibold text-gray-800 w-12 text-right">
        {value.toFixed(2)}
      </span>
    </div>
  );
}
