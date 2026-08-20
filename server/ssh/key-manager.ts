import { readFileSync } from "fs";
import { access, constants } from "fs/promises";

export async function validateKeyPath(keyPath: string): Promise<void> {
  try {
    await access(keyPath, constants.R_OK);
  } catch {
    throw new Error(`SSH key not found or not readable: ${keyPath}`);
  }
}

export function readPrivateKey(keyPath: string): Buffer {
  try {
    return readFileSync(keyPath);
  } catch (err) {
    throw new Error(`Failed to read SSH key at ${keyPath}: ${(err as Error).message}`);
  }
}

export function isEncryptedKey(keyContent: Buffer): boolean {
  const str = keyContent.toString("utf-8");
  return str.includes("ENCRYPTED");
}
