import type { ReactNode } from "react";

export const TOOL_NAMES = new Set([
  "service_action",
  "read_file",
  "write_file",
  "daemon_reload",
  "run_command",
  "list_directory",
  "search_files",
  "list_services",
  "search_service_logs",
]);

export const VOICE_TOOL_NAMES = [
  "create_customer",
  "book_appointment",
  "check_available_slots",
  "endSession",
  "existing_appointments",
  "select_vehicle",
  "reschedule_appointment",
  "cancel_appointment",
  "request_callback",
  "send_notification",
  "get_recommendations",
  "get_service_history",
  "list_offers",
  "transfer_to_human",
  "create_vehicle",
  "resolve_tire_size_context",
  "get_service_status",
  "product_search",
  "get_tire_info",
  "get_pricing",
  "adjust_quote",
  "get_quote_breakdown",
  "get_service_info",
];

// Sorted by length descending so longer names match before shorter substrings
const SORTED_VOICE_TOOLS = [...VOICE_TOOL_NAMES].sort((a, b) => b.length - a.length);

export const VOICE_TOOL_REGEX = new RegExp(
  `\\b(${SORTED_VOICE_TOOLS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi",
);

// Matches job/run/call identifiers in log lines:
// job_id=xxx, "jobId":"xxx", call_id=xxx, call_<uuid>, etc.
export const JOB_ID_REGEX =
  /"?(?:job[_-]?[iI]d|run[_-]?[iI]d|call[_-]?[iI]d)["\s:=]+"?([a-zA-Z0-9_-]+)|(?:\bcall_[a-f0-9-]{8,}\b)/gi;

export function highlightVoiceTools(text: string): ReactNode[] {
  if (!text) return [" "];
  const parts = text.split(VOICE_TOOL_REGEX);
  if (parts.length === 1) return [text];
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-1 py-0 rounded border border-violet-500/20 bg-violet-500/[0.08] text-[10px] font-mono text-violet-300 leading-none align-baseline"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export function extractJobIds(text: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(JOB_ID_REGEX.source, JOB_ID_REGEX.flags);
  while ((match = re.exec(text)) !== null) {
    // Group 1 = keyed id; otherwise full `call_…` match
    const id = match[1] || match[0];
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

export function extractVoiceTools(text: string): Set<string> {
  const tools = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(VOICE_TOOL_REGEX.source, VOICE_TOOL_REGEX.flags);
  while ((match = re.exec(text)) !== null) {
    tools.add(match[1].toLowerCase());
  }
  return tools;
}
