import type { ComponentType, SVGProps } from "react";
import {
  BondIcon,
  CryptoIcon,
  GoldIcon,
  MarketIcon,
  ApartmentIcon,
  SavingsIcon,
} from "@/components/icons";
import { CRYPTO_FROM, type AssetId } from "./markets";

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export type AssetDef = {
  id: AssetId;
  name: string;
  short: string;
  Icon: IconType;
  kind: "safe" | "income" | "equity" | "alt";
  risk: "low" | "med" | "high" | "extreme";
  availableFrom?: number;
  blurb: string;
};

export const ASSETS: AssetDef[] = [
  { id: "savings", name: "High-Yield Savings", short: "Savings", Icon: SavingsIcon, kind: "safe", risk: "low", blurb: "Boring, safe, beats a mattress. Loses to inflation in good years." },
  { id: "bonds", name: "Government Bonds", short: "Bonds", Icon: BondIcon, kind: "income", risk: "low", blurb: "Steady income. Your shield in a crash — until 2022 broke the rules." },
  { id: "index", name: "S&P 500 Index Fund", short: "Index", Icon: MarketIcon, kind: "equity", risk: "med", blurb: "Owns the whole market. The thing that quietly beats almost everyone." },
  { id: "realEstate", name: "Real Estate (REIT)", short: "Real estate", Icon: ApartmentIcon, kind: "equity", risk: "med", blurb: "Bricks and rent. Calm for decades, then 2008 happened." },
  { id: "gold", name: "Gold", short: "Gold", Icon: GoldIcon, kind: "alt", risk: "med", blurb: "Does nothing for years, then everything in a panic. The fear trade." },
  { id: "crypto", name: "Crypto", short: "Crypto", Icon: CryptoIcon, kind: "alt", risk: "extreme", availableFrom: CRYPTO_FROM, blurb: "Up 50x or down 80% — pick a year. The casino at the edge of the map." },
];

export const ASSET_MAP: Record<string, AssetDef> = Object.fromEntries(
  ASSETS.map((a) => [a.id, a]),
);

export function assetsForYear(year: number): AssetDef[] {
  return ASSETS.filter((a) => !a.availableFrom || year >= a.availableFrom);
}
