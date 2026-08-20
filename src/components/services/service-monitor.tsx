"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { servicesApi } from "@/lib/api-client";
import { wsClient } from "@/lib/ws-client";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Activity, Pause, Trash2 } from "lucide-react";

interface MemoryPoint {
  timestamp: number;
  mb: number | null;
}

const MAX_POINTS = 60;
const MAX_MEMORY = 512;

function SparklineSVG({ data, maxMem }: { data: MemoryPoint[]; maxMem: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ob = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDims({ w: Math.round(width), h: Math.round(height) });
      }
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  const { path, areaPath } = useMemo(() => {
    const points = data
      .filter((p) => p.mb !== null)
      .map((p) => p.mb as number);
    if (points.length < 2) return { path: "", areaPath: "" };
    const maxY = Math.max(maxMem, ...points) * 1.2;
    const minY = 0;
    const pw = dims.w || 200;
    const ph = dims.h || 64;
    const stepX = pw / (points.length - 1);

    const line = points.map((v, i) => {
      const x = i * stepX;
      const y = ph - ((v - minY) / (maxY - minY)) * ph;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const area = [
      ...line,
      `L${(points.length - 1) * stepX},${ph}`,
      `L0,${ph}`,
      "Z",
    ];

    return { path: line.join(" "), areaPath: area.join(" ") };
  }, [data, maxMem, dims]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-16 rounded"
      style={{ background: "rgba(255,255,255,0.03)" }}
      viewBox={`0 0 ${dims.w || 200} ${dims.h || 64}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(34, 197, 94)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="rgb(34, 197, 94)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {areaPath && (
        <path d={areaPath} fill="url(#sparkline-grad)" />
      )}
      {path && (
        <path
          d={path}
          fill="none"
          stroke="rgb(34, 197, 94)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

interface ServiceMonitorProps {
  connectionId: string;
  serviceName: string;
}

export function ServiceMonitor({ connectionId, serviceName }: ServiceMonitorProps) {
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [memoryData, setMemoryData] = useState<MemoryPoint[]>([]);
  const unsubWsRef = useRef<(() => void) | null>(null);

  // Initial static fetch
  const { data: staticMemory } = useQuery({
    queryKey: ["service-memory-static", connectionId, serviceName],
    queryFn: () => servicesApi.memory(connectionId, serviceName),
    staleTime: Infinity,
  });

  // WS updates when live enabled (accumulates data points for the sparkline).
  // Suspend when tab is hidden — keep sparkline points, resume on focus.
  useEffect(() => {
    if (!liveEnabled) {
      unsubWsRef.current?.();
      wsClient.send({
        type: "monitor:stop",
        connectionId,
        payload: { serviceName },
      });
      return;
    }

    const start = (interval: number) => {
      wsClient.send({
        type: "monitor:start",
        connectionId,
        payload: { serviceName, interval },
      });
    };
    const stop = () => {
      wsClient.send({
        type: "monitor:stop",
        connectionId,
        payload: { serviceName },
      });
    };

    unsubWsRef.current = wsClient.on("monitor:memory", (msg) => {
      if (msg.payload.serviceName === serviceName) {
        const mb = msg.payload.memoryMB as number | null;
        setMemoryData((prev) => {
          const next = [...prev, { timestamp: Date.now(), mb }];
          if (next.length > MAX_POINTS) next.shift();
          return next;
        });
      }
    });

    const unsubReconnect = wsClient.on("ws:connected", () => {
      if (document.visibilityState === "visible") {
        start(15000);
      }
    });

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        start(3000);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (document.visibilityState === "visible") {
      start(3000);
    }

    return () => {
      unsubWsRef.current?.();
      unsubReconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [liveEnabled, connectionId, serviceName]);

  const displayMB = liveEnabled && memoryData.length > 0
    ? memoryData[memoryData.length - 1].mb
    : staticMemory?.memoryMB ?? null;

  const maxMem = Math.max(
    MAX_MEMORY,
    ...memoryData.map((p) => p.mb ?? 0),
    (staticMemory?.memoryMB ?? 0)
  ) * 1.2;

  const clearData = () => setMemoryData([]);

  const stats = useMemo(() => {
    const vals = memoryData.filter((p) => p.mb !== null).map((p) => p.mb as number);
    if (vals.length < 2) return null;
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  }, [memoryData]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {displayMB !== null ? (
            <>
              <span className={cn("text-lg font-mono font-bold tracking-tight", displayMB > 200 ? "text-yellow-500" : "text-green-500")}>
                {displayMB.toFixed(2)} MB
              </span>
              {liveEnabled ? (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-green-500/30 text-green-500 font-mono">
                  live
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-muted-foreground/30 text-muted-foreground/60 font-mono">
                  current
                </Badge>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">No data</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {liveEnabled && memoryData.length > 1 && (
            <button
              onClick={clearData}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] text-muted-foreground hover:text-foreground transition-colors"
              title="Clear data"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <Switch
              size="sm"
              checked={liveEnabled}
              onCheckedChange={setLiveEnabled}
              id="live-memory-toggle"
            />
            <label htmlFor="live-memory-toggle" className="text-[10px] text-muted-foreground cursor-pointer select-none flex items-center gap-1">
              {liveEnabled ? <Activity className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
              {liveEnabled ? "Live" : "Enable live"}
            </label>
          </div>
        </div>
      </div>

      {liveEnabled && memoryData.length > 1 && (
        <>
          <SparklineSVG data={memoryData} maxMem={maxMem} />
          {stats && (
            <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="text-green-500">Min</span>
                <span className="font-medium">{stats.min.toFixed(1)} MB</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-yellow-500">Avg</span>
                <span className="font-medium">{stats.avg.toFixed(1)} MB</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-red-500">Max</span>
                <span className="font-medium">{stats.max.toFixed(1)} MB</span>
              </span>
            </div>
          )}
        </>
      )}

      {!liveEnabled && (
        <button
          type="button"
          className="flex w-full flex-col items-center justify-center gap-1 h-[4.5rem] rounded-md border border-dashed border-border/60 bg-muted/20 cursor-pointer hover:bg-muted/40 hover:border-violet-500/30 transition-colors group"
          onClick={() => setLiveEnabled(true)}
        >
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
            <Activity className="h-3.5 w-3.5 text-violet-500/70" />
            Enable live monitoring
          </span>
          <span className="text-[9px] text-muted-foreground/55">
            Streams memory over WS for a sparkline · click or use the toggle
          </span>
        </button>
      )}

      {liveEnabled && memoryData.length <= 1 && (
        <div className="flex items-center justify-center h-16 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            {memoryData.length === 0 ? "Starting live monitoring..." : "Collecting data..."}
          </div>
        </div>
      )}
    </div>
  );
}
