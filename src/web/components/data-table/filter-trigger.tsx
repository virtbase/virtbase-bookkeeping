import type { LucideIcon } from "lucide-react";
import { XCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface FilterTriggerProps extends ComponentProps<typeof Button> {
  title: string;
  icon: LucideIcon;
  active: boolean;
  summary: ReactNode;
}

export function FilterTrigger({
  title,
  icon: Icon,
  active,
  summary,
  ...props
}: FilterTriggerProps) {
  return (
    <Button variant="outline" size="sm" className="font-medium" {...props}>
      {active ? <XCircle /> : <Icon />}
      {title}
      {active && (
        <>
          <Separator
            orientation="vertical"
            className="mx-0.5 data-[orientation=vertical]:h-4"
          />
          {summary}
        </>
      )}
    </Button>
  );
}
