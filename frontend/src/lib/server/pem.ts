// Hosted env var fields mangle multi-line PEM keys: literal "\n" escapes, quotes copied
// from .env, or line breaks flattened to spaces. Rebuild the canonical PEM layout.
export function normalizePem(value: string | undefined): string | undefined {
  if (!value) return value;
  const text = value.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').replace(/\\r/g, '').replace(/\\n/g, '\n');
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!match) return text;
  const lines = match[2].replace(/\s+/g, '').match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${match[1]}-----`, ...lines, `-----END ${match[1]}-----`, ''].join('\n');
}
