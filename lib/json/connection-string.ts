/**
 * Connection string ⇄ JSON.
 *
 * Connection strings follow .NET's DbConnectionStringBuilder rules (used by
 * SQL Server, Npgsql, MySQL and — since 2.0.18 — the Snowflake .NET
 * connector): `key=value` pairs separated by `;`, `==` for a literal `=` in a
 * key, and values quoted with "…" or '…' (doubling the quote inside) when
 * they contain `;` or need surrounding whitespace kept.
 *
 * They are usually pasted straight from code, so the code-literal quoting
 * (a C#/JSON "…" string with \" escapes, or a C# verbatim @"…" string with
 * "" escapes) is detected, removed, and put back the same way.
 */

/** How the connection string was quoted where it was pasted from. */
export type QuoteStyle = "none" | "csharp" | "verbatim";

export type Unwrapped =
  | { ok: true; style: QuoteStyle; text: string }
  | { ok: false; error: string };

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "'": "'",
  "/": "/",
  "0": "\0",
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

const CONCATENATED =
  "This looks like more than one string (joined with + ?). Paste a single string.";

/** Decode the body of a C#/JSON "…" string literal. */
function decodeCSharp(body: string): Unwrapped {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') return { ok: false, error: CONCATENATED };
    if (c !== "\\") {
      out += c;
      continue;
    }
    const e = body[++i];
    if (e === undefined) return { ok: false, error: "The string ends with a lone \\." };
    if (e in SIMPLE_ESCAPES) {
      out += SIMPLE_ESCAPES[e];
    } else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16));
      i += 4;
    } else {
      return { ok: false, error: `Unknown escape \\${e} in the string.` };
    }
  }
  return { ok: true, style: "csharp", text: out };
}

/** Decode the body of a C# verbatim @"…" string literal. */
function decodeVerbatim(body: string): Unwrapped {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '"') {
      out += body[i];
    } else if (body[i + 1] === '"') {
      out += '"';
      i++;
    } else {
      return { ok: false, error: CONCATENATED };
    }
  }
  return { ok: true, style: "verbatim", text: out };
}

/**
 * Detect and remove the code-literal quoting around a pasted connection
 * string. A `;` or `,` right after a closing quote (end of a C# statement or
 * a JSON property) is ignored; on an unquoted string it is kept.
 */
export function unwrapLiteral(input: string): Unwrapped {
  const text = input.trim();
  const literal = text.replace(/"\s*[;,]$/, '"');
  if (literal.length >= 3 && literal.startsWith('@"') && literal.endsWith('"')) {
    return decodeVerbatim(literal.slice(2, -1));
  }
  if (literal.length >= 2 && literal.startsWith('"') && literal.endsWith('"')) {
    return decodeCSharp(literal.slice(1, -1));
  }
  return { ok: true, style: "none", text };
}

export interface Setting {
  key: string;
  value: string;
}

/** How the original string was written, so unchanged parts can be kept as-is. */
export interface Layout {
  /** Source text of each setting (`key=value`, trimmed), by index. */
  raws: string[];
  /** Separator between settings: ";" or "; ". */
  separator: string;
  /** Whether the string ended with a ";". */
  trailing: boolean;
}

export type Parsed =
  | { ok: true; settings: Setting[]; layout: Layout }
  | { ok: false; error: string; position: number };

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

/** Split a connection string into its settings (DbConnectionStringBuilder rules). */
export function parseConnectionString(text: string): Parsed {
  const settings: Setting[] = [];
  const raws: string[] = [];
  const gaps: string[] = []; // text between consecutive settings
  let i = 0;
  let prevEnd = -1;
  const n = text.length;
  const fail = (error: string, position: number): Parsed => ({ ok: false, error, position });

  while (i < n) {
    const gapStart = i;
    while (i < n && (isSpace(text[i]) || text[i] === ";")) i++;
    if (i >= n) break;
    if (prevEnd >= 0) gaps.push(text.slice(gapStart, i));
    const start = i;

    // Key: up to the first "=" ("==" is a literal "=").
    let key = "";
    for (;;) {
      const c = text[i];
      if (c === undefined || c === ";") {
        return fail(`"${text.slice(start, i).trim()}" is missing "=" and a value.`, start);
      }
      if (c === "=") {
        if (text[i + 1] === "=") {
          key += "=";
          i += 2;
          continue;
        }
        i++;
        break;
      }
      key += c;
      i++;
    }
    key = key.trim();
    if (!key) return fail("A value is missing its setting name.", start);

    // Value: quoted with " or ' (doubled inside), or plain up to the next ";".
    while (i < n && isSpace(text[i]) && text[i] !== ";") i++;
    let value = "";
    const q = text[i];
    if (q === '"' || q === "'") {
      const quoteAt = i++;
      for (;;) {
        if (i >= n) return fail(`The value of "${key}" has an unclosed ${q}.`, quoteAt);
        if (text[i] === q) {
          if (text[i + 1] === q) {
            value += q;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i++];
      }
      const after = i;
      while (i < n && isSpace(text[i])) i++;
      if (i < n && text[i] !== ";") {
        return fail(`Unexpected text after the quoted value of "${key}".`, after);
      }
    } else {
      while (i < n && text[i] !== ";") value += text[i++];
      value = value.trim();
    }

    settings.push({ key, value });
    raws.push(text.slice(start, i).trim());
    prevEnd = i;
  }

  const separator = gaps.length > 0 && gaps.every((g) => /^;\s/.test(g)) ? "; " : ";";
  const trailing = prevEnd >= 0 && text.slice(prevEnd).trim().startsWith(";");
  return { ok: true, settings, layout: { raws, separator, trailing } };
}

/** The parsed string a JSON document came from (keeps unchanged parts as written). */
export interface Source {
  settings: Setting[];
  layout: Layout;
}

export type ToJson =
  | {
      ok: true;
      json: string;
      style: QuoteStyle;
      source: Source;
      warnings: string[];
    }
  | { ok: false; error: string; position?: number };

/**
 * Pasted connection string → JSON text with one key per setting, in order,
 * values as text. A setting repeated with the same name keeps its last value,
 * as .NET does; names repeated in different case are kept but warned about.
 */
export function connectionStringToJson(input: string): ToJson {
  const unwrapped = unwrapLiteral(input);
  if (!unwrapped.ok) return unwrapped;
  const parsed = parseConnectionString(unwrapped.text);
  if (!parsed.ok) return parsed;

  const warnings: string[] = [];
  const counts = new Map<string, number>();
  for (const { key } of parsed.settings) {
    counts.set(key.toLowerCase(), (counts.get(key.toLowerCase()) ?? 0) + 1);
  }
  for (const [lower, count] of counts) {
    if (count < 2) continue;
    const name = parsed.settings.find((s) => s.key.toLowerCase() === lower)!.key;
    warnings.push(`"${name}" is set ${count} times; .NET uses the last one.`);
  }

  // Exact repeats collapse to the last one (a JSON object can't hold both).
  const kept = parsed.settings.filter(
    (s, i) => !parsed.settings.some((t, j) => j > i && t.key === s.key),
  );
  // Built by hand (not JSON.stringify of an object) so number-like keys keep
  // their place instead of moving to the front.
  const json =
    kept.length === 0
      ? "{}"
      : `{\n${kept
          .map((s) => `  ${JSON.stringify(s.key)}: ${JSON.stringify(s.value)}`)
          .join(",\n")}\n}`;

  return {
    ok: true,
    json,
    style: unwrapped.style,
    source: { settings: parsed.settings, layout: parsed.layout },
    warnings,
  };
}

export type ToString = { ok: true; text: string } | { ok: false; error: string };

/** Write one setting, quoting the value only when it needs it. */
function formatSetting(key: string, value: string): string {
  const k = key.replace(/=/g, "==");
  if (!/[;"']/.test(value) && value === value.trim()) return `${k}=${value}`;
  if (value.includes('"') && !value.includes("'")) return `${k}='${value}'`;
  return `${k}="${value.replace(/"/g, '""')}"`;
}

/**
 * JSON text → connection string in the given quote style. Settings that are
 * unchanged from `source` keep their original text, separator and trailing
 * ";", so the only difference is what was edited.
 */
export function jsonToConnectionString(
  json: string,
  style: QuoteStyle,
  source?: Source,
): ToString {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `JSON error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: 'The JSON must be an object of settings, like { "user": "jdoe" }.' };
  }

  const used = new Set<number>();
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(data)) {
    if (key.trim() === "") return { ok: false, error: "A setting has an empty name." };
    if (key.includes(";")) return { ok: false, error: `Setting names can't contain ";" ("${key}").` };
    if (raw !== null && typeof raw === "object") {
      const what = Array.isArray(raw) ? "a list" : "an object";
      return { ok: false, error: `"${key}" must be a single value, not ${what}.` };
    }
    const value = raw === null ? "" : String(raw);
    const same = source?.settings.findIndex(
      (s, i) => !used.has(i) && s.key === key && s.value === value,
    );
    if (source && same !== undefined && same >= 0) {
      used.add(same);
      parts.push(source.layout.raws[same]);
    } else {
      parts.push(formatSetting(key, value));
    }
  }

  const separator = source?.layout.separator ?? ";";
  const trailing = source?.layout.trailing && parts.length > 0 ? ";" : "";
  return { ok: true, text: wrapLiteral(parts.join(separator) + trailing, style) };
}

/** Put the code-literal quoting back, in the given style. */
export function wrapLiteral(text: string, style: QuoteStyle): string {
  if (style === "verbatim") return `@"${text.replace(/"/g, '""')}"`;
  if (style === "csharp") {
    const body = text.replace(/[\\"\u0000-\u001f]/g, (c) => {
      if (c === "\\") return "\\\\";
      if (c === '"') return '\\"';
      if (c === "\n") return "\\n";
      if (c === "\r") return "\\r";
      if (c === "\t") return "\\t";
      return `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
    });
    return `"${body}"`;
  }
  return text;
}
