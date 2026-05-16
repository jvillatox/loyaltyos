const VAR_RE = /\{\{([^}]+)\}\}/g;

export function render(template: string, context: Record<string, unknown>): string {
  return template.replace(VAR_RE, (_match, path: string) => {
    const value = resolvePath(context, path.trim());
    if (value === undefined) return "";
    return String(value);
  });
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
