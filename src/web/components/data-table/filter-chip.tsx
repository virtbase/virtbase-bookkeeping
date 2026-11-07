import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface FilterChipProps {
  label: ReactNode;
  title: string;
  onRemove: () => void;
}

export function FilterChip({ label, title, onRemove }: FilterChipProps) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="max-w-64 font-normal"
      aria-label={`Filter entfernen: ${title}`}
      onClick={onRemove}
    >
      <span className="min-w-0 truncate">{label}</span>
      <X />
    </Button>
  );
}
