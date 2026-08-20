import type { Client, SFTPWrapper } from "ssh2";
import * as path from "path";
import { acquireSftp, releaseSftp } from "./sftp-pool";
import { execCommand } from "./exec";

function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  permissions: string;
  owner: number;
  group: number;
  modified: string;
  accessed: string;
  isHidden: boolean;
}

export interface FileStat {
  type: "file" | "directory" | "symlink";
  size: number;
  permissions: string;
  owner: number;
  group: number;
  modified: string;
  accessed: string;
}

function permissionsToString(mode: number): string {
  const perms = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
  const owner = perms[(mode >> 6) & 7];
  const group = perms[(mode >> 3) & 7];
  const other = perms[mode & 7];
  return `${owner}${group}${other}`;
}

function getFileType(attrs: { isDirectory: () => boolean; isSymbolicLink: () => boolean }): "file" | "directory" | "symlink" {
  if (attrs.isDirectory()) return "directory";
  if (attrs.isSymbolicLink()) return "symlink";
  return "file";
}

function sanitizePath(inputPath: string): string {
  const resolved = path.posix.resolve("/", inputPath);
  if (resolved.includes("\0")) {
    throw new Error("Invalid path: contains null bytes");
  }
  return resolved;
}

export async function listDirectory(connectionId: string, client: Client, dirPath: string): Promise<{ path: string; entries: FileEntry[]; parent: string | null }> {
  const safePath = sanitizePath(dirPath);

  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      return await new Promise((resolve, reject) => {
        sftp.readdir(safePath, (err, list) => {
          if (err) {
            reject(err);
            return;
          }

          const entries: FileEntry[] = list.map((item) => ({
            name: item.filename,
            path: path.posix.join(safePath, item.filename),
            type: getFileType(item.attrs),
            size: item.attrs.size,
            permissions: permissionsToString(item.attrs.mode & 0o777),
            owner: item.attrs.uid,
            group: item.attrs.gid,
            modified: new Date((item.attrs.mtime || 0) * 1000).toISOString(),
            accessed: new Date((item.attrs.atime || 0) * 1000).toISOString(),
            isHidden: item.filename.startsWith("."),
          }));

          const parent = safePath === "/" ? null : path.posix.dirname(safePath);
          resolve({ path: safePath, entries, parent });
        });
      });
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    try {
      // 1. Try listing using GNU find first (fast, works on standard Linux without Python)
      try {
        const cmd = `sudo find ${shellEscape(safePath)} -maxdepth 1 -mindepth 1 -printf '%f\\t%s\\t%m\\t%U\\t%G\\t%T@\\t%A@\\t%y\\n'`;
        const { stdout, stderr } = await execCommand(client, cmd);
        if (stderr && stderr.includes("password is required")) {
          throw new Error(stderr);
        }

        const lines = stdout.split("\n").filter(Boolean);
        const entries: FileEntry[] = lines.map((line) => {
          const parts = line.split("\t");
          const name = parts[0] || "";
          const size = parseInt(parts[1], 10) || 0;
          const mode = parseInt(parts[2], 8) || 0;
          const uid = parseInt(parts[3], 10) || 0;
          const gid = parseInt(parts[4], 10) || 0;
          const mtime = parseFloat(parts[5]) || 0;
          const atime = parseFloat(parts[6]) || 0;
          const typeChar = parts[7] || "f";

          let type: "file" | "directory" | "symlink" = "file";
          if (typeChar === "d") type = "directory";
          else if (typeChar === "l") type = "symlink";

          return {
            name,
            path: path.posix.join(safePath, name),
            type,
            size,
            permissions: permissionsToString(mode & 0o777),
            owner: uid,
            group: gid,
            modified: new Date(mtime * 1000).toISOString(),
            accessed: new Date(atime * 1000).toISOString(),
            isHidden: name.startsWith("."),
          };
        });

        const parent = safePath === "/" ? null : path.posix.dirname(safePath);
        return { path: safePath, entries, parent };
      } catch (findErr: any) {
        if (findErr.message && findErr.message.includes("password is required")) {
          throw findErr;
        }
        // Fall back to python method if find is not available or failed
        const pyScript = `import os, json, stat
p = ${JSON.stringify(safePath)}
try:
    res = []
    for f in os.listdir(p):
        try:
            fp = os.path.join(p, f)
            st = os.stat(fp)
            is_dir = stat.S_ISDIR(st.st_mode)
            is_link = stat.S_ISLNK(st.st_mode)
            ftype = "directory" if is_dir else ("symlink" if is_link else "file")
            res.append({
                "name": f,
                "size": st.st_size,
                "mode": st.st_mode,
                "uid": st.st_uid,
                "gid": st.st_gid,
                "mtime": st.st_mtime,
                "atime": st.st_atime,
                "type": ftype
            })
        except:
            res.append({
                "name": f,
                "size": 0,
                "mode": 0,
                "uid": 0,
                "gid": 0,
                "mtime": 0,
                "atime": 0,
                "type": "file"
            })
    print(json.dumps(res))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;

        const { stdout } = await execCommand(client, `sudo python3 -c ${shellEscape(pyScript)}`);
        const parsed = JSON.parse(stdout);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        const entries: FileEntry[] = parsed.map((item: any) => ({
          name: item.name,
          path: path.posix.join(safePath, item.name),
          type: item.type,
          size: item.size,
          permissions: permissionsToString(item.mode & 0o777),
          owner: item.uid,
          group: item.gid,
          modified: new Date(item.mtime * 1000).toISOString(),
          accessed: new Date(item.atime * 1000).toISOString(),
          isHidden: item.name.startsWith("."),
        }));
        const parent = safePath === "/" ? null : path.posix.dirname(safePath);
        return { path: safePath, entries, parent };
      }
    } catch (fallbackErr: any) {
      throw new Error(`Failed to list directory ${safePath}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

export async function statFile(connectionId: string, client: Client, filePath: string): Promise<FileStat> {
  const safePath = sanitizePath(filePath);

  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      return await new Promise((resolve, reject) => {
        sftp.stat(safePath, (err, stats) => {
          if (err) {
            reject(err);
            return;
          }

          resolve({
            type: getFileType(stats),
            size: stats.size,
            permissions: permissionsToString(stats.mode & 0o777),
            owner: stats.uid,
            group: stats.gid,
            modified: new Date((stats.mtime || 0) * 1000).toISOString(),
            accessed: new Date((stats.atime || 0) * 1000).toISOString(),
          });
        });
      });
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    try {
      // 1. Try using GNU find first (fast, works on standard Linux without Python)
      try {
        const cmd = `sudo find ${shellEscape(safePath)} -maxdepth 0 -printf '%s\\t%m\\t%U\\t%G\\t%T@\\t%A@\\t%y\\n'`;
        const { stdout, stderr } = await execCommand(client, cmd);
        if (stderr && stderr.includes("password is required")) {
          throw new Error(stderr);
        }

        const line = stdout.trim();
        if (!line) {
          throw new Error("No output from find");
        }

        const parts = line.split("\t");
        const size = parseInt(parts[0], 10) || 0;
        const mode = parseInt(parts[1], 8) || 0;
        const uid = parseInt(parts[2], 10) || 0;
        const gid = parseInt(parts[3], 10) || 0;
        const mtime = parseFloat(parts[4]) || 0;
        const atime = parseFloat(parts[5]) || 0;
        const typeChar = parts[6] || "f";

        let type: "file" | "directory" | "symlink" = "file";
        if (typeChar === "d") type = "directory";
        else if (typeChar === "l") type = "symlink";

        return {
          type,
          size,
          permissions: permissionsToString(mode & 0o777),
          owner: uid,
          group: gid,
          modified: new Date(mtime * 1000).toISOString(),
          accessed: new Date(atime * 1000).toISOString(),
        };
      } catch (findErr: any) {
        if (findErr.message && findErr.message.includes("password is required")) {
          throw findErr;
        }
        // Fall back to Python method
        const pyScript = `import os, stat, json
p = ${JSON.stringify(safePath)}
try:
    st = os.stat(p)
    is_dir = stat.S_ISDIR(st.st_mode)
    is_link = stat.S_ISLNK(st.st_mode)
    ftype = "directory" if is_dir else ("symlink" if is_link else "file")
    print(json.dumps({
        "type": ftype,
        "size": st.st_size,
        "mode": st.st_mode,
        "uid": st.st_uid,
        "gid": st.st_gid,
        "mtime": st.st_mtime,
        "atime": st.st_atime
    }))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;

        const { stdout } = await execCommand(client, `sudo python3 -c ${shellEscape(pyScript)}`);
        const parsed = JSON.parse(stdout);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        return {
          type: parsed.type,
          size: parsed.size,
          permissions: permissionsToString(parsed.mode & 0o777),
          owner: parsed.uid,
          group: parsed.gid,
          modified: new Date(parsed.mtime * 1000).toISOString(),
          accessed: new Date(parsed.atime * 1000).toISOString(),
        };
      }
    } catch (fallbackErr: any) {
      throw new Error(`Failed to stat ${safePath}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

export async function readFile(connectionId: string, client: Client, filePath: string): Promise<Buffer> {
  const safePath = sanitizePath(filePath);

  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      return await new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const stream = sftp.createReadStream(safePath);

        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
        stream.on("error", (err: Error) => {
          reject(err);
        });
      });
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    try {
      const { stdout, stderr } = await execCommand(client, `sudo cat ${shellEscape(safePath)}`);
      if (stderr && stderr.includes("password is required")) {
        throw new Error(stderr);
      }
      return Buffer.from(stdout);
    } catch (fallbackErr: any) {
      throw new Error(`Failed to read ${safePath}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

export async function chmod(connectionId: string, client: Client, paths: string[], mode: string): Promise<void> {
  if (!paths.length) return;
  // Validate mode strictly: numeric (e.g. 755) or symbolic (e.g. u+x, go-rw)
  if (!/^[0-7]{3,4}$/.test(mode) && !/^[augo+-=rwxXst]+$/.test(mode)) {
    throw new Error(`Invalid chmod mode: ${mode}`);
  }
  const safePaths = paths.map(sanitizePath).map(shellEscape);
  // Try SFTP first (per file)
  let sftpFailed = false;
  for (const p of safePaths) {
    try {
      const sftp = await acquireSftp(connectionId, client);
      try {
        await new Promise<void>((resolve, reject) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sftp as any).chmod(p, mode, (err: Error | null | undefined) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } finally {
        releaseSftp(connectionId);
      }
    } catch {
      sftpFailed = true;
      break;
    }
  }
  if (!sftpFailed) return;

  // Fallback: single sudo chmod over all paths (one SSH call, batched)
  const { stderr } = await execCommand(client, `sudo chmod ${mode} ${safePaths.join(" ")}`);
  if (stderr && (stderr.includes("Permission denied") || stderr.includes("No such file"))) {
    throw new Error(stderr.trim());
  }
}

export async function writeFile(connectionId: string, client: Client, filePath: string, content: string | Buffer, encoding: BufferEncoding = "utf-8"): Promise<void> {
  const safePath = sanitizePath(filePath);

  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      return await new Promise((resolve, reject) => {
        const buffer = typeof content === "string" ? Buffer.from(content, encoding) : content;
        const stream = sftp.createWriteStream(safePath);

        stream.on("close", () => {
          resolve();
        });
        stream.on("error", (err: Error) => {
          reject(err);
        });

        stream.end(buffer);
      });
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    // Write to a temporary file in /tmp first and then use sudo mv to move it to the target
    try {
      const sftp = await acquireSftp(connectionId, client);
      const tempPath = `/tmp/.tmp_omnishell_save_${Math.random().toString(36).substring(7)}`;
      try {
        await new Promise<void>((resolve, reject) => {
          const buffer = typeof content === "string" ? Buffer.from(content, encoding) : content;
          const stream = sftp.createWriteStream(tempPath);
          stream.on("close", resolve);
          stream.on("error", reject);
          stream.end(buffer);
        });
      } finally {
        releaseSftp(connectionId);
      }

      const { stderr } = await execCommand(client, `sudo mv -f ${shellEscape(tempPath)} ${shellEscape(safePath)}`);
      if (stderr && (stderr.includes("Permission denied") || stderr.includes("password is required"))) {
        throw new Error(stderr);
      }
    } catch (fallbackErr: any) {
      throw new Error(`Failed to write ${safePath}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

export async function createDirectory(connectionId: string, client: Client, dirPath: string): Promise<void> {
  const safePath = sanitizePath(dirPath);

  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      return await new Promise((resolve, reject) => {
        sftp.mkdir(safePath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    try {
      await execCommand(client, `sudo mkdir -p ${shellEscape(safePath)}`);
    } catch (fallbackErr: any) {
      throw new Error(`Failed to create directory ${safePath}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

export async function ensureDirectory(connectionId: string, client: Client, dirPath: string): Promise<void> {
  const safePath = sanitizePath(dirPath);
  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      const segments = safePath.split("/").filter(Boolean);
      let current = "/";
      for (const segment of segments) {
        current = path.posix.join(current, segment);
        await new Promise<void>((resolve, reject) => {
          sftp.stat(current, (err) => {
            if (err) {
              sftp.mkdir(current, (mkdirErr) => {
                if (mkdirErr) reject(mkdirErr);
                else resolve();
              });
            } else {
              resolve();
            }
          });
        });
      }
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    try {
      await execCommand(client, `sudo mkdir -p ${shellEscape(safePath)}`);
    } catch (fallbackErr: any) {
      throw new Error(`Failed to ensure directory ${safePath}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

export async function deleteFile(connectionId: string, client: Client, filePath: string): Promise<void> {
  const safePath = sanitizePath(filePath);

  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      return await new Promise((resolve, reject) => {
        sftp.unlink(safePath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    try {
      await execCommand(client, `sudo rm -f ${shellEscape(safePath)}`);
    } catch (fallbackErr: any) {
      throw new Error(`Failed to delete ${safePath}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

export async function deleteDirectory(connectionId: string, client: Client, dirPath: string): Promise<void> {
  const safePath = sanitizePath(dirPath);

  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      const rmrf = async (sftpSession: SFTPWrapper, targetPath: string): Promise<void> => {
        return new Promise((resolve, reject) => {
          sftpSession.readdir(targetPath, async (err, list) => {
            if (err) {
              sftpSession.unlink(targetPath, (unlinkErr) => {
                if (unlinkErr) reject(unlinkErr);
                else resolve();
              });
              return;
            }

            try {
              for (const item of list) {
                const itemPath = path.posix.join(targetPath, item.filename);
                if (item.attrs.isSymbolicLink()) {
                  await new Promise<void>((res, rej) => {
                    sftpSession.unlink(itemPath, (e) => (e ? rej(e) : res()));
                  });
                } else if (item.attrs.isDirectory()) {
                  await rmrf(sftpSession, itemPath);
                } else {
                  await new Promise<void>((res, rej) => {
                    sftpSession.unlink(itemPath, (e) => (e ? rej(e) : res()));
                  });
                }
              }
              await new Promise<void>((res, rej) => {
                sftpSession.rmdir(targetPath, (e) => (e ? rej(e) : res()));
              });
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
      };
      await rmrf(sftp, safePath);
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    try {
      await execCommand(client, `sudo rm -rf ${shellEscape(safePath)}`);
    } catch (fallbackErr: any) {
      throw new Error(`Failed to delete directory ${safePath}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

export async function rename(connectionId: string, client: Client, oldPath: string, newPath: string): Promise<void> {
  const safeOld = sanitizePath(oldPath);
  const safeNew = sanitizePath(newPath);

  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      return await new Promise((resolve, reject) => {
        sftp.rename(safeOld, safeNew, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    try {
      await execCommand(client, `sudo mv -f ${shellEscape(safeOld)} ${shellEscape(safeNew)}`);
    } catch (fallbackErr: any) {
      throw new Error(`Failed to rename ${safeOld} to ${safeNew}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

// Internal stream-based copy using an existing SFTP session
function copyFileWithSftp(sftp: SFTPWrapper, safeSrc: string, safeDest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = sftp.createReadStream(safeSrc);
    const writeStream = sftp.createWriteStream(safeDest);

    readStream.on("error", (err: Error) => {
      reject(new Error(`Failed to copy ${safeSrc}: ${err.message}`));
    });
    writeStream.on("error", (err: Error) => {
      reject(new Error(`Failed to copy to ${safeDest}: ${err.message}`));
    });
    writeStream.on("close", () => {
      resolve();
    });

    readStream.pipe(writeStream);
  });
}

function mkdirWithSftp(sftp: SFTPWrapper, dirPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(dirPath, (err) => {
      if (err) reject(new Error(`Failed to create directory ${dirPath}: ${err.message}`));
      else resolve();
    });
  });
}

function readdirWithSftp(sftp: SFTPWrapper, dirPath: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(dirPath, (err, list) => {
      if (err) {
        reject(new Error(`Failed to list directory ${dirPath}: ${err.message}`));
        return;
      }
      resolve(list.map((item) => ({
        name: item.filename,
        path: path.posix.join(dirPath, item.filename),
        type: getFileType(item.attrs),
        size: item.attrs.size,
        permissions: permissionsToString(item.attrs.mode & 0o777),
        owner: item.attrs.uid,
        group: item.attrs.gid,
        modified: new Date((item.attrs.mtime || 0) * 1000).toISOString(),
        accessed: new Date((item.attrs.atime || 0) * 1000).toISOString(),
        isHidden: item.filename.startsWith("."),
      })));
    });
  });
}

async function copyDirectoryWithSftp(sftp: SFTPWrapper, safeSrc: string, safeDest: string): Promise<void> {
  await mkdirWithSftp(sftp, safeDest);
  const entries = await readdirWithSftp(sftp, safeSrc);

  for (const entry of entries) {
    const newDest = path.posix.join(safeDest, entry.name);
    if (entry.type === "directory") {
      await copyDirectoryWithSftp(sftp, entry.path, newDest);
    } else if (entry.type === "symlink") {
      // Skip symlinks during copy to avoid following into unrelated directories
      continue;
    } else {
      await copyFileWithSftp(sftp, entry.path, newDest);
    }
  }
}

export async function copyFile(connectionId: string, client: Client, srcPath: string, destPath: string): Promise<void> {
  const safeSrc = sanitizePath(srcPath);
  const safeDest = sanitizePath(destPath);
  const sftp = await acquireSftp(connectionId, client);

  try {
    await copyFileWithSftp(sftp, safeSrc, safeDest);
  } finally {
    releaseSftp(connectionId);
  }
}

export async function copyDirectory(connectionId: string, client: Client, srcPath: string, destPath: string): Promise<void> {
  const safeSrc = sanitizePath(srcPath);
  const safeDest = sanitizePath(destPath);
  const sftp = await acquireSftp(connectionId, client);

  try {
    await copyDirectoryWithSftp(sftp, safeSrc, safeDest);
  } finally {
    releaseSftp(connectionId);
  }
}

export async function uploadFile(
  connectionId: string,
  client: Client,
  remotePath: string,
  data: Buffer | ReadableStream<Uint8Array>,
  totalBytes: number,
  onProgress?: (bytesWritten: number, totalBytes: number) => void
): Promise<void> {
  const safePath = sanitizePath(remotePath);

  try {
    const sftp = await acquireSftp(connectionId, client);
    try {
      return await new Promise((resolve, reject) => {
        const stream = sftp.createWriteStream(safePath);
        let bytesWritten = 0;

        stream.on("close", () => {
          resolve();
        });
        stream.on("error", (err: Error) => {
          reject(err);
        });

        if (Buffer.isBuffer(data)) {
          // Buffer mode: write in chunks for progress reporting
          const CHUNK_SIZE = 64 * 1024;
          let offset = 0;

          function writeChunk() {
            while (offset < (data as Buffer).length) {
              const end = Math.min(offset + CHUNK_SIZE, (data as Buffer).length);
              const chunk = (data as Buffer).subarray(offset, end);
              offset = end;
              bytesWritten = offset;
              onProgress?.(bytesWritten, totalBytes);

              if (!stream.write(chunk)) {
                stream.once("drain", writeChunk);
                return;
              }
            }
            stream.end();
          }

          writeChunk();
        } else {
          // Stream mode: pipe ReadableStream chunks directly
          const reader = data.getReader();

          async function pump() {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  stream.end();
                  return;
                }
                bytesWritten += value.byteLength;
                onProgress?.(bytesWritten, totalBytes);
                if (!stream.write(Buffer.from(value))) {
                  await new Promise<void>((r) => stream.once("drain", r));
                }
              }
            } catch (err) {
              stream.destroy();
              reject(err);
            }
          }

          pump();
        }
      });
    } finally {
      releaseSftp(connectionId);
    }
  } catch (err: any) {
    try {
      const sftp = await acquireSftp(connectionId, client);
      const tempPath = `/tmp/.tmp_omnishell_upload_${Math.random().toString(36).substring(7)}`;
      try {
        await new Promise<void>((resolve, reject) => {
          const stream = sftp.createWriteStream(tempPath);
          let bytesWritten = 0;

          stream.on("close", () => {
            resolve();
          });
          stream.on("error", (streamErr: Error) => {
            reject(streamErr);
          });

          if (Buffer.isBuffer(data)) {
            const CHUNK_SIZE = 64 * 1024;
            let offset = 0;

            function writeChunk() {
              while (offset < (data as Buffer).length) {
                const end = Math.min(offset + CHUNK_SIZE, (data as Buffer).length);
                const chunk = (data as Buffer).subarray(offset, end);
                offset = end;
                bytesWritten = offset;
                onProgress?.(bytesWritten, totalBytes);

                if (!stream.write(chunk)) {
                  stream.once("drain", writeChunk);
                  return;
                }
              }
              stream.end();
            }

            writeChunk();
          } else {
            const reader = data.getReader();

            async function pump() {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    stream.end();
                    return;
                  }
                  bytesWritten += value.byteLength;
                  onProgress?.(bytesWritten, totalBytes);
                  if (!stream.write(Buffer.from(value))) {
                    await new Promise<void>((r) => stream.once("drain", r));
                  }
                }
              } catch (pumpErr) {
                stream.destroy();
                reject(pumpErr);
              }
            }

            pump();
          }
        });
      } finally {
        releaseSftp(connectionId);
      }

      const { stderr } = await execCommand(client, `sudo mv -f ${shellEscape(tempPath)} ${shellEscape(safePath)}`);
      if (stderr && (stderr.includes("Permission denied") || stderr.includes("password is required"))) {
        throw new Error(stderr);
      }
    } catch (fallbackErr: any) {
      throw new Error(`Failed to upload to ${safePath}: ${err.message}. Sudo fallback failed: ${fallbackErr.message}`);
    }
  }
}

export async function createDownloadStream(connectionId: string, client: Client, filePath: string): Promise<{ stream: NodeJS.ReadableStream; connectionId: string }> {
  const safePath = sanitizePath(filePath);
  const sftp = await acquireSftp(connectionId, client);

  const stream = sftp.createReadStream(safePath);
  stream.on("error", (streamErr: Error) => {
    releaseSftp(connectionId);
    throw new Error(`Failed to download ${safePath}: ${streamErr.message}`);
  });
  stream.on("end", () => {
    releaseSftp(connectionId);
  });

  return { stream, connectionId };
}

export interface SearchFileResult {
  path: string;
  type: "file" | "directory";
}

export async function searchFiles(
  connectionId: string,
  client: Client,
  basePath: string,
  query: string,
  type: "name" | "content" = "name"
): Promise<SearchFileResult[]> {
  const safePath = sanitizePath(basePath);
  const safeQuery = query.replace(/[^a-zA-Z0-9_./-]/g, "\\$&");

  const command =
    type === "name"
      ? // Search files AND directories, output "<type>:<path>" per line
        `find "${safePath}" -maxdepth 6 \\( -type f -o -type d \\) -name "*${safeQuery}*" -printf "%y:%p\\n" 2>/dev/null | head -100`
      : `grep -rl --include="*" -m 1 "${safeQuery}" "${safePath}" 2>/dev/null | head -100`;

  const { stdout } = await execCommand(client, command, 30_000);

  const results: SearchFileResult[] = stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      if (type === "content") {
        // content search returns plain paths
        return { path: line, type: "file" as const };
      }
      // name search returns "<y>:<path>" where y is f or d
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) return { path: line, type: "file" as const };
      const typeChar = line.slice(0, colonIdx);
      const filePath = line.slice(colonIdx + 1);
      return {
        path: filePath,
        type: typeChar === "d" ? ("directory" as const) : ("file" as const),
      };
    })
    .filter((r) => r.path.length > 0);

  return results;
}

