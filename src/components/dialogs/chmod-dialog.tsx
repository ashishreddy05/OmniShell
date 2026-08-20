"use client";

import { useState, useEffect } from "react";
import { X, Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fsApi } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ChmodDialogProps {
  paths: string[];
  connectionId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PRESETS: Array<{ label: string; mode: string; desc: string }> = [
  { label: "755", mode: "755", desc: "rwxr-xr-x" },
  { label: "644", mode: "644", desc: "rw-r--r--" },
  { label: "600", mode: "600", desc: "rw-------" },
  { label: "777", mode: "777", desc: "rwxrwxrwx" },
  { label: "700", mode: "700", desc: "rwx------" },
  { label: "4755", mode: "4755", desc: "setuid+rwxr-xr-x" },
];

function parseMode(mode: string): { owner: boolean; group: boolean; other: boolean; setuid: boolean; setgid: boolean; sticky: boolean } {
  const m = mode.padStart(3, "0").slice(-3);
  return {
    setuid: mode.length === 4 && ["4", "5", "6", "7"].includes(mode[0]),
    setgid: mode.length === 4 && ["2", "3", "6", "7"].includes(mode[0]),
    sticky: mode.length === 4 && ["1", "3", "5", "7"].includes(mode[0]),
    owner: ["7", "5", "6", "3", "4"].includes(m[0]),
    group: ["7", "5", "6", "3", "4"].includes(m[1]),
    other: ["7", "5", "6", "3", "4"].includes(m[2]),
  };
}

export function ChmodDialog({ paths, connectionId, open, onClose, onSuccess }: ChmodDialogProps) {
  const [mode, setMode] = useState("755");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (open) setMode("755");
  }, [open]);

  if (!open) return null;

  const parsed = parseMode(mode);
  const isValid = /^[0-7]{3,4}$/.test(mode);

  const handleApply = async () => {
    if (!isValid) {
      toast.error("Invalid mode. Use 3-4 digit octal (e.g. 755, 0644, 4755).");
      return;
    }
    setApplying(true);
    try {
      await fsApi.chmod(connectionId, paths, mode);
      toast.success(`Updated permissions on ${paths.length} item(s)`);
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(`chmod failed: ${(err as Error).message}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] bg-black/60 flex items-center justify-center animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-[min(90vw,500px)] bg-background rounded-lg shadow-2xl flex flex-col animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-violet-400" />
            <h3 className="text-sm font-semibold">Change permissions</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-2">Changing permissions for {paths.length} item{paths.length > 1 ? "s" : ""}:</p>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {paths.slice(0, 8).map((p) => (
                <Badge key={p} variant="outline" className="text-[10px] font-mono">{p.split("/").pop()}</Badge>
              ))}
              {paths.length > 8 && <Badge variant="secondary" className="text-[10px]">+{paths.length - 8} more</Badge>}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Mode (octal)</label>
            <Input
              value={mode}
              onChange={(e) => setMode(e.target.value.replace(/[^0-7]/g, ""))}
              placeholder="755"
              className="font-mono"
              maxLength={4}
            />
            {!isValid && <p className="text-[10px] text-red-400 mt-1">Enter 3 or 4 octal digits (0-7)</p>}
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Quick presets</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.mode}
                  variant={mode === p.mode ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs font-mono"
                  onClick={() => setMode(p.mode)}
                  title={p.desc}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          {isValid && (
            <div className="grid grid-cols-4 gap-1 text-center text-[10px] font-mono">
              <div className={cn("rounded p-1.5 border", parsed.setuid ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "border-border text-muted-foreground")}>setuid</div>
              <div className={cn("rounded p-1.5 border", parsed.setgid ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "border-border text-muted-foreground")}>setgid</div>
              <div className={cn("rounded p-1.5 border", parsed.sticky ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "border-border text-muted-foreground")}>sticky</div>
              <div className="border border-border rounded p-1.5 text-muted-foreground">{mode.padStart(3, "0").slice(-3)}</div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={applying}>Cancel</Button>
          <Button size="sm" onClick={handleApply} disabled={!isValid || applying}>
            <Check className="h-3.5 w-3.5 mr-1.5" />Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
