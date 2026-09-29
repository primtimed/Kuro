import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
// Vite only loads client/.env; read the root .env so NETWORK_URL is available here too.
var rootEnvPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(rootEnvPath)) {
    for (var _i = 0, _a = fs.readFileSync(rootEnvPath, "utf-8").split("\n"); _i < _a.length; _i++) {
        var line = _a[_i];
        var eq = line.indexOf("=");
        if (eq === -1 || line.trimStart().startsWith("#"))
            continue;
        var k = line.slice(0, eq).trim();
        var v = line.slice(eq + 1).trim();
        if (k && !process.env[k])
            process.env[k] = v;
    }
}
var networkUrl = process.env.NETWORK_URL;
var allowedHosts = networkUrl ? [new URL(networkUrl).hostname] : [];
export default defineConfig({
    plugins: [react(), tailwindcss()],
    test: {
        environment: "jsdom",
        globals: true,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        host: "0.0.0.0",
        port: 5173,
        allowedHosts: allowedHosts,
        proxy: {
            "/api": {
                target: "http://localhost:3002",
                changeOrigin: true,
            },
        },
    },
});
