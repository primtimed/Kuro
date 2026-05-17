// Local file streaming — serves video files from MEDIA_DIR with range request support.
// Supports: .mp4, .mkv, .avi, .webm, .mov
// Usage:  GET /api/local/stream?file=<base64-encoded absolute path>
//         GET /api/local/scan   → list of { title, episodes: [{ number, path }] }

import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();

const MEDIA_DIR = process.env.MEDIA_DIR?.trim() || "";
const VIDEO_EXTS = new Set([".mp4", ".mkv", ".avi", ".webm", ".mov", ".m4v"]);

function isVideo(f: string) {
  return VIDEO_EXTS.has(path.extname(f).toLowerCase());
}

// Extract episode number from filename: "ep01", "e01", "01", " - 01", "_01."
function epNum(filename: string): number | null {
  const bare = path.basename(filename, path.extname(filename));
  const patterns = [
    /[Ee](?:pisode)?[\s_-]?0*(\d+)/,   // Episode 01, ep01, E01
    /S\d+E0*(\d+)/i,                    // S01E05
    /[\s_\-]0*(\d{1,3})[\s_\-\.]/,     // " - 01.", "_01.", " 01 "
    /^0*(\d{1,3})$/,                    // "01", "001"
  ];
  for (const re of patterns) {
    const m = bare.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

router.get("/scan", (_req, res) => {
  if (!MEDIA_DIR) return res.json([]);

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(MEDIA_DIR);
  } catch {
    return res.json([]);
  }

  const results: Array<{ title: string; episodes: Array<{ number: number | null; file: string; encoded: string }> }> = [];

  for (const entry of entries) {
    const fullEntry = path.join(MEDIA_DIR, entry);
    const stat = fs.statSync(fullEntry);

    if (stat.isDirectory()) {
      // folder = series title; files inside = episodes
      const files = fs.readdirSync(fullEntry).filter(isVideo).sort();
      if (files.length === 0) continue;
      results.push({
        title: entry,
        episodes: files.map((f) => ({
          number: epNum(f),
          file: f,
          encoded: Buffer.from(path.join(fullEntry, f)).toString("base64"),
        })),
      });
    } else if (isVideo(entry)) {
      // top-level file = movie/single episode
      results.push({
        title: path.basename(entry, path.extname(entry)),
        episodes: [{ number: 1, file: entry, encoded: Buffer.from(fullEntry).toString("base64") }],
      });
    }
  }

  return res.json(results);
});

router.get("/stream", (req, res) => {
  const encoded = req.query.file as string;
  if (!encoded) return res.status(400).json({ error: "Missing file param" });

  let filePath: string;
  try {
    filePath = Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return res.status(400).json({ error: "Invalid file param" });
  }

  // Security: must be under MEDIA_DIR if configured
  if (MEDIA_DIR && !filePath.startsWith(path.resolve(MEDIA_DIR))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
  };
  const mime = mimeTypes[ext] ?? "video/mp4";

  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

export default router;
