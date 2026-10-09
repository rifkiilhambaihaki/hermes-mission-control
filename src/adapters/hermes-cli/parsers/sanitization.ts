const ANSI_SEQUENCE = /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const PROHIBITED_TEXT_PATTERNS = [
  /(?:~?\/|[A-Za-z]:\\)/,
  /\b(?:sk-|ghp_|xoxb-|bearer\s+)/i,
  /\b(?:api\s*[_-]?\s*key|token|secret|credential|password)\s*[:=]\s*/i,
  /(?:^|\D)-100\d{7,}(?:$|\D)/,
];

export function normalizeCliText(value: string): string {
  const withoutAnsi = value.replace(ANSI_SEQUENCE, "");
  const normalized = withoutAnsi.replace(/\r\n?/g, "\n");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new Error("CLI text contains prohibited control characters.");
  }
  return normalized;
}

export interface SafeTextOptions {
  readonly maxLength?: number;
  readonly allowEmpty?: boolean;
  readonly allowPathLike?: boolean;
}

export function sanitizeSafeText(value: string, options: SafeTextOptions = {}): string {
  const maxLength = options.maxLength ?? 80;
  const normalized = normalizeCliText(value).trim().replace(/[ \t]+/g, " ");
  if (!options.allowEmpty && normalized.length === 0) throw new Error("Safe text is empty.");
  if (normalized.length > maxLength) throw new Error("Safe text exceeds its length limit.");
  if (!/^[\x20-\x7E]*$/.test(normalized)) throw new Error("Safe text must use printable ASCII.");
  if (!options.allowPathLike && PROHIBITED_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new Error("Safe text contains prohibited path, credential, or identifier material.");
  }
  return normalized;
}

export function sanitizeTokenFreeCategory(value: string): string {
  const normalized = sanitizeSafeText(value, { maxLength: 48 }).toLowerCase();
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(normalized)) {
    throw new Error("Category is outside the controlled safe form.");
  }
  return normalized;
}

export function aliasSensitiveId(_value: string, prefix: string, ordinal: number): string {
  const safePrefix = sanitizeTokenFreeCategory(prefix);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 999) {
    throw new Error("Alias ordinal is outside the supported range.");
  }
  return `${safePrefix}-${String(ordinal).padStart(3, "0")}`;
}

export function boundedArray<T>(values: readonly T[], limit: number): readonly T[] {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Array limit is invalid.");
  if (values.length > limit) throw new Error("Array exceeds its safe limit.");
  return Object.freeze([...values]);
}

export function controlledEnum<T extends string>(
  value: string,
  mapping: Readonly<Record<string, T>>,
): T {
  const normalized = value.trim().toLowerCase();
  const mapped = mapping[normalized];
  if (mapped === undefined) throw new Error("Value is outside the controlled enum.");
  return mapped;
}
