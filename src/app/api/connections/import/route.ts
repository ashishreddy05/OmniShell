import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { parseSSHConfig } from "../../../../../server/ssh/config-parser";
import { validateKeyPath } from "../../../../../server/ssh/key-manager";

// GET: Parse SSH config and return entries for preview (no DB changes)
export async function GET() {
  try {
    const entries = parseSSHConfig();

    // Check which keys exist and which hosts are already imported
    const existing = await db.select({ host: connections.host, username: connections.username }).from(connections);
    const existingSet = new Set(existing.map((e) => `${e.username}@${e.host}`));

    const results = await Promise.all(
      entries.map(async (entry) => {
        let keyValid = false;
        try {
          await validateKeyPath(entry.identityFile);
          keyValid = true;
        } catch {
          // Key not found or not readable
        }

        const alreadyExists = existingSet.has(`${entry.user}@${entry.hostName}`);

        return {
          ...entry,
          keyValid,
          alreadyExists,
        };
      })
    );

    return NextResponse.json({ entries: results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST: Import selected entries into the database
export async function POST(request: Request) {
  try {
    const { hosts } = (await request.json()) as { hosts: string[] };
    if (!hosts || !Array.isArray(hosts) || hosts.length === 0) {
      return NextResponse.json({ error: "No hosts selected" }, { status: 400 });
    }

    const entries = parseSSHConfig();
    const toImport = entries.filter((e) => hosts.includes(e.host));

    if (toImport.length === 0) {
      return NextResponse.json({ error: "No matching hosts found in SSH config" }, { status: 400 });
    }

    // Check for existing connections to skip duplicates
    const existing = await db.select({ host: connections.host, username: connections.username }).from(connections);
    const existingSet = new Set(existing.map((e) => `${e.username}@${e.host}`));

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const entry of toImport) {
      if (existingSet.has(`${entry.user}@${entry.hostName}`)) {
        skipped++;
        continue;
      }

      try {
        await validateKeyPath(entry.identityFile);
      } catch {
        errors.push(`${entry.host}: key not found at ${entry.identityFile}`);
        continue;
      }

      const now = new Date().toISOString();
      await db.insert(connections).values({
        id: nanoid(),
        name: entry.host,
        host: entry.hostName,
        port: entry.port,
        username: entry.user,
        privateKeyPath: entry.identityFile,
        passphrase: null,
        defaultPath: "/",
        createdAt: now,
        updatedAt: now,
      });
      imported++;
    }

    return NextResponse.json({ imported, skipped, errors });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
