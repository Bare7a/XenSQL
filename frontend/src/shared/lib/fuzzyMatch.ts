export interface FuzzyResult {
  score: number;
  ranges: [number, number][];
}

const SCORE_EXACT = 10_000;
const SCORE_PREFIX = 7_000;
const SCORE_BOUNDARY = 5_000;
const SCORE_SUBSTRING = 3_000;
const SUBSEQUENCE_CAP = 1_500;

const MATCH = 16;
const BONUS_BOUNDARY = 30;
const BONUS_CONSECUTIVE = 18;
const PENALTY_GAP = 1;
const PENALTY_LEADING = 3;

const SECONDARY_CAP = SCORE_SUBSTRING - 100;

const SEP = /[\s_\-./:\\]/;

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  if (SEP.test(prev)) return true;
  return prev.toLowerCase() === prev && text[i].toLowerCase() !== text[i];
}

function toRanges(indices: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const i of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  }
  return ranges;
}

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  if (!query) return { score: 0, ranges: [] };
  if (!text) return null;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const lenAdj = -Math.min(text.length, 80) * 0.05;

  if (lower === q) return { score: SCORE_EXACT + lenAdj, ranges: [[0, text.length]] };

  const at = lower.indexOf(q);
  if (at === 0) return { score: SCORE_PREFIX + lenAdj, ranges: [[0, q.length]] };
  if (at > 0) {
    const base = isBoundary(text, at) ? SCORE_BOUNDARY : SCORE_SUBSTRING;
    return { score: base + lenAdj - at * 0.1, ranges: [[at, at + q.length]] };
  }

  const matched: number[] = [];
  let qi = 0;
  let raw = 0;
  let prev = -2;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] !== q[qi]) continue;
    let s = MATCH;
    if (isBoundary(text, i)) s += BONUS_BOUNDARY;
    if (i === prev + 1) s += BONUS_CONSECUTIVE;
    else if (prev >= 0) s -= PENALTY_GAP * Math.min(i - prev - 1, 10);
    if (matched.length === 0) s -= PENALTY_LEADING * Math.min(i, 5);
    raw += s;
    matched.push(i);
    prev = i;
    qi++;
  }
  if (qi < q.length) return null;
  return { score: Math.min(raw, SUBSEQUENCE_CAP) + lenAdj, ranges: toRanges(matched) };
}

export function rankCandidate(query: string, primary: string, secondary: string[] = []): FuzzyResult | null {
  if (!query) return { score: 0, ranges: [] };
  const primaryMatch = fuzzyMatch(query, primary);
  let score = primaryMatch ? primaryMatch.score : Number.NEGATIVE_INFINITY;
  for (const field of secondary) {
    const m = field ? fuzzyMatch(query, field) : null;
    if (m) score = Math.max(score, Math.min(m.score, SECONDARY_CAP));
  }
  if (!Number.isFinite(score)) return null;
  return { score, ranges: primaryMatch?.ranges ?? [] };
}
