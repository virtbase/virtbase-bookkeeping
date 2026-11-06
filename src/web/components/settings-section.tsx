import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Section({
  title,
  icon: Icon,
  badge,
  children,
}: {
  title: string;
  icon: LucideIcon;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-b pb-6 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-sm">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}
