import type { LucideIcon } from "lucide-react";
import { BanknoteArrowUp, CreditCard, Landmark, Wallet } from "lucide-react";
import {
  AlipayIcon,
  AmazonPayIcon,
  AmexIcon,
  KlarnaIcon,
  MastercardIcon,
  MoneroIcon,
  PayPalIcon,
  RevolutIcon,
  VisaIcon,
} from "@/components/icons";

const ICONS: Record<string, LucideIcon> = {
  visa: VisaIcon,
  mastercard: MastercardIcon,
  amex: AmexIcon,
  "american express": AmexIcon,
  paypal: PayPalIcon,
  "revolut pay": RevolutIcon,
  alipay: AlipayIcon,
  "amazon pay": AmazonPayIcon,
  klarna: KlarnaIcon,
  monero: MoneroIcon,
  auszahlung: BanknoteArrowUp,
  "sepa debit": Landmark,
  ideal: Landmark,
  sofort: Landmark,
  giropay: Landmark,
  bancontact: Landmark,
  eps: Landmark,
  "customer balance": Wallet,
};

const CARD_BRANDS = new Set([
  "karte",
  "discover",
  "diners",
  "jcb",
  "unionpay",
  "cartes bancaires",
  "eftpos au",
  "interac",
]);

export function methodIcon(method: string): LucideIcon {
  const key = method.trim().toLowerCase();
  return ICONS[key] ?? (CARD_BRANDS.has(key) ? CreditCard : Wallet);
}
