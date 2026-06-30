/**
 * Shared motion tokens. The house "ease-out-expo"-ish curve, defined once so
 * surfaces don't each hardcode the same cubic-bezier (it was duplicated across
 * ~10 files). Import as `import { EASE } from "@/lib/motion"`.
 */
export const EASE = [0.2, 0.65, 0.3, 0.9] as const;
