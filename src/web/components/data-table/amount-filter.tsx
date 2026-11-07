import { formatEuro, parseEuroInput, plainAmount } from "@shared/money.ts";
import { Euro } from "lucide-react";
import { useEffect, useState } from "react";
import { FilterTrigger } from "@/components/data-table/filter-trigger";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { TransactionFilter } from "@/lib/transaction-filter";

type AmountValue = Pick<
  TransactionFilter,
  "direction" | "minCents" | "maxCents"
>;

const DIRECTIONS = [
  { value: "all", label: "Alle" },
  { value: "in", label: "Eingang" },
  { value: "out", label: "Ausgang" },
] as const;

function centsText(cents: number | null): string {
  return cents === null ? "" : plainAmount(cents);
}

function summary({ direction, minCents, maxCents }: AmountValue): string {
  const parts: string[] = [];
  if (direction) {
    parts.push(direction === "in" ? "Eingang" : "Ausgang");
  }
  if (minCents !== null && maxCents !== null) {
    parts.push(`${formatEuro(minCents)} – ${formatEuro(maxCents)}`);
  } else if (minCents !== null) {
    parts.push(`ab ${formatEuro(minCents)}`);
  } else if (maxCents !== null) {
    parts.push(`bis ${formatEuro(maxCents)}`);
  }
  return parts.join(", ");
}

interface AmountFilterProps {
  value: AmountValue;
  onChange: (value: Partial<AmountValue>) => void;
}

export function AmountFilter({ value, onChange }: AmountFilterProps) {
  const [min, setMin] = useState(centsText(value.minCents));
  const [max, setMax] = useState(centsText(value.maxCents));
  const active =
    value.direction !== null ||
    value.minCents !== null ||
    value.maxCents !== null;

  useEffect(() => {
    setMin(centsText(value.minCents));
    setMax(centsText(value.maxCents));
  }, [value.minCents, value.maxCents]);

  const parse = (text: string) => {
    const cents = parseEuroInput(text);
    return cents === null ? null : Math.abs(cents);
  };
  const minInvalid = min.trim() !== "" && parse(min) === null;
  const maxInvalid = max.trim() !== "" && parse(max) === null;

  const apply = () => {
    if (minInvalid || maxInvalid) {
      return;
    }
    onChange({ minCents: parse(min), maxCents: parse(max) });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTrigger
          title="Betrag"
          icon={Euro}
          active={active}
          summary={
            <span className="font-normal tabular-nums">{summary(value)}</span>
          }
        />
      </PopoverTrigger>
      <PopoverContent className="flex w-64 flex-col gap-3 p-3" align="start">
        <Segmented
          label="Richtung"
          fill
          options={[...DIRECTIONS]}
          value={value.direction ?? "all"}
          onChange={(direction) =>
            onChange({ direction: direction === "all" ? null : direction })
          }
        />
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="amount-min" className="text-xs">
              Ab, EUR
            </Label>
            <Input
              id="amount-min"
              inputMode="decimal"
              className="h-8"
              aria-invalid={minInvalid}
              value={min}
              onChange={(event) => setMin(event.target.value)}
              onBlur={apply}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="amount-max" className="text-xs">
              Bis, EUR
            </Label>
            <Input
              id="amount-max"
              inputMode="decimal"
              className="h-8"
              aria-invalid={maxInvalid}
              value={max}
              onChange={(event) => setMax(event.target.value)}
              onBlur={apply}
            />
          </div>
          <button type="submit" className="sr-only">
            Übernehmen
          </button>
        </form>
        <p className="text-muted-foreground text-xs">
          Vergleicht den Betrag ohne Vorzeichen.
        </p>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({ direction: null, minCents: null, maxCents: null })
            }
          >
            Filter löschen
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
