const outdir = process.argv[2]
const worker = process.argv[3]

if (!outdir || !worker) throw new Error("Expected output directory and worker entrypoint")

const build = await Bun.build({
  entrypoints: [worker],
  format: "esm",
  target: "node",
  splitting: true,
  outdir,
  naming: {
    entry: "shell-command-runtime.mjs",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
})

process.stdout.write(
  JSON.stringify({
    success: build.success,
    outputs: build.outputs.map((output) => output.path),
  }),
)
