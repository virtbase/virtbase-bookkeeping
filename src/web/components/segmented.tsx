import { cn } from "@/lib/utils";

interface SegmentedProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  disabled?: T[];
  fill?: boolean;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  disabled = [],
  fill = false,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset className="flex h-8 items-center gap-0.5 rounded-md border p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled.includes(option.value)}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-6.5 rounded-[5px] px-2 font-medium text-xs disabled:pointer-events-none disabled:opacity-40",
            fill && "flex-1",
            option.value === value
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
