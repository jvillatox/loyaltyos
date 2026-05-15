function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

interface Variant {
  id: string;
  trafficPct: number;
}

export function assignVariant(
  memberId: string,
  campaignId: string,
  variants: Variant[],
): string | null {
  if (variants.length === 0) return null;
  const hash = hashString(`${memberId}:${campaignId}`);
  const bucket = hash % 100;
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.trafficPct;
    if (bucket < cumulative) return variant.id;
  }
  return null;
}
