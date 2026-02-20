interface ChipOption {
  value: string;
  label: string;
}

interface ChipSelectorProps {
  options: ChipOption[];
  selected: string | null;
  onChange: (value: string) => void;
}

export default function ChipSelector({
  options,
  selected,
  onChange,
}: ChipSelectorProps) {
  return (
    <div className="chip-selector">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`chip-selector__chip ${
            selected === option.value ? "chip-selector__chip--selected" : ""
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
