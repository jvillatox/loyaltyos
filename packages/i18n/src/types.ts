import esMX from "./locales/es-MX.json" with { type: "json" };

type JsonShape = typeof esMX;

type DotPrefix<T extends string, K extends string> = K extends "" ? T : `${T}.${K}`;

type NestedKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? NestedKeys<T[K], DotPrefix<Prefix, K>>
    : DotPrefix<Prefix, K>;
}[keyof T & string];

/** All valid translation keys derived from es-MX.json */
export type TranslationKey = NestedKeys<JsonShape>;

/** Type-safe t() function signature */
export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;
