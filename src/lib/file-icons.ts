import {
  File, Folder, FileText, FileCode, FileJson, Image, Film, Music,
  FileSpreadsheet, FileType, Database, Settings, Lock, Terminal,
  Package, GitBranch, Globe, Braces,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const extensionIcons: Record<string, LucideIcon> = {
  // Code
  js: FileCode, jsx: FileCode, ts: FileCode, tsx: FileCode,
  mjs: FileCode, cjs: FileCode,
  py: FileCode, rb: FileCode, go: FileCode, rs: FileCode,
  java: FileCode, kt: FileCode, scala: FileCode,
  c: FileCode, cpp: FileCode, h: FileCode, hpp: FileCode,
  cs: FileCode, php: FileCode, swift: FileCode, dart: FileCode,
  lua: FileCode, r: FileCode,
  vue: FileCode, svelte: FileCode, astro: FileCode,

  // Web
  html: Globe, css: FileType, scss: FileType, sass: FileType, less: FileType,

  // Data
  json: FileJson, xml: Braces, yaml: FileJson, yml: FileJson,
  toml: FileJson, csv: FileSpreadsheet, tsv: FileSpreadsheet,

  // Images
  jpg: Image, jpeg: Image, png: Image, gif: Image,
  webp: Image, svg: Image, bmp: Image, ico: Image,

  // Video/Audio
  mp4: Film, webm: Film, ogg: Film, mov: Film, avi: Film,
  mp3: Music, wav: Music, flac: Music, aac: Music, m4a: Music,

  // Documents
  md: FileText, mdx: FileText, txt: FileText, log: FileText,
  pdf: FileText, doc: FileText, docx: FileText,

  // Config
  env: Settings, ini: Settings, cfg: Settings, conf: Settings,
  gitignore: GitBranch, gitattributes: GitBranch,

  // Database
  sql: Database, db: Database, sqlite: Database,

  // Shell
  sh: Terminal, bash: Terminal, zsh: Terminal, fish: Terminal,

  // Package
  zip: Package, tar: Package, gz: Package, rar: Package, "7z": Package,

  // Security
  pem: Lock, key: Lock, crt: Lock, cer: Lock,
};

export function getFileIcon(filename: string, isDirectory: boolean): LucideIcon {
  if (isDirectory) return Folder;

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return extensionIcons[ext] || File;
}

export function getFileIconColor(filename: string, isDirectory: boolean): string {
  if (isDirectory) return "text-rose-400";

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const colorMap: Record<string, string> = {
    js: "text-amber-400", jsx: "text-amber-400", mjs: "text-amber-400",
    ts: "text-violet-400", tsx: "text-violet-400",
    py: "text-emerald-400", rb: "text-rose-400", go: "text-teal-400",
    rs: "text-orange-400", java: "text-red-400",
    html: "text-orange-300", css: "text-sky-400",
    json: "text-amber-300", md: "text-pink-300",
    jpg: "text-pink-400", png: "text-pink-400", gif: "text-pink-400",
    svg: "text-rose-300",
    mp4: "text-violet-300", mp3: "text-emerald-300",
    pdf: "text-red-400",
    sh: "text-teal-300",
    sql: "text-indigo-300",
    env: "text-amber-300",
    lock: "text-stone-400",
  };
  return colorMap[ext] || "text-stone-400";
}
