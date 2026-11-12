export function normalizeCustomerName(s: string): string {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function findExistingCustomer(name: string, existingNames: readonly string[]): string | null {
  const normalized = normalizeCustomerName(name);
  return normalized ? existingNames.find(existing => normalizeCustomerName(existing) === normalized) ?? null : null;
}

export function rankCustomerMatches(query: string, names: readonly string[]): string[] {
  const normalized = normalizeCustomerName(query);
  if (!normalized) return [...names];
  const starts: string[] = [], contains: string[] = [];
  for (const name of names) {
    const candidate = normalizeCustomerName(name);
    if (candidate.startsWith(normalized)) starts.push(name);
    else if (candidate.includes(normalized)) contains.push(name);
  }
  return [...starts, ...contains];
}
