/**
 * Build a diagnosis-oriented extract from a call_id log window for the model.
 * Prioritizes error/tool/webhook lines over blind first+last truncate.
 */

const MAX_RESULT_CHARS = 18_000;
const HEAD_LINES = 30;
const TAIL_LINES = 30;

/** Lines worth keeping for booking / voice-tool / failure diagnosis. */
const DIAGNOSIS_LINE_RE =
  /error|exception|traceback|status=5|status=4|BOOK_APPOINTMENT|book_appointment|GIA_|failed|\bfail\b|webhook/i;

export function isDiagnosisLine(line: string): boolean {
  return DIAGNOSIS_LINE_RE.test(line);
}

/**
 * Select head + diagnosis hits + tail, with gap markers between non-contiguous ranges.
 * When over budget, keep diagnosis hits first, then shrink head/tail.
 */
export function buildDiagnosisExtract(body: string, maxChars = MAX_RESULT_CHARS): string {
  const raw = (body || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return "";

  const lines = raw.split("\n");
  const n = lines.length;
  if (n === 0) return "";

  const selected = new Set<number>();
  const headCount = Math.min(HEAD_LINES, n);
  const tailCount = Math.min(TAIL_LINES, n);

  for (let i = 0; i < headCount; i++) selected.add(i);
  for (let i = Math.max(0, n - tailCount); i < n; i++) selected.add(i);
  for (let i = 0; i < n; i++) {
    if (isDiagnosisLine(lines[i])) selected.add(i);
  }

  const sorted = [...selected].sort((a, b) => a - b);

  const render = (idxs: number[]): string => {
    const out: string[] = [];
    let prev = -2;
    for (const i of idxs) {
      if (prev >= 0 && i > prev + 1) {
        out.push(`... [${i - prev - 1} lines omitted] ...`);
      }
      out.push(lines[i]);
      prev = i;
    }
    return out.join("\n");
  };

  let extract = render(sorted);
  if (extract.length <= maxChars) return extract;

  // Over budget: keep diagnosis hits, then fill remaining budget with head/tail.
  const hitIdxs = sorted.filter((i) => isDiagnosisLine(lines[i]));
  let hitsText = render(hitIdxs);
  if (hitsText.length > maxChars) {
    // ponytail: hard cap — prefer start of hits list; rare megabyte journals.
    return (
      hitsText.slice(0, maxChars) +
      `\n\n... [diagnosis hits truncated to ${maxChars} chars; open Service Manager → Search logs for full window] ...`
    );
  }

  const remaining = maxChars - hitsText.length - 80;
  const contextIdxs: number[] = [];
  let budget = remaining;
  // Prefer head then tail (skip lines already in hits)
  const hitSet = new Set(hitIdxs);
  for (let i = 0; i < headCount && budget > 0; i++) {
    if (hitSet.has(i)) continue;
    const len = lines[i].length + 1;
    if (len > budget) break;
    contextIdxs.push(i);
    budget -= len;
  }
  for (let i = Math.max(0, n - tailCount); i < n && budget > 0; i++) {
    if (hitSet.has(i)) continue;
    const len = lines[i].length + 1;
    if (len > budget) break;
    contextIdxs.push(i);
    budget -= len;
  }

  const merged = [...new Set([...hitIdxs, ...contextIdxs])].sort((a, b) => a - b);
  extract = render(merged);
  if (extract.length > maxChars) {
    return extract.slice(0, maxChars) + "\n\n... [capped] ...";
  }
  return extract;
}

export function formatSearchServiceLogsResult(opts: {
  serviceName: string;
  query: string;
  start?: string;
  end?: string;
  session?: string;
  body: string;
}): string {
  const body = (opts.body || "").trim();
  const lines = body ? body.split("\n").filter((l) => l.length > 0).length : 0;
  if (!body) {
    return [
      "[search_service_logs] No matching logs",
      `Service: ${opts.serviceName}`,
      `Query: ${opts.query}`,
      "Hint: verify service name, connection, and call_id spelling.",
    ].join("\n");
  }

  const extract = buildDiagnosisExtract(body);
  const hitCount = body.split("\n").filter(isDiagnosisLine).length;

  return [
    `[search_service_logs] Service: ${opts.serviceName}`,
    `Query: ${opts.query}`,
    opts.session ? `Session ID (room_id): ${opts.session}` : null,
    opts.start ? `Start: ${opts.start}` : null,
    opts.end ? `End: ${opts.end}` : null,
    `Line count: ${lines}`,
    `Diagnosis hits (error/tool/webhook): ${hitCount}`,
    "Full logs: use Service Manager → Search logs with this call_id (not shown in chat).",
    "Diagnosis extract (analyze relative to the user question — cite status codes / tool names, do not paste raw logs):",
    extract,
  ]
    .filter(Boolean)
    .join("\n");
}

// Self-check: npx tsx src/lib/search-logs-diagnosis.ts
function selfCheck() {
  const noise = Array.from({ length: 100 }, (_, i) => `INFO line ${i} ok`).join("\n");
  const middle = [
    "ERROR something broke",
    "GIA_BOOK_APPOINTMENT status=500",
    "book_appointment failed",
    "End webhook sent for",
  ].join("\n");
  const body = `${noise}\n${middle}\n${noise}`;
  const extract = buildDiagnosisExtract(body, 5000);
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`selfCheck failed: ${msg}`);
  };
  assert(extract.includes("GIA_BOOK_APPOINTMENT status=500"), "keeps booking failure");
  assert(extract.includes("ERROR something broke"), "keeps error line");
  assert(extract.includes("line 0"), "keeps head");
  assert(extract.includes("line 99") || extract.includes("INFO line 99"), "keeps tail");
  assert(!extract.includes("chars omitted"), "no blind middle-omit marker when hits fit");
  const formatted = formatSearchServiceLogsResult({
    serviceName: "demo-agent",
    query: "call_xyz",
    start: "2026-01-01",
    end: "2026-01-02",
    session: "RM_abc123",
    body,
  });
  assert(formatted.includes("Service Manager → Search logs"), "mentions Service Manager");
  assert(formatted.includes("GIA_BOOK_APPOINTMENT"), "formatted includes hit");
  assert(formatted.includes("Session ID (room_id): RM_abc123"), "formatted includes session id");
  console.log("search-logs-diagnosis selfCheck ok");
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /search-logs-diagnosis\.(ts|js|mjs)$/.test(process.argv[1]);

if (isDirectRun) {
  selfCheck();
}
