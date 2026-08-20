"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Check, AlertTriangle, KeyRound, Server } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const API_BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/api";

interface SSHEntry {
  host: string;
  hostName: string;
  user: string;
  port: number;
  identityFile: string;
  keyValid: boolean;
  alreadyExists: boolean;
}

interface SSHImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function SSHImportDialog({ open, onClose, onImported }: SSHImportDialogProps) {
  const [entries, setEntries] = useState<SSHEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());

    fetch(`${API_BASE}/connections/import`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setEntries(data.entries || []);
        // Auto-select importable entries (valid key, not already imported)
        const importable = (data.entries as SSHEntry[])
          .filter((e) => e.keyValid && !e.alreadyExists)
          .map((e) => e.host);
        setSelected(new Set(importable));
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  const toggleEntry = (host: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const res = await fetch(`${API_BASE}/connections/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hosts: Array.from(selected) }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }

      const parts: string[] = [];
      if (data.imported > 0) parts.push(`${data.imported} imported`);
      if (data.skipped > 0) parts.push(`${data.skipped} skipped (already exist)`);
      if (data.errors?.length > 0) parts.push(`${data.errors.length} failed`);
      toast.success(parts.join(", ") || "Done");

      onImported();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" onFocusOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Import from SSH Config</DialogTitle>
          <DialogDescription>
            Select hosts from ~/.ssh/config to import as connections.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No hosts found in ~/.ssh/config
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {entries.map((entry) => {
              const disabled = !entry.keyValid || entry.alreadyExists;
              const checked = selected.has(entry.host);

              return (
                <button
                  key={entry.host}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    disabled
                      ? "cursor-not-allowed opacity-50"
                      : checked
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-muted/50 text-muted-foreground"
                  )}
                  onClick={() => !disabled && toggleEntry(entry.host)}
                  disabled={disabled}
                >
                  <div
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/30"
                    )}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </div>

                  <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{entry.host}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {entry.user}@{entry.hostName}:{entry.port}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {entry.alreadyExists && (
                      <span className="text-xs text-muted-foreground">exists</span>
                    )}
                    {!entry.keyValid && (
                      <span className="flex items-center gap-0.5 text-xs text-yellow-600">
                        <KeyRound className="h-3 w-3" />
                        key missing
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
          >
            {importing && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Import {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
