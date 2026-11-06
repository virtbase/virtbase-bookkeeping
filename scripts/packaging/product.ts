import { version } from "../../package.json";

export interface Product {
  id: string;
  title: string;
  summary: string;
  description: string;
  version: string;
  vendor: string;
  maintainer: string;
  homepage: string;
}

export const PRODUCT: Product = {
  id: "virtbase-bookkeeping",
  title: "Virtbase Bookkeeping",
  summary: "Local Stripe and Monero exports for Lexware",
  description:
    "Fetches Stripe and Monero transactions, tracks what was exported and writes Lexware Office CSV files. All data stays on this computer.",
  version,
  vendor: "BeastHost UG",
  maintainer: "BeastHost UG <support@virtbase.com>",
  homepage: "https://virtbase.com",
};
