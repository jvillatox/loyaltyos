import Handlebars from "handlebars";

const hbs = Handlebars.create();

// Sandbox: replace unsafe built-in helpers with safe versions
hbs.registerHelper("if", function conditional(this: unknown, ...args: unknown[]) {
  const opts = args[args.length - 1] as Handlebars.HelperOptions;
  const params = args.slice(0, -1);
  const condition = params[0];
  if (condition) {
    return opts.fn(this);
  }
  return opts.inverse(this);
});

hbs.registerHelper("unless", function unless(this: unknown, ...args: unknown[]) {
  const opts = args[args.length - 1] as Handlebars.HelperOptions;
  const condition = args[0];
  if (!condition) {
    return opts.fn(this);
  }
  return opts.inverse(this);
});

hbs.registerHelper("each", function each(this: unknown, ...args: unknown[]) {
  const opts = args[args.length - 1] as Handlebars.HelperOptions;
  const list = args[0] as Iterable<unknown> | undefined | null;
  if (!list) return opts.inverse(this);
  const arr = Array.isArray(list) ? list : [...list];
  if (arr.length === 0) return opts.inverse(this);
  let result = "";
  for (let i = 0; i < arr.length; i++) {
    const existingData: Record<string, unknown> =
      opts.data !== undefined ? (opts.data as Record<string, unknown>) : {};
    const rendered = opts.fn(arr[i], {
      data: { ...existingData, index: i, first: i === 0, last: i === arr.length - 1 },
    });
    result += String(rendered);
  }
  return result;
});

hbs.registerHelper("eq", (a: unknown, b: unknown) => a === b);

hbs.registerHelper("neq", (a: unknown, b: unknown) => a !== b);

// Locale-aware formatting helpers
hbs.registerHelper("formatCurrency", (amount: number, currency: string, locale: string) => {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${String(amount)} ${currency}`;
  }
});

hbs.registerHelper(
  "formatDate",
  (date: string | Date, style: "long" | "short" | "medium", locale: string) => {
    try {
      const d = typeof date === "string" ? new Date(date) : date;
      return new Intl.DateTimeFormat(locale, { dateStyle: style }).format(d);
    } catch {
      return String(date);
    }
  },
);

hbs.registerHelper("formatPoints", (n: number, locale: string) => {
  try {
    return `${new Intl.NumberFormat(locale).format(n)} pts`;
  } catch {
    return `${String(n)} pts`;
  }
});

/**
 * Renders a Handlebars template string with the given context.
 * Variables use `{{var}}`, `{{nested.path}}`, `{{#if var}}...{{/if}}`, `{{#each list}}...{{/each}}`.
 */
export function render(template: string, context: Record<string, unknown>): string {
  // Disallow template strings that attempt to access dangerous globals
  const blocked =
    /\{\{.*\b(constructor|__proto__|prototype|require|process|global|globalThis)\b.*\}\}/i;
  if (blocked.test(template)) {
    return "";
  }

  const compiled = hbs.compile(template, { noEscape: false, strict: false });
  return compiled(sanitizeContext(context));
}

// Strip prototype chain to prevent sandbox escape via __proto__ or constructor
function sanitizeContext(obj: Record<string, unknown>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const clean: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(obj)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      clean[key] = sanitizeContext(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export type { Handlebars };
