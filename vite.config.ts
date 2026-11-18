import path from "path"
import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { viteSingleFile } from "vite-plugin-singlefile"

/**
 * Dev only: serves POST /api/assess and /api/lookup from server/, the same handlers
 * the Vercel functions in api/ use. Reads OPENROUTER_API_KEY etc. from .env.local.
 */
const DEV_ROUTES = {
  "/api/assess": ["/server/assess.ts", "handleAssess", "POST"],
  "/api/lookup": ["/server/lookup.ts", "handleLookup", "POST"],
  "/api/models": ["/server/models.ts", "handleModels", "GET"],
} as const

function devApi(): Plugin {
  return {
    name: "sourcecheck-dev-api",
    apply: "serve",
    configureServer(server) {
      Object.assign(process.env, loadEnv("development", process.cwd(), ""))
      for (const [route, [file, handler, method]] of Object.entries(DEV_ROUTES))
      server.middlewares.use(route, async (req, res) => {
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const request = new Request(`http://${req.headers.host}${req.originalUrl ?? req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
        })
        if (req.method !== method) {
          res.statusCode = 405
          res.end()
          return
        }
        const mod = await server.ssrLoadModule(file)
        const response: Response = await mod[handler](request)
        res.statusCode = response.status
        response.headers.forEach((v, k) => res.setHeader(k, v))
        res.end(Buffer.from(await response.arrayBuffer()))
      })
    },
  }
}

// `npm run build:single` inlines everything into one self-contained index.html
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), devApi(), ...(mode === "single" ? [viteSingleFile()] : [])],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
}))
