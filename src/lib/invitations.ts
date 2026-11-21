import type { ResponseStatus } from "./types";

export const RESPONSE_LABEL: Record<ResponseStatus, string> = {
  needsAction: "待回复",
  accepted: "接受",
  declined: "拒绝",
  tentative: "待定",
};

export const RESPONSE_ICON: Record<ResponseStatus, string> = {
  needsAction: "○",
  accepted: "✓",
  declined: "×",
  tentative: "?",
};
