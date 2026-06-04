function parseValue(value: unknown): unknown {
  try {
    if (value === undefined) {
      return null;
    }

    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");

    if (!looksLikeJson) {
      return value;
    }

    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** Pass columnIndexByName to skip per-column indexOf. */
export function rowToJsonObject(
  columns: string[],
  displayColumns: string[],
  row: unknown[],
  columnIndexByName?: Map<string, number>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lookup = columnIndexByName;

  for (const column of displayColumns) {
    const index = lookup ? lookup.get(column) ?? -1 : columns.indexOf(column);
    if (index < 0) continue;
    result[column] = parseValue(row[index]);
  }

  return result;
}

function matchesFilter(text: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (q.length >= 2 && q.startsWith("/") && q.lastIndexOf("/") > 0) {
    try {
      const re = new RegExp(q.slice(1, q.lastIndexOf("/")), "i");
      return re.test(text);
    } catch {
      return text.toLowerCase().includes(q.toLowerCase());
    }
  }
  return text.toLowerCase().includes(q.toLowerCase());
}

export function filterJsonForViewer(value: unknown, query: string): unknown {
  const q = query.trim();
  if (!q) return value;

  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return matchesFilter(JSON.stringify(value), q) ? value : undefined;
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    const keyHit = matchesFilter(key, q);
    if (val != null && typeof val === "object" && !Array.isArray(val)) {
      const nested = filterJsonForViewer(val, q);
      if (nested != null && (keyHit || Object.keys(nested as object).length > 0)) {
        out[key] = nested;
      } else if (keyHit) {
        out[key] = val;
      }
    } else {
      const valHit = matchesFilter(String(val ?? "null"), q);
      if (keyHit || valHit) out[key] = val;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
