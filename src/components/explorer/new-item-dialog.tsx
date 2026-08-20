"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnectionStore } from "@/stores/connection-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { fsApi } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as path from "path";

interface NewItemDialogProps {
  type: "file" | "folder";
  onClose: () => void;
}

export function NewItemDialog({ type, onClose }: NewItemDialogProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const activeTabId = useConnectionStore((s) => s.activeTabId);
  const getExplorer = useExplorerStore((s) => s.getExplorer);
  const queryClient = useQueryClient();

  const connectionId = activeTabId ?? "";
  const explorer = getExplorer(connectionId);

  const handleCreate = async () => {
    if (!name.trim() || !connectionId) return;
    setLoading(true);

    try {
      const fullPath = path.posix.join(explorer.currentPath, name.trim());
      if (type === "folder") {
        await fsApi.mkdir(connectionId, fullPath);
      } else {
        await fsApi.write(connectionId, fullPath, "");
      }
      queryClient.invalidateQueries({ queryKey: ["fs", "list", connectionId, explorer.currentPath] });
      toast.success(`${type === "folder" ? "Folder" : "File"} created`);
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
          <DialogTitle>New {type === "folder" ? "Folder" : "File"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              autoFocus
              placeholder={type === "folder" ? "new-folder" : "new-file.txt"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name.trim() || loading}>
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
