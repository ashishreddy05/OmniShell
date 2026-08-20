"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fsApi } from "@/lib/api-client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import type { FileEntry } from "../../../server/ssh/sftp-operations";

interface DeleteDialogProps {
  entry: FileEntry;
  connectionId: string;
  onClose: () => void;
}

export function DeleteDialog({ entry, connectionId, onClose }: DeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleDelete = async () => {
    setLoading(true);
    try {
      await fsApi.delete(connectionId, entry.path, entry.type === "directory");
      queryClient.invalidateQueries({ queryKey: ["fs", "list", connectionId] });
      toast.success(`${entry.name} deleted`);
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
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete {entry.type === "directory" ? "Folder" : "File"}
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{entry.name}</strong>?
            {entry.type === "directory" && " This will delete all contents recursively."}
            {" "}This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
