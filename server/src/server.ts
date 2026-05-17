import "dotenv/config";
import express from "express";
import cors from "cors";
import mediaRouter from "./routes/media.js";
import streamRouter from "./routes/stream.js";
import tvRouter from "./routes/tv.js";
import libraryRouter from "./routes/library.js";
import localRouter from "./routes/local.js";
import proxyRouter from "./routes/proxy.js";
import torrentRouter from "./routes/torrent.js";
import servicesRouter from "./routes/services.js";
const app = express();
const PORT = process.env.PORT ?? 3001;
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const NETWORK_URL = process.env.NETWORK_URL;

const allowedOrigins = [CLIENT_URL, "http://localhost:5173", "http://localhost:3002"];
if (NETWORK_URL) allowedOrigins.push(NETWORK_URL);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", ts: Date.now() });
});

app.use("/api/media", mediaRouter);
app.use("/api/media", streamRouter);
app.use("/api/tv", tvRouter);
app.use("/api/library", libraryRouter);
app.use("/api/local", localRouter);
app.use("/api/proxy", proxyRouter);
app.use("/api/torrent", torrentRouter);
app.use("/api/services", servicesRouter);

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`Kuro server running on http://0.0.0.0:${PORT}`);
});

export default app;
