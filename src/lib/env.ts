import "server-only";

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  return value;
}

export const env = {
  GOOGLE_API_KEY: readEnv("GOOGLE_API_KEY"),
  AUTH_TOKEN: readEnv("AUTH_TOKEN"),
  NODE_ENV: readEnv("NODE_ENV") ?? "development",
};
