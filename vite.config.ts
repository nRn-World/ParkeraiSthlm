import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function writeProxyResponse(response: Response, res: import("node:http").ServerResponse) {
  res.statusCode = response.status;
  res.setHeader("Content-Type", response.headers.get("content-type") ?? "application/json; charset=utf-8");
  return response.arrayBuffer().then((body) => res.end(Buffer.from(body)));
}

function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function localDataProxy(env: Record<string, string>) {
  return {
    name: "local-parking-data-proxy",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/stockholm-parking", async (_req, res) => {
        try {
          await writeProxyResponse(await fetchWithTimeout("https://api.stockholmparkering.se:8084/SparkInfartsParkeringService.svc/GetAllAnlaggningParkeringsInfo", {
            headers: { Accept: "application/json", "User-Agent": "Parkera-i-Stockholm-local" },
          }, 15_000), res);
        } catch {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: "Stockholm Parkering kunde inte nås" }));
        }
      });

      server.middlewares.use("/api/open-charge-map", async (_req, res) => {
        const key = env.OCM_API_KEY;
        if (!key) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "OCM_API_KEY saknas i .env.local" }));
          return;
        }
        const params = new URLSearchParams({
          output: "json", countrycode: "SE", latitude: "59.3293", longitude: "18.0686",
          distance: "35", distanceunit: "KM", maxresults: "5000", compact: "true", verbose: "false", key,
        });
        try {
          await writeProxyResponse(await fetchWithTimeout(`https://api.openchargemap.io/v3/poi/?${params}`, {
            headers: { "User-Agent": "Parkera-i-Stockholm-local" },
          }), res);
        } catch {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: "Open Charge Map kunde inte nås" }));
        }
      });

      server.middlewares.use("/api/nobil", async (_req, res) => {
        const key = env.NOBIL_API_KEY;
        if (!key) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "NOBIL_API_KEY saknas i .env.local" }));
          return;
        }
        const body = new URLSearchParams({
          apikey: key, apiversion: "3", action: "search", type: "rectangle", format: "json", limit: "3000",
          northeast: "(59.4294,18.2466)", southwest: "(59.2300,17.7633)",
        });
        try {
          await writeProxyResponse(await fetchWithTimeout("https://nobil.no/api/server/search.php", {
            method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
          }), res);
        } catch {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: "NOBIL kunde inte nås" }));
        }
      });

      server.middlewares.use("/api/stockholm-open-data", async (req, res) => {
        const key = env.STOCKHOLM_OPEN_DATA_API_KEY;
        const requestUrl = new URL(req.url ?? "/", "http://localhost");
        const rule = requestUrl.pathname.replace(/^\/+/, "");
        const allowedRules = new Set(["pmotorcykel", "prorelsehindrad", "ptillaten"]);
        if (!allowedRules.has(rule)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Okänd föreskrift" }));
          return;
        }
        if (!key) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "STOCKHOLM_OPEN_DATA_API_KEY saknas i .env.local" }));
          return;
        }
        const lat = Number(requestUrl.searchParams.get("lat"));
        const lng = Number(requestUrl.searchParams.get("lng"));
        const fetchAll = requestUrl.searchParams.get("all") === "true";
        const radius = Math.min(Math.max(Number(requestUrl.searchParams.get("radius")) || 1150, 50), 5_000);
        if (!fetchAll && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Giltiga koordinater krävs för områdessökning" }));
          return;
        }
        const params = new URLSearchParams({
          outputFormat: "json",
          apiKey: key,
          maxFeatures: fetchAll ? "25000" : "3000",
        });
        if (!fetchAll) {
          params.set("lat", String(lat));
          params.set("lng", String(lng));
          params.set("radius", String(Math.round(radius)));
        }
        try {
          await writeProxyResponse(await fetchWithTimeout(
            `https://openparking.stockholm.se/LTF-Tolken/v1/${rule}/${fetchAll ? "all" : "within"}?${params}`,
            { headers: { Accept: "application/json", "User-Agent": "Parkera-i-Stockholm-local" } },
            60_000,
          ), res);
        } catch {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: "Trafikkontorets öppna data kunde inte nås" }));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: env.VITE_BASE_URL ?? "/",
    plugins: [react(), tailwindcss(), viteSingleFile(), localDataProxy(env)],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
