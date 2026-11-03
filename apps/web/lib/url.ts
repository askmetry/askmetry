// Externe URLs aus Engine-Antworten sind nicht vertrauenswürdig: nur http/https als Link zulassen.
export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
