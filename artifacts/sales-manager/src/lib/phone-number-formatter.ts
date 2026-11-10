export type PhoneCleanupResult = {
  output: string;
  totalDetected: number;
  validNumbers: string[];
  invalidNumbers: string[];
  duplicatesRemoved: number;
};

type NumberToken = { digits: string; hasPlus: boolean };
type Plan = { invalid: number; groups: number; next: number };

const digitMap: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => digitMap[digit] ?? digit);
}

function expandScientificInteger(value: string): NumberToken | null {
  const match = value.match(/^(\+?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return null;
  const exponent = Number(match[4]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 40) return null;
  const whole = match[2];
  const fraction = match[3] ?? "";
  const mantissa = `${whole}${fraction}`;
  const decimalPosition = whole.length + exponent;
  let digits: string;

  if (decimalPosition <= 0) return null;
  if (decimalPosition >= mantissa.length) {
    digits = `${mantissa}${"0".repeat(decimalPosition - mantissa.length)}`;
  } else {
    const fractionalPart = mantissa.slice(decimalPosition);
    if (/[1-9]/.test(fractionalPart)) return null;
    digits = mantissa.slice(0, decimalPosition);
  }

  return { digits: digits.replace(/^0+(?=\d)/, ""), hasPlus: Boolean(match[1]) };
}

function tokenizeChunk(chunk: string): NumberToken[] {
  return chunk
    .trim()
    .split(/[\s/\\:=#]+/)
    .flatMap((rawToken) => {
      const token = normalizeDigits(rawToken);
      const scientific = expandScientificInteger(token);
      if (scientific) return [scientific];
      if (/[a-z\u0600-\u06ff]/i.test(token)) return [];
      const digits = token.replace(/\D/g, "");
      if (!digits) return [];
      return [{ digits, hasPlus: /^\s*\+/.test(token) }];
    });
}

function comparePlan(left: Plan, right: Plan): boolean {
  return left.invalid < right.invalid
    || (left.invalid === right.invalid && left.groups < right.groups);
}

function groupWhitespaceSeparatedNumbers(tokens: NumberToken[]): string[] {
  if (!tokens.length) return [];
  const plans: Array<Plan | undefined> = new Array(tokens.length + 1);
  plans[tokens.length] = { invalid: 0, groups: 0, next: tokens.length };

  for (let start = tokens.length - 1; start >= 0; start -= 1) {
    let digits = "";
    let best: Plan | undefined;
    for (let end = start; end < tokens.length; end += 1) {
      digits += tokens[end].digits;
      const isSingleOversizedToken = end === start && digits.length > 15;
      if (digits.length > 15 && !isSingleOversizedToken) break;
      const tail = plans[end + 1];
      if (!tail) continue;
      const plan = {
        invalid: tail.invalid + (digits.length < 7 || digits.length > 15 ? 1 : 0),
        groups: tail.groups + 1,
        next: end + 1,
      };
      if (!best || comparePlan(plan, best)) best = plan;
      if (isSingleOversizedToken) break;
    }
    plans[start] = best ?? { invalid: 1, groups: 1, next: start + 1 };
  }

  const result: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const plan = plans[index];
    const end = plan?.next ?? index + 1;
    const digits = tokens.slice(index, end).map((token) => token.digits).join("");
    const hasPlus = tokens[index]?.hasPlus;
    result.push(`${hasPlus ? "+" : ""}${digits}`);
    index = end;
  }
  return result;
}

function candidatesFromText(value: string): string[] {
  const normalized = normalizeDigits(value)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  const chunks = normalized.split(/[\r\n,;|،؛\t]+/);
  return chunks.flatMap((chunk) => groupWhitespaceSeparatedNumbers(tokenizeChunk(chunk)));
}

export function cleanPhoneNumbers(values: Iterable<unknown>): PhoneCleanupResult {
  const candidates: string[] = [];
  for (const value of values) {
    if (value == null) continue;
    candidates.push(...candidatesFromText(String(value)));
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  let duplicatesRemoved = 0;
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (!digits) continue;
    if (seen.has(digits)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(digits);
    unique.push(candidate);
  }

  const validNumbers: string[] = [];
  const invalidNumbers: string[] = [];
  for (const number of unique) {
    const length = number.replace(/\D/g, "").length;
    (length >= 7 && length <= 15 ? validNumbers : invalidNumbers).push(number);
  }

  return {
    output: unique.join(","),
    totalDetected: candidates.length,
    validNumbers,
    invalidNumbers,
    duplicatesRemoved,
  };
}

export function parseDelimitedRows(text: string): string[][] {
  const sample = text.slice(0, 8_192);
  const counts = new Map<string, number>([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (let index = 0; index < sample.length; index += 1) {
    const char = sample[index];
    if (char === '"') {
      if (quoted && sample[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && counts.has(char)) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }
  const delimiter = [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === delimiter) {
      row.push(field);
      field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}
