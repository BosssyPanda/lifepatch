import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 24, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/* ---------- Stats ---------- */
export const CashIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9v6M18 9v6" />
  </Base>
);
export const DebtIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="8" cy="7" r="2.4" />
    <circle cx="13.5" cy="11.5" r="2.4" />
    <circle cx="18" cy="16.5" r="2.4" />
    <path d="M9.7 8.7l2 1.4M15.2 13.2l1.4 1.7" />
  </Base>
);
export const CreditIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
    <path d="M2.5 9.5h19M6 14.5h4" />
  </Base>
);
export const StressIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.5 16a8.5 8.5 0 0 1 17 0" />
    <path d="M12 16l3.5-4.5" />
    <path d="M5 16h.01M19 16h.01M12 8.2h.01" />
  </Base>
);
export const SkillIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 5.5h11a2 2 0 0 1 2 2V19" />
    <path d="M4 5.5V19a1.5 1.5 0 0 0 1.5 1.5H17" />
    <path d="M7.5 9.5h6M7.5 13h4" />
  </Base>
);
export const FreedomIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 13c4-1 6-3 8-7 1 3 1 5 0 7" />
    <path d="M11 13c3 0 6-1 10-3-2 4-5 7-10 7-3 0-5-1.5-5-4" />
  </Base>
);

/* ---------- Locations ---------- */
export const ApartmentIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 20V8.5L12 3l8 5.5V20" />
    <path d="M4 20h16" />
    <rect x="9.5" y="13" width="5" height="7" />
    <path d="M8 9.5h1.5M14.5 9.5H16" />
  </Base>
);
export const WorkIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="7.5" width="18" height="11.5" rx="1.5" />
    <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
    <path d="M3 12.5h18M11 12v1.5h2V12" />
  </Base>
);
export const BankIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 9.5l9-5 9 5" />
    <path d="M4.5 9.5V18M9 9.5V18M15 9.5V18M19.5 9.5V18" />
    <path d="M3 20.5h18M3.5 18h17" />
  </Base>
);
export const FeedIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.2" />
    <path d="M10 5.2h4" />
    <path d="M9 10h6M9 13h4" />
  </Base>
);
export const MarketIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 20.5h18" />
    <path d="M7 17V9M7 7V5.5M7 19v-1" />
    <rect x="5.5" y="9" width="3" height="8" />
    <path d="M13 17v-6M13 8.5V7" />
    <rect x="11.5" y="11" width="3" height="6" />
    <path d="M19 17v-9M19 6V5" />
    <rect x="17.5" y="8" width="3" height="9" />
  </Base>
);

/* ---------- Feed / motifs ---------- */
export const ScamIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3l9 16H3z" />
    <path d="M12 9.5v4.5M12 16.8h.01" />
  </Base>
);
export const FlagIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 21V4" />
    <path d="M6 4.5h11l-2 3.5 2 3.5H6" />
  </Base>
);
export const EyeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.5 12C5 7.5 8.4 5.5 12 5.5S19 7.5 21.5 12C19 16.5 15.6 18.5 12 18.5S5 16.5 2.5 12Z" />
    <circle cx="12" cy="12" r="2.6" />
  </Base>
);
export const VampireIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 5h14l-2 7a5 5 0 0 1-10 0z" />
    <path d="M9 12l1.5 2 1.5-1.5 1.5 1.5 1.5-2" />
  </Base>
);

/* ---------- UI ---------- */
export const ChevronRight = (p: IconProps) => (<Base {...p}><path d="M9 5l7 7-7 7" /></Base>);
export const ChevronLeft = (p: IconProps) => (<Base {...p}><path d="M15 5l-7 7 7 7" /></Base>);
export const ChevronDown = (p: IconProps) => (<Base {...p}><path d="M5 9l7 7 7-7" /></Base>);
export const ArrowRight = (p: IconProps) => (<Base {...p}><path d="M4 12h15M13 6l6 6-6 6" /></Base>);
export const ArrowDown = (p: IconProps) => (<Base {...p}><path d="M12 4v15M6 13l6 6 6-6" /></Base>);
export const CloseIcon = (p: IconProps) => (<Base {...p}><path d="M6 6l12 12M18 6L6 18" /></Base>);
export const LockIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <path d="M12 14.5v2" />
  </Base>
);
export const CheckIcon = (p: IconProps) => (<Base {...p}><path d="M4 12.5l5 5 11-11" /></Base>);
export const InfoIcon = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8h.01" /></Base>
);
export const ReplayIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M3.5 4v4h4" />
  </Base>
);

/* ---------- Assets ---------- */
export const SavingsIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 11c0-3.3 3.6-6 8-6s8 2.7 8 6c0 1.5-.7 2.8-1.9 3.8V19h-3v-2H8.9v2h-3v-4.2C4.7 13.8 4 12.5 4 11Z" />
    <path d="M15.5 8.5h.01M9 5.5c0-1.4 1.3-2.5 3-2.5" />
  </Base>
);
export const BondIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
    <path d="M7 9h10M7 12h7M7 15h4" />
    <circle cx="17" cy="15" r="1.6" />
  </Base>
);
export const GoldIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 10h12l2 4H4z" />
    <path d="M8.5 6h7l2 4H6.5z" />
  </Base>
);
export const CryptoIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 7.5v9M11 7.5v9M8.5 9.5h5a2 2 0 0 1 0 4h-5M8.5 13.5h5.2a2 2 0 0 1 0 4H8.5" />
  </Base>
);
export const BoltIcon = (p: IconProps) => (<Base {...p}><path d="M13 3 5 13h5l-1 8 8-10h-5z" /></Base>);
export const FactoryIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 20.5V11l5 3V11l5 3V9l6 4v7.5z" />
    <path d="M3 20.5h18M6 6V3h2v3" />
  </Base>
);
export const OilIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z" />
  </Base>
);

/* ---------- Life ---------- */
export const HeartIcon = (p: IconProps) => (
  <Base {...p}><path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.5 12 20 12 20Z" /></Base>
);
export const SkullIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 11a7 7 0 0 1 14 0c0 2.4-1.2 3.8-2 4.5V18a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 18v-2.5C6.2 14.8 5 13.4 5 11Z" />
    <circle cx="9.5" cy="11" r="1.3" /><circle cx="14.5" cy="11" r="1.3" /><path d="M11 19.5v-2M13 19.5v-2" />
  </Base>
);
export const TrophyIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 4h10v3a5 5 0 0 1-10 0z" />
    <path d="M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3M10 12h4l-.5 4h-3z M8.5 19.5h7M12 16v3.5" />
  </Base>
);
export const SaveIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M8 4v5h7V4M8 20v-6h8v6" />
  </Base>
);
export const PlusIcon = (p: IconProps) => (<Base {...p}><path d="M12 5v14M5 12h14" /></Base>);
export const MinusIcon = (p: IconProps) => (<Base {...p}><path d="M5 12h14" /></Base>);
export const MailIcon = (p: IconProps) => (
  <Base {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></Base>
);
