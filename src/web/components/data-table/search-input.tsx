import { Search } from "lucide-react";
import { useRef } from "react";
import { ShortcutHint } from "@/components/shortcut-hint";
import { Input } from "@/components/ui/input";
import { useShortcut } from "@/lib/shortcuts";

interface SearchInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function SearchInput({ label, value, onChange }: SearchInputProps) {
  const input = useRef<HTMLInputElement>(null);

  useShortcut("search", () => {
    input.current?.focus();
    input.current?.select();
  });

  return (
    <div className="relative">
      <Search
        className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={input}
        aria-label={label}
        placeholder="Suchen..."
        className="h-8 w-48 pr-9 pl-8"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onChange("");
            input.current?.blur();
          }
        }}
      />
      {!value && (
        <ShortcutHint id="search" className="absolute top-1.5 right-1.5" />
      )}
    </div>
  );
}
