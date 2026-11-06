import { CircleQuestionMark } from "lucide-react";
import type { ReactNode } from "react";
import { FieldLabel } from "@/components/ui/field";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LabelWithHelpProps {
  htmlFor: string;
  help: string;
  children: ReactNode;
}

export function LabelWithHelp({ htmlFor, help, children }: LabelWithHelpProps) {
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel htmlFor={htmlFor}>{children}</FieldLabel>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={help}
            className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <CircleQuestionMark className="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-center">{help}</TooltipContent>
      </Tooltip>
    </div>
  );
}
