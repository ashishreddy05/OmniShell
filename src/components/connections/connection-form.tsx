"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectionsApi } from "@/lib/api-client";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import type { Connection } from "@/lib/db/schema";

interface ConnectionFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editConnection?: Connection;
}

export function ConnectionForm({ open, onClose, onSaved, editConnection }: ConnectionFormProps) {
  const [form, setForm] = useState({
    name: editConnection?.name || "",
    host: editConnection?.host || "",
    port: editConnection?.port?.toString() || "22",
    username: editConnection?.username || "",
    privateKeyPath: editConnection?.privateKeyPath || "",
    passphrase: "",
    defaultPath: editConnection?.defaultPath || "/",
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleChange = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setTestResult(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = { ...form, port: parseInt(form.port, 10), passphrase: form.passphrase || null };
      if (editConnection) {
        await connectionsApi.update(editConnection.id, data);
        toast.success("Connection updated");
      } else {
        await connectionsApi.create(data);
        toast.success("Connection created");
      }
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Need to save first if new, or use existing ID
      let id = editConnection?.id;
      if (!id) {
        const data = { ...form, port: parseInt(form.port, 10), passphrase: form.passphrase || null };
        const created = await connectionsApi.create(data);
        id = created.id;
      }
      const result = await connectionsApi.test(id);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const isValid = form.name && form.host && form.username && form.privateKeyPath;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" onFocusOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{editConnection ? "Edit Connection" : "New Connection"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder="Production Server"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label>Host</Label>
              <Input
                placeholder="192.168.1.100"
                value={form.host}
                onChange={(e) => handleChange("host", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Port</Label>
              <Input
                type="number"
                placeholder="22"
                value={form.port}
                onChange={(e) => handleChange("port", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Username</Label>
            <Input
              placeholder="root"
              value={form.username}
              onChange={(e) => handleChange("username", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Private Key Path</Label>
            <Input
              placeholder="/Users/you/.ssh/id_rsa"
              value={form.privateKeyPath}
              onChange={(e) => handleChange("privateKeyPath", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Path to the SSH private key on this machine
            </p>
          </div>
          <div className="space-y-2">
            <Label>Passphrase</Label>
            <Input
              type="password"
              placeholder="Leave empty if key is not encrypted"
              value={form.passphrase}
              onChange={(e) => handleChange("passphrase", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Default Path</Label>
            <Input
              placeholder="/"
              value={form.defaultPath}
              onChange={(e) => handleChange("defaultPath", e.target.value)}
            />
          </div>

          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                testResult.success
                  ? "bg-green-500/10 text-green-600"
                  : "bg-red-500/10 text-red-600"
              }`}
            >
              {testResult.success ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {testResult.message}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleTest} disabled={!isValid || testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Test
            </Button>
            <Button onClick={handleSave} disabled={!isValid || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editConnection ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
