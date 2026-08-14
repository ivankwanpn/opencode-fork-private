import { transform, type TransformOptions } from "@babel/core"
// @ts-expect-error - babel-preset-solid ships no type declarations
import presetSolid from "babel-preset-solid"
// @ts-expect-error - @babel/preset-typescript ships no type declarations
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

// Capture the real language/platform modules before any test file can mock
// them (see src/test-module-snapshots.ts).
import "./src/test-module-snapshots"

GlobalRegistrator.register()

// bun test compiles TSX with the classic React transform ("React is not
// defined") regardless of tsconfig jsx/jsxImportSource or @jsxImportSource
// pragmas. Reproduce the production pipeline instead: babel-preset-solid, the
// same transform vite-plugin-solid applies in the app build. This preload only
// affects bun test runs in this package.
//
// The *.smoke.tsx tests are designed around the classic transform: they shim
// a global React.createElement and call components as plain functions to make
// JSX evaluate eagerly. Their unmocked component graph (dialog-oauth-provider,
// settings-providers, settings-v2/providers) must keep the classic transform
// for those tests to record the translated keys they assert on.
const smokeGraphExcluded = /^(?!.*(?:\.smoke\.tsx$|dialog-oauth-provider\.tsx$|settings-providers\.tsx$|settings-v2\/providers\.tsx$)).*\.tsx$/
Bun.plugin({
  name: "app-solid-jsx",
  setup(build) {
    build.onLoad({ filter: smokeGraphExcluded }, async (args) => {
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
