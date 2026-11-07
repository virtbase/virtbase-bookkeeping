import type { LucideIcon } from "lucide-react";
import { Check, PlusCircle } from "lucide-react";
import { FilterTrigger } from "@/components/data-table/filter-trigger";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface FilterOption<T extends string> {
  label: string;
  value: T;
  count: number;
  icon?: LucideIcon;
}

interface FacetedFilterProps<T extends string> {
  title: string;
  options: FilterOption<T>[];
  selected: T[];
  onChange: (selected: T[]) => void;
  searchable?: boolean;
}

export function FacetedFilter<T extends string>({
  title,
  options,
  selected,
  onChange,
  searchable = false,
}: FacetedFilterProps<T>) {
  const toggle = (value: T) =>
    onChange(
      selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : [...selected, value],
    );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTrigger
          title={title}
          icon={PlusCircle}
          active={selected.length > 0}
          summary={
            selected.length > 2 ? (
              <Badge
                variant="secondary"
                className="rounded-sm px-1 font-normal"
              >
                {selected.length} gewählt
              </Badge>
            ) : (
              options
                .filter((option) => selected.includes(option.value))
                .map((option) => (
                  <Badge
                    key={option.value}
                    variant="secondary"
                    className="rounded-sm px-1 font-normal"
                  >
                    {option.icon && <option.icon />}
                    {option.label}
                  </Badge>
                ))
            )
          }
        />
      </PopoverTrigger>
      <PopoverContent
        className={cn("p-0", searchable ? "w-64" : "w-52")}
        align="start"
      >
        <Command>
          {searchable && <CommandInput placeholder={`${title} suchen...`} />}
          <CommandList>
            <CommandEmpty>Keine Einträge vorhanden.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    onSelect={() => toggle(option.value)}
                  >
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded-sm border border-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50 [&_svg]:invisible",
                      )}
                    >
                      <Check className="size-3" />
                    </div>
                    {option.icon && (
                      <option.icon className="size-4 text-muted-foreground" />
                    )}
                    <span className="truncate">{option.label}</span>
                    <span className="ml-auto font-mono text-muted-foreground text-xs">
                      {option.count}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    className="justify-center"
                    onSelect={() => onChange([])}
                  >
                    Filter löschen
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
