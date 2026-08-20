"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fsApi } from "@/lib/api-client";
import { toast } from "sonner";
import type { ClipboardItem } from "@/stores/explorer-store";

interface PasteDialogProps {
  connectionId: string;
  clipboard: ClipboardItem;
  currentPath: string;
  onClose: () => void;
}

export function PasteDialog({ connectionId, clipboard, currentPath, onClose }: PasteDialogProps) {
  const [destinationPath, setDestinationPath] = useState(currentPath);
  const [pasting, setPasting] = useState(false);

  const handlePaste = async () => {
    setPasting(true);
    try {
      for (const entry of clipboard.entries) {
        const destPath = `${destinationPath.replace(/\/$/, "")}/${entry.name}`;
        if (clipboard.operation === "copy") {
          await fsApi.copy(connectionId, entry.path, destPath);
        } else {
          await fsApi.rename(connectionId, entry.path, destPath);
        }
      }
      toast.success(`Paste complete — ${clipboard.entries.length} item(s)`);
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPasting(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {clipboard.operation === "copy" ? "Copy" : "Move"} {clipboard.entries.length} item(s)
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Destination path</Label>
            <Input
              value={destinationPath}
              onChange={(e) => setDestinationPath(e.target.value)}
              placeholder="/path/to/destination"
            />
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            {clipboard.entries.slice(0, 5).map((entry) => (
              <div key={entry.path} className="truncate">
                {clipboard.operation === "copy" ? "📄" : "✂️"} {entry.path}
              </div>
            ))}
            {clipboard.entries.length > 5 && (
              <div>...and {clipboard.entries.length - 5} more</div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handlePaste} disabled={pasting || !destinationPath}>
            {pasting ? "Pasting..." : "Paste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
