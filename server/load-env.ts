import { readFileSync } from "fs";
import { resolve } from "path";

/** Load project-root `.env` into process.env (overwrite). Call before reading PORT / Next config. */
export function loadDotEnv() {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch {
    return;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
