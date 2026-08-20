"use client";

import type { SystemVitals } from "../../../server/ssh/vitals";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { RefreshCw, Cpu, HardDrive, MemoryStick, Monitor, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function getColorClass(percentage: number): string {
  if (percentage >= 90) return "text-red-500";
  if (percentage >= 70) return "text-yellow-500";
  return "text-green-500";
}

function getBarColorClass(percentage: number): string {
  if (percentage >= 90) return "bg-red-500";
  if (percentage >= 70) return "bg-yellow-500";
  return "bg-green-500";
}

function VitalsBar({ percentage }: { percentage: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
      <div
        className={cn("h-1.5 rounded-full transition-all", getBarColorClass(percentage))}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  );
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function VitalsIndicator({
  vitals,
  isLoading,
}: {
  vitals: SystemVitals | undefined;
  isLoading: boolean;
}) {
  if (isLoading && !vitals) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!vitals) return null;

  const rootDisk = vitals.disk.find((d) => d.mount === "/") ?? vitals.disk[0];

  return (
    <div className="flex items-center gap-3">
      <span className={cn("flex items-center gap-1", getColorClass(vitals.memory.percentage))}>
        <MemoryStick className="h-3 w-3" />
        {vitals.memory.percentage}%
      </span>
      {rootDisk && (
        <span className={cn("flex items-center gap-1", getColorClass(rootDisk.percentage))}>
          <HardDrive className="h-3 w-3" />
          {rootDisk.percentage}%
        </span>
      )}
      <span className={cn(
        "flex items-center gap-1",
        getColorClass(Math.min(100, Math.round((vitals.cpu.loadAvg[0] / vitals.cpu.cores) * 100)))
      )}>
        <Cpu className="h-3 w-3" />
        {vitals.cpu.loadAvg[0].toFixed(1)}
      </span>
    </div>
  );
}

export function VitalsPopover({
  vitals,
  isLoading,
  onRefresh,
  children,
}: {
  vitals: SystemVitals | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Monitor className="h-3.5 w-3.5" />
            System Vitals
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </Button>
        </div>

        {!vitals ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "No data available"
            )}
          </div>
        ) : (
          <div className="space-y-3 p-3 text-xs">
            {/* OS & Uptime */}
            <div className="flex items-center justify-between text-muted-foreground">
              <span>{vitals.os}</span>
              <span>up {vitals.uptime}</span>
            </div>

            {/* CPU */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Cpu className="h-3 w-3" />
                  CPU ({vitals.cpu.cores} {vitals.cpu.cores === 1 ? "core" : "cores"})
                </span>
                <span>
                  {vitals.cpu.loadAvg.map((v) => v.toFixed(2)).join(" / ")}
                </span>
              </div>
              <VitalsBar
                percentage={Math.min(100, Math.round((vitals.cpu.loadAvg[0] / vitals.cpu.cores) * 100))}
              />
            </div>

            {/* Memory */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <MemoryStick className="h-3 w-3" />
                  Memory
                </span>
                <span>
                  {formatMB(vitals.memory.usedMB)} / {formatMB(vitals.memory.totalMB)}{" "}
                  <span className={getColorClass(vitals.memory.percentage)}>
                    ({vitals.memory.percentage}%)
                  </span>
                </span>
              </div>
              <VitalsBar percentage={vitals.memory.percentage} />
            </div>

            {/* Disk partitions */}
            {vitals.disk.map((d) => (
              <div key={d.mount}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <HardDrive className="h-3 w-3" />
                    {d.mount}
                  </span>
                  <span>
                    {d.usedGB} / {d.totalGB} GB{" "}
                    <span className={getColorClass(d.percentage)}>
                      ({d.percentage}%)
                    </span>
                  </span>
                </div>
                <VitalsBar percentage={d.percentage} />
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
