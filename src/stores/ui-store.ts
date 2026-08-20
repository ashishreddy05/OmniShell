"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MainView = "explorer" | "services";
export type SidebarView = "default" | "services";

export interface ReturnView {
  mainView: MainView;
  serviceName: string;
}

interface UIStore {
  sidebarOpen: boolean;
  sidebarWidth: number;
  terminalOpen: boolean;
  terminalHeight: number;
  theme: "light" | "dark" | "system";
  connectionFormOpen: boolean;
  editingConnectionId: string | null;
  sshImportOpen: boolean;
  sidebarView: SidebarView;
  mainView: MainView;
  userManualOpen: boolean;
  returnView: ReturnView | null;
  serviceBuilderOpen: boolean;

  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleTerminal: () => void;
  setTerminalHeight: (height: number) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  openConnectionForm: (editId?: string) => void;
  closeConnectionForm: () => void;
  openSSHImport: () => void;
  closeSSHImport: () => void;
  setSidebarView: (view: SidebarView) => void;
  setMainView: (view: MainView) => void;
  setUserManualOpen: (open: boolean) => void;
  setReturnView: (rv: ReturnView | null) => void;
  openServiceBuilder: () => void;
  closeServiceBuilder: () => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 280,
      terminalOpen: false,
      terminalHeight: 300,
      theme: "dark",
      connectionFormOpen: false,
      editingConnectionId: null,
      sshImportOpen: false,
      sidebarView: "default",
      mainView: "explorer",
      userManualOpen: false,
      returnView: null,
      serviceBuilderOpen: false,

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
      setTerminalHeight: (height) => set({ terminalHeight: height }),
      setTheme: (theme) => set({ theme }),
      openConnectionForm: (editId) => set({ connectionFormOpen: true, editingConnectionId: editId ?? null }),
      closeConnectionForm: () => set({ connectionFormOpen: false, editingConnectionId: null }),
      openSSHImport: () => set({ sshImportOpen: true }),
      closeSSHImport: () => set({ sshImportOpen: false }),
      setSidebarView: (view) => set({ sidebarView: view }),
      setMainView: (view) => set({ mainView: view }),
      setUserManualOpen: (open) => set({ userManualOpen: open }),
      setReturnView: (rv) => set({ returnView: rv }),
      openServiceBuilder: () => set({ serviceBuilderOpen: true }),
      closeServiceBuilder: () => set({ serviceBuilderOpen: false }),
    }),
    {
      name: "omnishell-ui",
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        terminalOpen: state.terminalOpen,
        terminalHeight: state.terminalHeight,
        theme: state.theme,
      }),
    }
  )
);
