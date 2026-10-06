import { spawn, spawnSync } from "node:child_process";
import type { FrameGeometry } from "@/games/color-barcode/barcode";

/**
 * Video input for the color barcode pipeline (`../barcodes.mts`), through the ffmpeg and ffprobe
 * command-line tools. Kept apart from the barcode math, which is pure and lives with the game.
 */

export const FFMPEG_INSTALL_HINT =
  "Install it (macOS: `brew install ffmpeg`, Debian/Ubuntu: `apt install ffmpeg`) and make sure it's on your PATH.";

/** Fails with install instructions unless `name` runs. */
export function requireTool(name: "ffmpeg" | "ffprobe"): void {
  const result = spawnSync(name, ["-hide_banner", "-version"], { stdio: "ignore" });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${name} isn't installed. ${FFMPEG_INSTALL_HINT}`);
  if (result.error) throw new Error(`Couldn't run ${name}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${name} -version exited with ${result.status}. ${FFMPEG_INSTALL_HINT}`);
}

/** The video's duration in seconds, from its container. */
export function probeDuration(path: string): number {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], {
    encoding: "utf8",
  });
  if (result.error) throw new Error(`Couldn't run ffprobe: ${result.error.message}. ${FFMPEG_INSTALL_HINT}`);
  const seconds = Number(result.stdout.trim());
  if (result.status !== 0 || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe couldn't read the duration of ${path}: ${result.stderr.trim() || "not a video?"}`);
  }
  return seconds;
}

/**
 * Decodes the first video stream into packed rgb24 frames: `fps` frames per second of film, each
 * area-averaged down to `geometry`. `expectedFrames` only drives the progress readout.
 */
export function decodeFrames(path: string, options: { fps: number; geometry: FrameGeometry; expectedFrames: number }): Promise<Buffer> {
  const { fps, geometry, expectedFrames } = options;
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        ...["-hide_banner", "-loglevel", "error", "-nostdin", "-i", path],
        ...["-map", "0:v:0", "-an", "-sn", "-dn"],
        ...["-vf", `fps=${fps},scale=${geometry.width}:${geometry.height}:flags=area,format=rgb24`],
        ...["-f", "rawvideo", "pipe:1"],
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    const frameBytes = geometry.width * geometry.height * 3;
    let bytes = 0;
    let lastReport = -5;
    let stderr = "";
    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      bytes += chunk.length;
      const percent = Math.min(99, Math.floor((100 * bytes) / frameBytes / Math.max(1, expectedFrames)));
      if (percent >= lastReport + 5) {
        lastReport = percent;
        process.stderr.write(`\r  decoding ${percent}%`);
      }
    });
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    ffmpeg.on("error", (error) => reject(new Error(`Couldn't start ffmpeg: ${error.message}. ${FFMPEG_INSTALL_HINT}`)));
    ffmpeg.on("close", (code) => {
      process.stderr.write("\r\x1b[K");
      if (code !== 0) reject(new Error(`ffmpeg failed on ${path} (exit ${code}): ${stderr.trim() || "no details"}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}
