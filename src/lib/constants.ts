export const APP_NAME = "OmniShell";

export const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
export const MAX_PREVIEW_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_EDITOR_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const SSH_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export const SUPPORTED_PREVIEW_TYPES = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"],
  video: ["mp4", "webm", "ogg", "mov", "avi"],
  audio: ["mp3", "wav", "ogg", "flac", "aac", "m4a"],
  pdf: ["pdf"],
  markdown: ["md", "mdx"],
  text: [
    "txt", "log", "json", "xml", "yaml", "yml", "toml", "ini", "cfg",
    "conf", "env", "sh", "bash", "zsh", "fish",
    "js", "jsx", "ts", "tsx", "mjs", "cjs",
    "py", "rb", "go", "rs", "java", "kt", "scala", "c", "cpp", "h", "hpp",
    "cs", "php", "swift", "dart", "lua", "r",
    "html", "css", "scss", "sass", "less",
    "sql", "graphql", "prisma",
    "dockerfile", "makefile", "gitignore",
    "vue", "svelte", "astro",
  ],
} as const;

export function getFileCategory(filename: string): keyof typeof SUPPORTED_PREVIEW_TYPES | "unknown" {
  // Split on dots, strip leading dot for dotfiles (.env.local → ["env", "local"])
  const parts = filename.replace(/^\./, "").split(".");
  // Check from last segment backwards so .env.local tries "local" then "env"
  for (let i = parts.length - 1; i >= 0; i--) {
    const ext = parts[i].toLowerCase();
    for (const [category, extensions] of Object.entries(SUPPORTED_PREVIEW_TYPES)) {
      if ((extensions as readonly string[]).includes(ext)) {
        return category as keyof typeof SUPPORTED_PREVIEW_TYPES;
      }
    }
  }
  return "unknown";
}

export function getLanguageFromExtension(filename: string): string {
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python", rb: "ruby", go: "go", rs: "rust",
    java: "java", kt: "kotlin", scala: "scala",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    cs: "csharp", php: "php", swift: "swift", dart: "dart",
    lua: "lua", r: "r",
    html: "html", css: "css", scss: "scss", sass: "sass", less: "less",
    json: "json", xml: "xml", yaml: "yaml", yml: "yaml",
    toml: "toml", ini: "ini",
    sql: "sql", graphql: "graphql",
    sh: "shell", bash: "shell", zsh: "shell",
    md: "markdown", mdx: "markdown",
    dockerfile: "dockerfile",
    vue: "vue", svelte: "svelte",
    env: "ini",
  };
  const parts = filename.replace(/^\./, "").split(".");
  for (let i = parts.length - 1; i >= 0; i--) {
    const lang = map[parts[i].toLowerCase()];
    if (lang) return lang;
  }
  return "plaintext";
}
