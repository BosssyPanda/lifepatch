import type { ComponentType, SVGProps } from "react";
import {
  CashIcon,
  CreditIcon,
  DebtIcon,
  FreedomIcon,
  SkillIcon,
  StressIcon,
} from "@/components/icons";
import type { StatKey } from "@/lib/types";

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export type StatMeta = {
  key: StatKey;
  label: string;
  Icon: IconType;
  /** tailwind color token name */
  color: string;
  hex: string;
};

export const STAT_META: Record<StatKey, StatMeta> = {
  cash: { key: "cash", label: "Cash", Icon: CashIcon, color: "olive", hex: "#7f8b52" },
  debt: { key: "debt", label: "Debt", Icon: DebtIcon, color: "brick", hex: "#a33218" },
  credit: { key: "credit", label: "Credit", Icon: CreditIcon, color: "brass", hex: "#c9a24a" },
  stress: { key: "stress", label: "Stress", Icon: StressIcon, color: "ochre", hex: "#c8861e" },
  skill: { key: "skill", label: "Skill", Icon: SkillIcon, color: "steel", hex: "#5f7480" },
  freedom: { key: "freedom", label: "Freedom", Icon: FreedomIcon, color: "accent", hex: "#d4541e" },
};

export const STAT_ORDER: StatKey[] = [
  "cash",
  "debt",
  "credit",
  "stress",
  "skill",
  "freedom",
];

/** HUD shows the four that carry the drama. */
export const HUD_STATS: StatKey[] = ["cash", "debt", "stress", "freedom"];

export const TONE_HEX: Record<string, string> = {
  good: "#7f8b52",
  bad: "#a33218",
  warning: "#c8861e",
  neutral: "#a89f8c",
};
