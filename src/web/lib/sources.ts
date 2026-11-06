import type { Source } from "@shared/types.ts";
import type { LucideIcon } from "lucide-react";
import { Receipt } from "lucide-react";
import { MoneroIcon, StripeIcon } from "@/components/icons";

export const SOURCES: Record<Source, { label: string; icon: LucideIcon }> = {
  stripe: { label: "Stripe", icon: StripeIcon },
  monero: { label: "Monero", icon: MoneroIcon },
  fees: { label: "Gebühren", icon: Receipt },
};
