"use client";

import { useDropzone } from "react-dropzone";
import { useCallback, useEffect, useRef, useState } from "react";
import { fsApi } from "@/lib/api-client";
import { useUploadStore } from "@/stores/upload-store";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import { MAX_FILE_SIZE } from "@/lib/constants";
import { Upload, X, FileText, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface PendingFile {
  file: File;
  /** Relative path within a folder upload (e.g., "subfolder/file.txt"), empty for flat files */
  relativePath: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface UploadZoneProps {
  connectionId: string;
  remotePath: string;
  onUploaded: () => void;
  openRef?: React.RefObject<(() => void) | null>;
  openFolderRef?: React.RefObject<(() => void) | null>;
  children: React.ReactNode;
}

export function UploadZone({ connectionId, remotePath, onUploaded, openRef, openFolderRef, children }: UploadZoneProps) {
  const { addUpload, updateProgress, setStatus, uploads, removeUpload, clearCompleted } = useUploadStore();
  const [showProgress, setShowProgress] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const stagePendingFiles = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      const pending: PendingFile[] = acceptedFiles.map((file) => ({
        file,
        relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || "",
      }));
      setPendingFiles(pending);
    },
    []
  );

  const startUpload = useCallback(
    async (filesToUpload: PendingFile[]) => {
      if (filesToUpload.length === 0) return;
      setShowProgress(true);

      let successCount = 0;
      let errorCount = 0;

      for (const { file, relativePath } of filesToUpload) {
        const id = nanoid();
        const displayName = relativePath || file.name;
        addUpload({ id, connectionId, fileName: displayName, remotePath, file });

        try {
          setStatus(id, "uploading");
          await fsApi.upload(connectionId, remotePath, [file], relativePath || undefined, (loaded, total) => {
            updateProgress(id, loaded, total);
          });
          setStatus(id, "completed");
          successCount++;
          onUploaded();
        } catch (err) {
          setStatus(id, "error", (err as Error).message);
          toast.error(`Failed to upload ${displayName}`);
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} file(s) uploaded${errorCount > 0 ? `, ${errorCount} failed` : ""}`);
      }
    },
    [connectionId, remotePath, addUpload, updateProgress, setStatus, onUploaded]
  );

  const handleConfirm = () => {
    const files = pendingFiles;
    setPendingFiles([]);
    startUpload(files);
  };

  const handleCancel = () => {
    setPendingFiles([]);
  };

  const onDropRejected = useCallback(
    (rejections: { file: File }[]) => {
      for (const { file } of rejections) {
        toast.error(`${file.name} exceeds the ${Math.round(MAX_FILE_SIZE / 1024 / 1024 / 1024 * 10) / 10}GB limit`);
      }
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: stagePendingFiles,
    onDropRejected,
    maxSize: MAX_FILE_SIZE,
    noClick: true,
    noKeyboard: true,
  });

  // Expose file picker open function to parent
  useEffect(() => {
    if (openRef) openRef.current = open;
    return () => { if (openRef) openRef.current = null; };
  }, [open, openRef]);

  // Expose folder picker open function to parent
  useEffect(() => {
    if (openFolderRef) openFolderRef.current = () => folderInputRef.current?.click();
    return () => { if (openFolderRef) openFolderRef.current = null; };
  }, [openFolderRef]);

  // Handle folder input change
  const handleFolderInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      const pending: PendingFile[] = files.map((file) => ({
        file,
        relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || "",
      }));
      setPendingFiles(pending);
      // Reset so the same folder can be selected again
      e.target.value = "";
    },
    []
  );

  const activeUploads = uploads.filter((u) => u.connectionId === connectionId);
  const hasActive = activeUploads.some((u) => u.status === "uploading" || u.status === "pending");
  const totalPendingSize = pendingFiles.reduce((sum, p) => sum + p.file.size, 0);
  const hasFolderFiles = pendingFiles.some((p) => p.relativePath.includes("/"));

  return (
    <div {...getRootProps()} className="relative flex-1 flex flex-col overflow-hidden">
      <input {...getInputProps()} />
      {/* Hidden folder picker input */}
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        onChange={handleFolderInput}
        /* @ts-expect-error webkitdirectory is not in React's type definitions */
        webkitdirectory=""
        multiple
      />

      {isDragActive && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg m-2 animate-in fade-in zoom-in-95 duration-150">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium text-primary">Drop files or folders here to upload</p>
            <p className="text-sm text-muted-foreground">to {remotePath}</p>
          </div>
        </div>
      )}

      {children}

      {/* Upload confirmation dialog */}
      <Dialog open={pendingFiles.length > 0} onOpenChange={(o) => !o && handleCancel()}>
        <DialogContent className="sm:max-w-md" onFocusOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Upload {pendingFiles.length} {pendingFiles.length === 1 ? "file" : "files"}</DialogTitle>
            <DialogDescription>
              {formatBytes(totalPendingSize)} total to {remotePath}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {pendingFiles.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm px-1 py-0.5">
                {p.relativePath.includes("/") ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate flex-1 text-muted-foreground">
                  {p.relativePath || p.file.name}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatBytes(p.file.size)}
                </span>
              </div>
            ))}
          </div>
          {hasFolderFiles && (
            <p className="text-xs text-muted-foreground">
              Folder structure will be preserved on the remote server.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>Cancel</Button>
            <Button onClick={handleConfirm}>
              <Upload className="h-4 w-4 mr-1" />
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload progress panel */}
      {(showProgress && activeUploads.length > 0) && (
        <div className="absolute bottom-14 right-2 w-80 max-h-64 bg-background border border-border rounded-lg shadow-lg overflow-hidden z-20 animate-in slide-in-from-right-2 fade-in duration-200">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
            <span className="text-xs font-medium">
              Uploads ({activeUploads.filter((u) => u.status === "completed").length}/{activeUploads.length})
            </span>
            <div className="flex gap-1">
              {!hasActive && (
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { clearCompleted(); setShowProgress(false); }}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          <div className="overflow-y-auto max-h-48 p-2 space-y-2">
            {activeUploads.map((upload) => (
              <div key={upload.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1">{upload.fileName}</span>
                  {upload.status === "completed" && <span className="text-green-500 ml-2">Done</span>}
                  {upload.status === "error" && <span className="text-destructive ml-2">Error</span>}
                  {upload.status === "uploading" && <span className="text-muted-foreground ml-2">{upload.progress}%</span>}
                  <Button variant="ghost" size="icon" className="h-4 w-4 ml-1" onClick={() => removeUpload(upload.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                {upload.status === "uploading" && (
                  <Progress value={upload.progress} className="h-1" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
