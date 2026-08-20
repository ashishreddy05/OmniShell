const originalContentMap = new Map<string, string>();

export function setOriginalContent(tabId: string, content: string): void {
  originalContentMap.set(tabId, content);
}

export function getOriginalContent(tabId: string): string | undefined {
  return originalContentMap.get(tabId);
}

export function removeOriginalContent(tabId: string): void {
  originalContentMap.delete(tabId);
}

export function removeOriginalContentForConnection(connectionId: string): void {
  for (const key of originalContentMap.keys()) {
    if (key.startsWith(`${connectionId}:`)) {
      originalContentMap.delete(key);
    }
  }
}
