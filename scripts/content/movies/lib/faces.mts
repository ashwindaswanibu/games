/**
 * Finding faces in photos, for the portrait pipeline: Apple Vision's face detector, through a small
 * Swift program (`faces.swift`) compiled on first use into the temp directory (keyed by its source,
 * so an edit recompiles). macOS only, where the pipeline runs; elsewhere `findFaces` throws.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FaceBox } from "./portraits.mjs";

const run = promisify(execFile);
const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "faces.swift");

let binary: Promise<string> | undefined;

/** The compiled finder, built once per source version. */
function finder(): Promise<string> {
  binary ??= (async () => {
    if (process.platform !== "darwin") throw new Error("Finding faces needs macOS (Apple Vision); run the portrait pipeline on a Mac.");
    const hash = createHash("sha256").update(readFileSync(SOURCE)).digest("hex").slice(0, 12);
    const out = path.join(tmpdir(), `games-faces-${hash}`);
    if (!existsSync(out)) await run("swiftc", ["-O", SOURCE, "-o", out], { maxBuffer: 16 * 1024 * 1024 });
    return out;
  })();
  return binary;
}

export interface FoundFaces {
  width: number;
  height: number;
  faces: FaceBox[];
}

/** The faces in each image (by path). An image the finder couldn't read is absent. */
export async function findFaces(paths: readonly string[]): Promise<Map<string, FoundFaces>> {
  const found = new Map<string, FoundFaces>();
  if (paths.length === 0) return found;
  const { stdout } = await run(await finder(), [...paths], { maxBuffer: 16 * 1024 * 1024 });
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { path: string; width?: number; height?: number; faces: FaceBox[]; error?: string };
    if (row.error || !row.width || !row.height) continue;
    found.set(row.path, { width: row.width, height: row.height, faces: row.faces });
  }
  return found;
}
