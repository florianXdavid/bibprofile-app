// Field-level baselines — DELIBERATELY ABSENT in v1.
//
// The intent is a later "your median is 2021; typical neuroscience papers cite
// a median of 2017" comparison line. Until real baseline data exists, this
// returns null for every field and every card renders its comparison line only
// when a baseline is present (`if (baseline) …`). One function to swap later.
//
// Do NOT invent placeholder numbers and do NOT use 0 as a stand-in — a fake
// baseline that looks real is worse than none. Returning null is the contract.

export type FieldBaseline = {
  medianCitationAge: number
  pctLast5y: number
  medianRefsPerPaper: number
  pctOpenAccess: number
}

export function getBaseline(fieldId: string): FieldBaseline | null {
  void fieldId // reserved for v2; referenced so noUnusedParameters stays happy
  return null // v1: no baselines yet
}
