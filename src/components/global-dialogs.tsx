"use client";

import { ConnectionForm } from "@/components/connections/connection-form";
import { SSHImportDialog } from "@/components/connections/ssh-import-dialog";
import { UserManualDialog } from "@/components/layout/user-manual-dialog";
import { CommandPalette } from "@/components/command-palette";
import { ServiceBuilderDialog } from "@/components/services/service-builder-dialog";
import { useUIStore } from "@/stores/ui-store";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { connectionsApi } from "@/lib/api-client";

export function GlobalDialogs() {
  const connectionFormOpen = useUIStore((s) => s.connectionFormOpen);
  const editingConnectionId = useUIStore((s) => s.editingConnectionId);
  const closeConnectionForm = useUIStore((s) => s.closeConnectionForm);
  const sshImportOpen = useUIStore((s) => s.sshImportOpen);
  const closeSSHImport = useUIStore((s) => s.closeSSHImport);
  const queryClient = useQueryClient();

  const { data: connections = [] } = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
  });

  const editConnection = editingConnectionId
    ? connections.find((c) => c.id === editingConnectionId)
    : undefined;

  return (
    <>
      <ConnectionForm
        key={editingConnectionId ?? "new"}
        open={connectionFormOpen}
        onClose={closeConnectionForm}
        editConnection={editConnection}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["connections"] });
          closeConnectionForm();
        }}
      />
      <SSHImportDialog
        open={sshImportOpen}
        onClose={closeSSHImport}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ["connections"] });
          closeSSHImport();
        }}
      />
      <UserManualDialog />
      <CommandPalette />
      <ServiceBuilderDialog />
    </>
  );
}
