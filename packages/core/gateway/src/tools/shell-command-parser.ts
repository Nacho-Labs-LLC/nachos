/**
 * A parsed command segment with its trailing operator
 */
export interface CommandSegment {
  command: string;
  operator: '|' | ';' | '&&' | '||' | null;
}

export function containsCommandSubstitution(command: string): boolean {
  return /`|\$\(|\$\{|<\(|>\(|<</.test(command);
}

export function extractCommandBins(command: string): string[] {
  const segments = splitCommandSegments(command);
  const bins: string[] = [];
  for (const segment of segments) {
    const bin = extractBinaryFromSegment(segment.command);
    if (!bin) {
      continue;
    }
    bins.push(bin);
  }
  return bins;
}

export function splitCommandSegments(command: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? '';
    const next = command[i + 1] ?? '';
    const prev = command[i - 1] ?? '';

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }

    if (!inDoubleQuote && ch === "'") {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }

    if (!inSingleQuote && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      current += ch;
      continue;
    }

    const isPipe = ch === '|';
    const isSemicolon = ch === ';';
    const isAnd = ch === '&';
    const isAndAnd = isAnd && next === '&';
    const isOrOr = isPipe && next === '|';

    if (isSemicolon || isPipe || isAndAnd || isOrOr) {
      const trimmed = current.trim();
      let operator: CommandSegment['operator'];
      if (isOrOr) {
        operator = '||';
      } else if (isAndAnd) {
        operator = '&&';
      } else if (isSemicolon) {
        operator = ';';
      } else {
        operator = '|';
      }
      if (trimmed) {
        segments.push({ command: trimmed, operator });
      }
      current = '';
      if (isAndAnd || isOrOr) {
        i += 1;
      }
      continue;
    }

    if (isAnd && !isAndAnd && /\s/.test(prev) && /\s/.test(next)) {
      const trimmed = current.trim();
      if (trimmed) {
        segments.push({ command: trimmed, operator: ';' });
      }
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) {
    segments.push({ command: tail, operator: null });
  }

  return segments;
}

export function extractBinaryFromSegment(segment: string): string | undefined {
  const tokens = tokenizeSegment(segment);
  for (const token of tokens) {
    if (isAssignmentToken(token)) {
      continue;
    }
    if (isRedirectionToken(token)) {
      continue;
    }
    return token;
  }
  return undefined;
}

export function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i] ?? '';

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (!inDoubleQuote && ch === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function isAssignmentToken(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

export function isRedirectionToken(token: string): boolean {
  return /^\d*>/.test(token) || token.startsWith('>') || token.startsWith('<');
}
