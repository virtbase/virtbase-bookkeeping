import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface HelpSheetProps {
  open: boolean;
  title: string;
  description: string;
  children?: ReactNode;
  onOpenChange: (open: boolean) => void;
}

export function HelpSheet({
  open,
  title,
  description,
  children,
  onOpenChange,
}: HelpSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-4 overflow-y-auto p-5 sm:max-w-md">
        <SheetHeader className="p-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}
