import { z } from "zod";

export const connectionSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  host: z.string().min(1, "Host is required").max(255),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1, "Username is required").max(100),
  privateKeyPath: z.string().min(1, "Private key path is required"),
  passphrase: z.string().nullable().optional(),
  defaultPath: z.string().default("/"),
});

export const connectionUpdateSchema = connectionSchema.partial();

export const pathSchema = z.object({
  path: z.string().min(1, "Path is required"),
});

export const writeFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.string().default("utf-8"),
  createIfMissing: z.boolean().default(false),
});

export const renameSchema = z.object({
  oldPath: z.string().min(1),
  newPath: z.string().min(1),
});

export const copySchema = z.object({
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
});

export const deleteSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().default(false),
});

export const searchSchema = z.object({
  query: z.string().min(1),
  path: z.string().default("/"),
  type: z.enum(["name", "content"]).default("name"),
});

export const bookmarkSchema = z.object({
  connectionId: z.string().min(1),
  path: z.string().min(1),
  label: z.string().optional(),
});

export type ConnectionInput = z.infer<typeof connectionSchema>;
export type WriteFileInput = z.infer<typeof writeFileSchema>;
export type RenameInput = z.infer<typeof renameSchema>;
export type CopyInput = z.infer<typeof copySchema>;
export type DeleteInput = z.infer<typeof deleteSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type BookmarkInput = z.infer<typeof bookmarkSchema>;
