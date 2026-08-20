"use client";

import { ServicesPanel } from "./services-panel";

export function ServicesPage() {
  return (
    <div className="h-full flex flex-col animate-fade-in">
      <div className="flex-1 min-h-0 overflow-hidden">
        <ServicesPanel />
      </div>
    </div>
  );
}
