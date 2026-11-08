"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { connectionsApi, fsApi, servicesApi } from "@/lib/api-client";
import { useConnectionStore } from "@/stores/connection-store";
import { useUIStore } from "@/stores/ui-store";
import { ensureConnection } from "@/lib/ensure-connection";
import {
  DEFAULT_CPU_QUOTA,
  DEFAULT_MEMORY_MAX,
  DEFAULT_ON_FAILURE,
  DEFAULT_VOICE_AGENT_WD,
  buildUnitFile,
  defaultExecStart,
  unitFilePath,
} from "@/lib/systemd-unit";
import { cn } from "@/lib/utils";

function sanitizeServiceName(raw: string): string {
  return raw
    .trim()
    .replace(/\.service$/i, "")
    .replace(/[^a-zA-Z0-9@_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function ServiceBuilderDialog() {
  const open = useUIStore((s) => s.serviceBuilderOpen);
  const close = useUIStore((s) => s.closeServiceBuilder);
  const activeTabId = useConnectionStore((s) => s.activeTabId);
  const queryClient = useQueryClient();

  const { data: connections = [] } = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
    enabled: open,
  });

  const [connectionId, setConnectionId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [description, setDescription] = useState("");
  const [syslogIdentifier, setSyslogIdentifier] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState(DEFAULT_VOICE_AGENT_WD);
  const [user, setUser] = useState("root");
  const [restart, setRestart] = useState("always");
  const [memoryMax, setMemoryMax] = useState(DEFAULT_MEMORY_MAX);
  const [cpuQuota, setCpuQuota] = useState(DEFAULT_CPU_QUOTA);
  const [slackAlert, setSlackAlert] = useState(true);
  const [execStart, setExecStart] = useState(defaultExecStart(DEFAULT_VOICE_AGENT_WD));
  const [execTouched, setExecTouched] = useState(false);
  const [agentConfigPath, setAgentConfigPath] = useState("");
  const [environmentFile, setEnvironmentFile] = useState("");
  const [clientProfile, setClientProfile] = useState("");
  const [doDaemonReload, setDoDaemonReload] = useState(true);
  const [doEnable, setDoEnable] = useState(true);
  const [doStart, setDoStart] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [configOptions, setConfigOptions] = useState<string[]>([]);
  const [profileOptions, setProfileOptions] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [syslogTouched, setSyslogTouched] = useState(false);
  const [descTouched, setDescTouched] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Seed defaults when dialog opens
  useEffect(() => {
    if (!open) return;
    setConnectionId(activeTabId || "");
    setServiceName("");
    setDescription("");
    setSyslogIdentifier("");
    setWorkingDirectory(DEFAULT_VOICE_AGENT_WD);
    setUser("root");
    setRestart("always");
    setMemoryMax(DEFAULT_MEMORY_MAX);
    setCpuQuota(DEFAULT_CPU_QUOTA);
    setSlackAlert(true);
    setExecStart(defaultExecStart(DEFAULT_VOICE_AGENT_WD));
    setExecTouched(false);
    setSyslogTouched(false);
    setDescTouched(false);
    // Leave empty: orchestrator.py already defaults to configs/agent-config-<env>.json.
    setAgentConfigPath("");
    setEnvironmentFile("");
    setClientProfile("");
    setDoDaemonReload(true);
    setDoEnable(true);
    setDoStart(false);
    setConfigOptions([]);
    setProfileOptions([]);
  }, [open, activeTabId]);

  // Auto-select connection when connections load
  useEffect(() => {
    if (!open || !connections.length) return;
    setConnectionId((prev) => prev || activeTabId || connections[0]?.id || "");
  }, [open, activeTabId, connections]);

  const effectiveName = sanitizeServiceName(serviceName);

  useEffect(() => {
    if (!syslogTouched) setSyslogIdentifier(effectiveName);
  }, [effectiveName, syslogTouched]);

  useEffect(() => {
    if (!descTouched) {
      setDescription(effectiveName ? `GIA voice agent — ${effectiveName}` : "");
    }
  }, [effectiveName, descTouched]);

  useEffect(() => {
    if (!execTouched) setExecStart(defaultExecStart(workingDirectory));
  }, [workingDirectory, execTouched]);

  const discoverRemote = useCallback(async () => {
    if (!connectionId || !workingDirectory) return;
    setDiscovering(true);
    try {
      await ensureConnection(connectionId, connections);
      const wd = workingDirectory.replace(/\/$/, "");
      const [configs, profiles] = await Promise.all([
        fsApi.list(connectionId, `${wd}/configs`).catch(() => null),
        fsApi.list(connectionId, `${wd}/profiles`).catch(() => null),
      ]);
      const cfg = (configs?.entries ?? [])
        .filter((e) => e.type === "file" && /\.(json|ya?ml|toml)$/i.test(e.name))
        .map((e) => e.path)
        .sort();
      const prof = (profiles?.entries ?? [])
        .filter((e) => e.type === "directory" && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort();
      setConfigOptions(cfg);
      setProfileOptions(prof);
      if (cfg.length === 0 && prof.length === 0) {
        toast.info("No configs/ or profiles/ found — enter paths manually");
      } else {
        toast.success(`Found ${cfg.length} config(s), ${prof.length} profile(s)`);
      }
    } catch (err) {
      toast.error(`Discover failed: ${(err as Error).message}`);
    } finally {
      setDiscovering(false);
    }
  }, [connectionId, workingDirectory, connections]);

  const preview = useMemo(() => {
    const extraEnv: Record<string, string> = {};
    if (clientProfile) extraEnv.CLIENT_PROFILE = clientProfile;
    return buildUnitFile({
      description: description || `GIA voice agent — ${effectiveName || "agent"}`,
      user,
      workingDirectory,
      agentConfigPath: agentConfigPath || undefined,
      environmentFile: environmentFile || undefined,
      extraEnv: Object.keys(extraEnv).length ? extraEnv : undefined,
      execStart,
      restart,
      syslogIdentifier: syslogIdentifier || effectiveName || "agent",
      onFailure: slackAlert ? DEFAULT_ON_FAILURE : undefined,
      memoryMax: memoryMax || undefined,
      cpuQuota: cpuQuota || undefined,
    });
  }, [
    description,
    effectiveName,
    user,
    workingDirectory,
    agentConfigPath,
    environmentFile,
    clientProfile,
    execStart,
    restart,
    syslogIdentifier,
    slackAlert,
    memoryMax,
    cpuQuota,
  ]);

  const handleSubmit = async () => {
    if (!connectionId) {
      toast.error("Select a connection");
      return;
    }
    if (!effectiveName) {
      toast.error("Enter a service name");
      return;
    }
    if (!workingDirectory.trim()) {
      toast.error("WorkingDirectory is required");
      return;
    }
    if (!execStart.trim()) {
      toast.error("ExecStart is required");
      return;
    }

    const path = unitFilePath(effectiveName);
    setSubmitting(true);
    try {
      await ensureConnection(connectionId, connections);

      let exists = false;
      try {
        await fsApi.stat(connectionId, path);
        exists = true;
      } catch {
        exists = false;
      }

      if (exists) {
        const ok = window.confirm(
          `${path} already exists. Overwrite? This replaces the unit file on disk.`,
        );
        if (!ok) {
          setSubmitting(false);
          return;
        }
      }

      await fsApi.write(connectionId, path, preview);
      toast.success(`Wrote ${path}`);

      if (doDaemonReload) {
        await servicesApi.daemonReload(connectionId);
        toast.success("daemon-reload complete");
      }
      if (doEnable) {
        await servicesApi.act(connectionId, effectiveName, "enable");
        toast.success(`Enabled ${effectiveName}`);
      }
      if (doStart) {
        await servicesApi.act(connectionId, effectiveName, "start");
        toast.success(`Started ${effectiveName}`);
      }

      await queryClient.invalidateQueries({ queryKey: ["services", connectionId] });
      await queryClient.invalidateQueries({ queryKey: ["service-file", connectionId, effectiveName] });
      close();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!connectionId || !effectiveName) return;
    const ok = window.confirm(`Delete service "${effectiveName}"? This will stop, disable, and remove the unit file.`);
    if (!ok) return;
    setDeleting(true);
    try {
      await ensureConnection(connectionId, connections);
      await servicesApi.delete(connectionId, effectiveName);
      toast.success(`Deleted ${effectiveName}`);
      await queryClient.invalidateQueries({ queryKey: ["services", connectionId] });
      close();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="h-4 w-4 text-primary" />
            Service file builder
          </DialogTitle>
          <DialogDescription>
            Create a voice-agent systemd unit under /etc/systemd/system/. Preview before write.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs">Connection</Label>
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger className="w-full h-8 text-xs">
                <SelectValue placeholder="Select connection" />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name} ({c.username}@{c.host})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Service name</Label>
              <Input
                className="h-8 text-xs font-mono"
                placeholder="moorhead-testing"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">Without .service suffix — writes as {(effectiveName || "name") + ".service"}</p>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">SyslogIdentifier</Label>
              <Input
                className="h-8 text-xs font-mono"
                value={syslogIdentifier}
                onChange={(e) => {
                  setSyslogTouched(true);
                  setSyslogIdentifier(e.target.value);
                }}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Description</Label>
            <Input
              className="h-8 text-xs"
              value={description}
              onChange={(e) => {
                setDescTouched(true);
                setDescription(e.target.value);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">WorkingDirectory</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[10px]"
                disabled={!connectionId || discovering}
                onClick={discoverRemote}
              >
                {discovering ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Discover profiles
              </Button>
            </div>
            <Input
              className="h-8 text-xs font-mono"
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">AGENT_CONFIG_PATH</Label>
              {configOptions.length > 0 ? (
                <Select
                  value={agentConfigPath || "__custom__"}
                  onValueChange={(v) => {
                    if (v === "__custom__") return;
                    setAgentConfigPath(v);
                  }}
                >
                  <SelectTrigger className="w-full h-8 text-xs font-mono">
                    <SelectValue placeholder="Pick config" />
                  </SelectTrigger>
                  <SelectContent>
                    {configOptions.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs font-mono">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Input
                className="h-8 text-xs font-mono"
                placeholder="Optional — defaults to configs/agent-config-<env>.json"
                value={agentConfigPath}
                onChange={(e) => setAgentConfigPath(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">CLIENT_PROFILE (optional)</Label>
              {profileOptions.length > 0 ? (
                <Select
                  value={clientProfile || "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") {
                      setClientProfile("");
                      setEnvironmentFile("");
                      return;
                    }
                    setClientProfile(v);
                    const wd = workingDirectory.replace(/\/$/, "");
                    setEnvironmentFile(`${wd}/profiles/${v}/.env`);
                  }}
                >
                  <SelectTrigger className="w-full h-8 text-xs">
                    <SelectValue placeholder="Pick profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs">
                      None
                    </SelectItem>
                    {profileOptions.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="moorhead-automotive"
                  value={clientProfile}
                  onChange={(e) => setClientProfile(e.target.value)}
                />
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">EnvironmentFile (optional)</Label>
            <Input
              className="h-8 text-xs font-mono"
              placeholder="/opt/agents/.../profiles/slug/.env"
              value={environmentFile}
              onChange={(e) => setEnvironmentFile(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">User</Label>
              <Input className="h-8 text-xs" value={user} onChange={(e) => setUser(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Restart</Label>
              <Select value={restart} onValueChange={setRestart}>
                <SelectTrigger className="w-full h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["always", "on-failure", "no"].map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">MemoryMax</Label>
              <Input
                className="h-8 text-xs font-mono"
                placeholder="3G"
                value={memoryMax}
                onChange={(e) => setMemoryMax(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">CPUQuota</Label>
              <Input
                className="h-8 text-xs font-mono"
                placeholder="90%"
                value={cpuQuota}
                onChange={(e) => setCpuQuota(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">ExecStart</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={execStart}
              onChange={(e) => {
                setExecTouched(true);
                setExecStart(e.target.value);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Preview</Label>
            <Textarea
              readOnly
              className="font-mono text-[11px] min-h-[200px] bg-muted/40"
              value={preview}
            />
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={doDaemonReload} onCheckedChange={setDoDaemonReload} />
              daemon-reload after write
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={doEnable} onCheckedChange={setDoEnable} />
              enable
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={doStart} onCheckedChange={setDoStart} />
              start
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer" title={`OnFailure=${DEFAULT_ON_FAILURE}`}>
              <Switch checked={slackAlert} onCheckedChange={setSlackAlert} />
              Slack alert on failure
            </label>
          </div>
        </div>

        <DialogFooter className="flex-row !justify-between">
          <div>
            {effectiveName && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={submitting || deleting}
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || !effectiveName}
              className={cn(submitting && "opacity-80")}
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FilePlus2 className="h-3.5 w-3.5 mr-1.5" />}
              Write unit
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
