import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "@opencode-ai/app/vite"
import * as fs from "node:fs/promises"
import path from "node:path"
import { resolveChannel } from "../script/src/channel"

const OPENCODE_SERVER_DIST = "../opencode/dist/node"

const channel = resolveChannel()
const desktopServerProtocol = process.env.VITE_OPENCODE_DESKTOP_SERVER_PROTOCOL ?? "auto"

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
        // Keep this identical to electron-vite's Node 20.11+ shim. Its regex insertion can
        // corrupt bundled TypeScript, while a Rollup banner places the shim safely.
        output: {
          banner: `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`,
        },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "opencode:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:opencode-server") return "\0opencode-server-engine"
          // Treat the copied engine file as external so rollup keeps the
          // runtime `import` as-is instead of re-bundling the 32 MB engine.
          if (id === "./opencode-server.js") return { id, external: true }
        },
        // Keep the engine bundle out of the main-process rollup graph: it is a
        // self-contained ESM bundle built by `build-node.ts` (~32 MB), so
        // re-bundling it here costs tens of seconds every build. Emit a tiny
        // virtual module that re-exports the engine from its copied location at
        // runtime instead of inlining it. The engine file is treated as external
        // so rollup keeps the runtime `import` as-is.
        load(id) {
          if (id !== "\0opencode-server-engine") return
          // The virtual module is emitted into out/main/chunks/, alongside the
          // copied engine file, so reference it by its sibling basename.
          return `export * from "./opencode-server.js"`
        },
      },
      {
        name: "opencode:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(OPENCODE_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${OPENCODE_SERVER_DIST}/${l}`))
          }
          // Copy the engine bundle alongside its wasm assets so the virtual
          // re-export above can load it at runtime.
          await fs.writeFile(`./out/main/chunks/opencode-server.js`, await fs.readFile(`${OPENCODE_SERVER_DIST}/node.js`))
          // The engine keeps `jsonc-parser` external (build-node.ts externalizes
          // it), so make it resolvable from the packaged app: copy it into a
          // top-level node_modules next to out/. Node's module resolution walks
          // up from the engine file (out/main/chunks/) to find it.
          const jsoncDir = path.resolve("..", "opencode", "node_modules", "jsonc-parser")
          const jsoncOut = "./out/node_modules/jsonc-parser"
          const copyDir = async (from: string, to: string) => {
            await fs.mkdir(to, { recursive: true })
            for (const l of await fs.readdir(from)) {
              if (l === ".package-lock.json") continue
              const src = path.join(from, l)
              const stat = await fs.stat(src)
              if (stat.isDirectory()) await copyDir(src, path.join(to, l))
              else await fs.writeFile(path.join(to, l), await fs.readFile(src))
            }
          }
          await copyDir(jsoncDir, jsoncOut)
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
      "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
      "import.meta.env.VITE_OPENCODE_DESKTOP_SERVER_PROTOCOL": JSON.stringify(desktopServerProtocol),
    },
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
