/**
 * Heuristic: does a text entry look like a secret (password, API key, token) that
 * should be masked in the UI until the user reveals it? Deliberately conservative —
 * only single-token, high-signal strings qualify, so ordinary text, sentences and
 * URLs are never hidden. Password-manager content is already excluded from capture
 * entirely; this covers secrets that still land in history (manually copied keys etc.).
 */

// Well-known secret prefixes (API keys / tokens from common providers).
const SECRET_PREFIXES = [
  "sk-",
  "pk-",
  "rk-",
  "ghp_",
  "gho_",
  "ghs_",
  "github_pat_",
  "xox", // Slack
  "AKIA", // AWS access key id
  "ASIA",
  "AIza", // Google
  "ya29.", // Google OAuth
  "hf_", // HuggingFace
  "glpat-", // GitLab
  "shpat_", // Shopify
  "Bearer ",
];

function shannonEntropyBits(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    bits -= p * Math.log2(p);
  }
  return bits * s.length;
}

/** True when `content` looks like a credential worth masking. */
export function looksSecret(content: string | null, itemType: string): boolean {
  if (!content || itemType !== "text") return false;
  const s = content.trim();
  // Secrets are single tokens — bail on anything with whitespace or newlines.
  if (/\s/.test(s)) {
    // …except an explicit "Bearer <token>" header, handled below.
    if (!/^Bearer\s+\S+$/i.test(s)) return false;
  }
  if (s.length < 12 || s.length > 400) return false;

  if (SECRET_PREFIXES.some((p) => s.startsWith(p))) return true;

  // JWT: three base64url segments separated by dots.
  if (/^ey[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}$/.test(s)) return true;

  // Long uniform hex (hashes, keys) — 32+ hex chars.
  if (/^[0-9a-fA-F]{32,}$/.test(s)) return true;

  // A single opaque token with mixed classes and real entropy — the generic
  // "this is a random-looking secret" case, without flagging normal words/URLs.
  const token = /^[^\s]{16,}$/.test(s);
  const looksUrl = /^[a-z]+:\/\//i.test(s) || s.startsWith("www.");
  const hasWordShape = /^[A-Za-z][A-Za-z'’-]*$/.test(s); // a plain word
  if (token && !looksUrl && !hasWordShape) {
    const classes =
      (/[a-z]/.test(s) ? 1 : 0) +
      (/[A-Z]/.test(s) ? 1 : 0) +
      (/[0-9]/.test(s) ? 1 : 0) +
      (/[^A-Za-z0-9]/.test(s) ? 1 : 0);
    if (classes >= 3 && shannonEntropyBits(s) >= 60) return true;
  }
  return false;
}
