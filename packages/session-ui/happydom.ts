import { transform, type TransformOptions } from "@babel/core"
// @ts-expect-error - babel-preset-solid ships no type declarations
import presetSolid from "babel-preset-solid"
// @ts-expect-error - @babel/preset-typescript ships no type declarations
import presetTypescript from "@babel/preset-typescript"
import { expect } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

// bun 1.3.14 does not ship expect.poll (it landed later upstream). The remount
// regression test relies on it as the deterministic barrier for the
// asynchronous markdown resource, so provide a faithful polyfill: poll the
// producer until the matcher passes, deadline-bounded (never sleeps the test
// a fixed duration; polls at 20ms).
const pollExpect = (
  producer: () => unknown,
  options?: { timeout?: number; interval?: number },
): Record<string, (...args: unknown[]) => Promise<void>> => {
  const timeout = options?.timeout ?? 3000
  const interval = options?.interval ?? 20
  const run = async (passes: (value: unknown) => boolean) => {
    const deadline = Date.now() + timeout
    let last: unknown
    for (;;) {
      try {
        last = await producer()
        if (passes(last)) return
      } catch {
        // producer is still settling; keep polling until the deadline
      }
      if (Date.now() >= deadline) break
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
    let lastDescription = String(last)
    try {
      lastDescription =
        JSON.stringify(last, (_, value) => (typeof value === "function" ? "[Function]" : value)) ?? "undefined"
    } catch {
      // DOM nodes and cyclic structures cannot be serialized; String(last) above
      // already captured a usable fallback.
    }
    throw new Error(`expect.poll timed out after ${timeout}ms. Last value: ${lastDescription}`)
  }
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  return {
    toBe: (expected: unknown) => run((value) => value === expected),
    toEqual: (expected: unknown) => run((value) => equal(value, expected)),
    toBeTruthy: () => run((value) => !!value),
    toBeFalsy: () => run((value) => !value),
    toBeNull: () => run((value) => value === null),
    toBeUndefined: () => run((value) => value === undefined),
    toContain: (expected: unknown) => run((value) => Array.isArray(value) && value.includes(expected)),
  }
}

// @ts-expect-error - bun:test's expect type has no poll in this version
expect.poll = pollExpect

// bun test cannot resolve Vite-style `?worker&url` imports. message-part.tsx
// (via ./markdown → ./markdown-worker) imports such a URL at module scope, so
// shim it into a static URL string. The worker is never instantiated in unit
// tests — code-block highlighting only runs when markdown contains a fenced
// block, which the fixtures here avoid.
Bun.plugin({
  name: "vite-worker-url-shim",
  setup(build) {
    build.onLoad({ filter: /\?worker&url$/ }, () => ({
      contents: 'export default "markdown-shiki.worker.ts"',
      loader: "js",
    }))
  },
})

// bun test compiles TSX with the classic React transform ("React is not
// defined") regardless of tsconfig jsx/jsxImportSource or @jsxImportSource
// pragmas. Reproduce the production pipeline instead: babel-preset-solid, the
// same transform vite-plugin-solid applies in the app build. This preload only
// affects bun test runs in this package.
Bun.plugin({
  name: "session-ui-solid-jsx",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const contents = await transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [
          [presetTypescript, { isTSX: true, allExtensions: true }],
          [presetSolid, { generate: "dom", hydratable: false }],
        ],
        babelrc: false,
        configFile: false,
      })
      return { contents, loader: "js" }
    })
  },
})

function transformAsync(source: string, options: TransformOptions) {
  return new Promise<string>((resolve, reject) => {
    transform(source, options, (error, result) => {
      if (error) reject(error)
      else resolve(result?.code ?? "")
    })
  })
}

const originalGetContext = HTMLCanvasElement.prototype.getContext
// @ts-expect-error - we're overriding with a simplified mock
HTMLCanvasElement.prototype.getContext = function (contextType: string, _options?: unknown) {
  if (contextType === "2d") {
    return {
      canvas: this,
      fillStyle: "#000000",
      strokeStyle: "#000000",
      font: "12px monospace",
      textAlign: "start",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      imageSmoothingEnabled: true,
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      miterLimit: 10,
      shadowBlur: 0,
      shadowColor: "rgba(0, 0, 0, 0)",
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      fillRect: () => {},
      strokeRect: () => {},
      clearRect: () => {},
      fillText: () => {},
      strokeText: () => {},
      measureText: (text: string) => ({ width: text.length * 8 }),
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      scale: () => {},
      rotate: () => {},
      translate: () => {},
      transform: () => {},
      setTransform: () => {},
      resetTransform: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createPattern: () => null,
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      quadraticCurveTo: () => {},
      arc: () => {},
      arcTo: () => {},
      ellipse: () => {},
      rect: () => {},
      fill: () => {},
      stroke: () => {},
      clip: () => {},
      isPointInPath: () => false,
      isPointInStroke: () => false,
      getTransform: () => ({}),
      getImageData: () => ({
        data: new Uint8ClampedArray(0),
        width: 0,
        height: 0,
      }),
      putImageData: () => {},
      createImageData: () => ({
        data: new Uint8ClampedArray(0),
        width: 0,
        height: 0,
      }),
    } as unknown as CanvasRenderingContext2D
  }
  return originalGetContext.call(this, contextType as "2d", _options)
}
