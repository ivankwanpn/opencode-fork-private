import { readFileSync } from "node:fs"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"
import { resolveChannel } from "../script/src/channel.ts"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

// Matches both Vite entry forms: /oc-theme-preload.js (packages/app) and
// ./oc-theme-preload.js (packages/desktop renderer).
const themePreloadTag = /<script id="oc-theme-preload-script" src="\.?\/oc-theme-preload\.js"><\/script>/

const channel = resolveChannel()






/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        define: {
          "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
          "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        themePreloadTag,
        `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  tailwindcss(),
  solidPlugin(),
]
