"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fsApi } from "@/lib/api-client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { FileEntry } from "../../../server/ssh/sftp-operations";
import * as pathUtils from "path";

interface RenameDialogProps {
  entry: FileEntry;
  connectionId: string;
  onClose: () => void;
}

export function RenameDialog({ entry, connectionId, onClose }: RenameDialogProps) {
  const [name, setName] = useState(entry.name);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleRename = async () => {
    if (!name.trim() || name === entry.name) {
      onClose();
      return;
    }
    setLoading(true);
    try {
      const dir = pathUtils.posix.dirname(entry.path);
      const newPath = pathUtils.posix.join(dir, name.trim());
      await fsApi.rename(connectionId, entry.path, newPath);
      queryClient.invalidateQueries({ queryKey: ["fs", "list", connectionId] });
      toast.success("Renamed successfully");
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>New name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleRename} disabled={!name.trim() || loading}>
              Rename
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
