import type { Argv } from "yargs"
import { Auth } from "../../auth"
import { cmd } from "./cmd"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import * as Prompt from "../effect/prompt"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { Integration } from "@opencode-ai/core/integration"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"

import { map, pipe, sortBy, values } from "remeda"
import os from "os"
import { Config } from "@/config/config"
import { Plugin } from "../../plugin"
import { Process } from "@/util/process"
import { errorMessage } from "@/util/error"
import { text } from "node:stream/consumers"
import { Cause, Effect, Option, Schedule } from "effect"
import { Location } from "@opencode-ai/core/location"
import { locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { discover } from "@/provider/custom-provider/discovery"
import { make as makeCustomProvider } from "@/provider/custom-provider/service"
import { liveWizardIO, runProviderConfigureWizard } from "./provider-configure"

const promptValue = <Value>(value: Option.Option<Value>) => {
  if (Option.isNone(value)) return Effect.die(new UI.CancelledError())
  return Effect.succeed(value.value)
}

const cliTry = <Value>(message: string, fn: () => PromiseLike<Value>) =>
  Effect.tryPromise({
    try: fn,
    catch: (error) => new CliError({ message: message + errorMessage(error) }),
  })

const authorization = <Value, Requirements>(effect: Effect.Effect<Value, Integration.Error, Requirements>) =>
  effect.pipe(
    Effect.mapError((failure) => {
      if (failure instanceof Integration.CodeRequiredError) {
        return new CliError({ message: "Failed to authorize: authorization code required" })
      }
      const cause = Cause.isCause(failure.cause) ? Cause.squash(failure.cause) : failure.cause
      return new CliError({ message: "Failed to authorize: " + errorMessage(cause) })
    }),
  )

const handleIntegrationAuth = Effect.fn("Cli.providers.integrationAuth")(function* (
  integrations: Integration.Interface,
  integration: Integration.Info,
  methodName?: string,
) {
  const methods = integration.methods.filter((method) => method.type !== "env")
  if (methods.length === 0) return false
  const index = yield* Effect.gen(function* () {
    if (!methodName) {
      if (methods.length <= 1) return 0
      return yield* promptValue(
        yield* Prompt.select({
          message: "Login method",
          options: methods.map((method, index) => ({
            label: method.label ?? "API key",
            value: index,
          })),
        }),
      )
    }
    const match = methods.findIndex((method) => (method.label ?? "API key").toLowerCase() === methodName.toLowerCase())
    if (match === -1) {
      return yield* fail(
        `Unknown method "${methodName}" for ${integration.id}. Available: ${methods.map((method) => method.label ?? "API key").join(", ")}`,
      )
    }
    return match
  })
  const method = methods[index]

  yield* Effect.sleep("10 millis")
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    for (const prompt of method.prompts) {
      if (prompt.when) {
        const value = inputs[prompt.when.key]
        if (value === undefined) continue
        const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
        if (!matches) continue
      }
      if (prompt.type === "select") {
        const value = yield* Prompt.select({
          message: prompt.message,
          options: prompt.options.map((option) => ({ ...option })),
        })
        inputs[prompt.key] = yield* promptValue(value)
        continue
      }
      const value = yield* Prompt.text({
        message: prompt.message,
        placeholder: prompt.placeholder,
      })
      inputs[prompt.key] = yield* promptValue(value)
    }
  }

  if (method.type === "oauth") {
    const attempt = yield* authorization(
      integrations.connection.oauth({ integrationID: integration.id, methodID: method.id, inputs }),
    )
    yield* Prompt.log.info("Go to: " + attempt.url)
    if (attempt.instructions) yield* Prompt.log.info(attempt.instructions)
    const spinner = attempt.mode === "auto" ? Prompt.spinner() : undefined
    if (spinner) yield* spinner.start("Waiting for authorization...")
    if (attempt.mode === "code") {
      const code = yield* Prompt.text({
        message: "Paste the authorization code here: ",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      yield* authorization(
        integrations.attempt.complete({ attemptID: attempt.attemptID, code: yield* promptValue(code) }),
      )
    }
    const status = yield* integrations.attempt.status(attempt.attemptID).pipe(
      Effect.repeat({
        schedule: Schedule.spaced("250 millis"),
        while: (current) => current.status === "pending",
      }),
    )
    if (status.status !== "complete") {
      if (spinner) yield* spinner.stop("Failed to authorize", 1)
      return yield* fail(status.status === "failed" ? status.message : "Authorization expired")
    }
    if (spinner) yield* spinner.stop("Login successful")
    if (!spinner) yield* Prompt.log.success("Login successful")
    yield* Prompt.outro("Done")
    return true
  }

  if (method.type === "key") {
    const key = yield* Prompt.password({
      message: "Enter your API key",
      validate: (x) => (x && x.length > 0 ? undefined : "Required"),
    })
    const apiKey = yield* promptValue(key)
    yield* authorization(
      integrations.connection.key({ integrationID: integration.id, key: apiKey, inputs }),
    )
    yield* Prompt.log.success("Login successful")
    yield* Prompt.outro("Done")
    return true
  }

  return false
})

export function resolvePluginProviders(input: {
  integrations: readonly Integration.Info[]
  existingProviders: Record<string, unknown>
  disabled: Set<string>
  enabled?: Set<string>
  providerNames: Record<string, string | undefined>
}): Array<{ id: string; name: string }> {
  const seen = new Set<string>()
  const result: Array<{ id: string; name: string }> = []

  for (const integration of input.integrations) {
    if (!integration.methods.some((method) => method.type !== "env")) continue
    const id = integration.id
    if (seen.has(id)) continue
    seen.add(id)
    if (Object.hasOwn(input.existingProviders, id)) continue
    if (input.disabled.has(id)) continue
    if (input.enabled && !input.enabled.has(id)) continue
    result.push({
      id,
      name: input.providerNames[id] ?? integration.name,
    })
  }

  return result
}

export const ProvidersCommand = cmd({
  command: "providers",
  aliases: ["auth"],
  describe: "manage AI providers and credentials",
  builder: (yargs) =>
    yargs
      .command(ProvidersListCommand)
      .command(ProvidersLoginCommand)
      .command(ProvidersLogoutCommand)
      .command(ProvidersConfigureCommand)
      .demandCommand(),
  async handler() {},
})

export const ProvidersConfigureCommand = effectCmd({
  command: "configure [id]",
  describe: "configure a custom AI provider",
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "custom provider id",
      type: "string",
    }),
  handler: Effect.fn("Cli.providers.configure")(function* (args) {
    yield* Effect.gen(function* () {
      const customProvider = yield* makeCustomProvider
      yield* runProviderConfigureWizard({
        id: args.id,
        io: liveWizardIO,
        discover,
        configure: (input) =>
          customProvider.configure(
            input,
            Location.Ref.make({
              directory: AbsolutePath.make(process.cwd()),
            }),
          ),
      })
    }).pipe(Effect.provide(locationServiceMapLayer))
  }),
})

export const ProvidersListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers and credentials",
  // Lists global credentials + provider env vars; no project instance needed.
  instance: false,
  handler: Effect.fn("Cli.providers.list")(function* (_args) {
    const credentials = yield* Credential.Service
    const modelsDev = yield* ModelsDev.Service

    UI.empty()
    const authPath = Database.path()
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    yield* Prompt.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = yield* credentials.all()
    const database = yield* modelsDev.get()

    for (const result of results) {
      const name = database[result.integrationID]?.name || result.integrationID
      yield* Prompt.log.info(`${name} ${UI.Style.TEXT_DIM}${result.value.type}`)
    }

    yield* Prompt.outro(`${results.length} credentials`)

    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      yield* Prompt.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        yield* Prompt.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      yield* Prompt.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  }),
})

export const ProvidersLoginCommand = effectCmd({
  command: "login [url]",
  describe: "log in to a provider",
  // URL login skips instance bootstrap, which would load remote config with the stale token and crash before re-auth.
  instance: (args) => !args.url,
  builder: (yargs: Argv) =>
    yargs
      .positional("url", {
        describe: "opencode auth provider",
        type: "string",
      })
      .option("provider", {
        alias: ["p"],
        describe: "provider id or name to log in to (skips provider selection)",
        type: "string",
      })
      .option("method", {
        alias: ["m"],
        describe: "login method label (skips method selection)",
        type: "string",
      }),
  handler: Effect.fn("Cli.providers.login")(function* (args) {
    UI.empty()
    yield* Prompt.intro("Add credential")
    if (args.url) {
      const auth = yield* Auth.Service
      const url = args.url.replace(/\/+$/, "")
      const wellknown = (yield* cliTry(`Failed to load auth provider metadata from ${url}: `, () =>
        fetch(`${url}/.well-known/opencode`).then((x) => x.json()),
      )) as {
        auth: { command: string[]; env: string }
      }
      yield* Prompt.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
      const abort = new AbortController()
      const proc = Process.spawn(wellknown.auth.command, { stdout: "pipe", stderr: "inherit", abort: abort.signal })
      if (!proc.stdout) {
        yield* Prompt.log.error("Failed")
        yield* Prompt.outro("Done")
        return
      }
      const [exit, token] = yield* cliTry("Failed to run auth provider command: ", () =>
        Promise.all([proc.exited, text(proc.stdout!)]),
      ).pipe(Effect.ensuring(Effect.sync(() => abort.abort())))
      if (exit !== 0) {
        yield* Prompt.log.error("Failed")
        yield* Prompt.outro("Done")
        return
      }
      yield* Effect.orDie(auth.set(url, { type: "wellknown", key: wellknown.auth.env, token: token.trim() }))
      yield* Prompt.log.success("Logged into " + url)
      yield* Prompt.outro("Done")
      return
    }

    const cfgSvc = yield* Config.Service
    const pluginSvc = yield* Plugin.Service
    const locations = yield* LocationServiceMap.Service
    const modelsDev = yield* ModelsDev.Service
    yield* Effect.ignore(modelsDev.refresh(true))
    yield* pluginSvc.init()

    const instance = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    const services = locations.get(
      Location.Ref.make({
        directory: AbsolutePath.make(instance.directory),
        ...(workspaceID === undefined ? {} : { workspaceID }),
      }),
    )

    const config = yield* cfgSvc.get()

    const disabled = new Set(config.disabled_providers ?? [])
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

    const allProviders = yield* modelsDev.get()
    const providers: Record<string, (typeof allProviders)[string]> = {}
    for (const [key, value] of Object.entries(allProviders)) {
      if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) providers[key] = value
    }
    const integrations = yield* Integration.Service.use((service) => service.list()).pipe(Effect.provide(services))

    const priority: Record<string, number> = {
      opencode: 0,
      openai: 1,
      "github-copilot": 2,
      google: 3,
      anthropic: 4,
      openrouter: 5,
      vercel: 6,
    }
    const pluginProviders = resolvePluginProviders({
      integrations,
      existingProviders: providers,
      disabled,
      enabled,
      providerNames: Object.fromEntries(Object.entries(config.provider ?? {}).map(([id, p]) => [id, p.name])),
    })
    const options = [
      ...pipe(
        providers,
        values(),
        sortBy(
          (x) => priority[x.id] ?? 99,
          (x) => x.name ?? x.id,
        ),
        map((x) => ({
          label: x.name,
          value: x.id,
          hint: {
            opencode: "recommended",
            openai: "ChatGPT Plus/Pro or API key",
          }[x.id],
        })),
      ),
      ...pluginProviders.map((x) => ({
        label: x.name,
        value: x.id,
        hint: "plugin",
      })),
    ]

    let provider: string
    if (args.provider) {
      const input = args.provider
      const byID = options.find((x) => x.value === input)
      const byName = options.find((x) => x.label.toLowerCase() === input.toLowerCase())
      const match = byID ?? byName
      if (!match) {
        return yield* fail(`Unknown provider "${input}"`)
      }
      provider = match.value
    } else {
      provider = yield* promptValue(
        yield* Prompt.autocomplete({
          message: "Select provider",
          maxItems: 8,
          options: [...options, { value: "other", label: "Other" }],
        }),
      )
    }

    const handled = yield* Integration.Service.use((service) =>
      service.get(Integration.ID.make(provider)).pipe(
        Effect.flatMap((integration) =>
          integration ? handleIntegrationAuth(service, integration, args.method) : Effect.succeed(false),
        ),
      ),
    ).pipe(Effect.provide(services))
    if (handled) return

    if (provider === "other") {
      provider = (yield* promptValue(
        yield* Prompt.text({
          message: "Enter provider id",
          validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
        }),
      )).replace(/^@ai-sdk\//, "")

      const customHandled = yield* Integration.Service.use((service) =>
        service.get(Integration.ID.make(provider)).pipe(
          Effect.flatMap((integration) =>
            integration ? handleIntegrationAuth(service, integration, args.method) : Effect.succeed(false),
          ),
        ),
      ).pipe(Effect.provide(services))
      if (customHandled) return

      yield* Prompt.log.warn(
        `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
      )
    }

    if (provider === "amazon-bedrock") {
      yield* Prompt.log.info(
        "Amazon Bedrock authentication priority:\n" +
          "  1. Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)\n" +
          "  2. AWS credential chain (profile, access keys, IAM roles, EKS IRSA)\n\n" +
          "Configure via opencode.json options (profile, region, endpoint) or\n" +
          "AWS environment variables (AWS_PROFILE, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_WEB_IDENTITY_TOKEN_FILE).",
      )
    }

    if (provider === "opencode") {
      yield* Prompt.log.info("Create an api key at https://opencode.ai/auth")
    }

    if (provider === "vercel") {
      yield* Prompt.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
    }

    if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
      yield* Prompt.log.info(
        "Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables. Read more: https://opencode.ai/docs/providers/#cloudflare-ai-gateway",
      )
    }

    const key = yield* Prompt.password({
      message: "Enter your API key",
      validate: (x) => (x && x.length > 0 ? undefined : "Required"),
    })
    const apiKey = yield* promptValue(key)
    yield* Integration.Service.use((service) =>
      authorization(service.connection.key({ integrationID: Integration.ID.make(provider), key: apiKey })),
    ).pipe(Effect.provide(services))

    yield* Prompt.outro("Done")
  }),
})

export const ProvidersLogoutCommand = effectCmd({
  command: "logout [provider]",
  describe: "log out from a configured provider",
  builder: (yargs) =>
    yargs.positional("provider", {
      describe: "provider id or name to log out from",
      type: "string",
    }),
  // Removes a global auth credential; no project instance needed.
  instance: false,
  handler: Effect.fn("Cli.providers.logout")(function* (args) {
    const credential = yield* Credential.Service
    const modelsDev = yield* ModelsDev.Service

    UI.empty()
    const credentials = yield* credential.all()
    yield* Prompt.intro("Remove credential")
    if (credentials.length === 0) {
      yield* Prompt.log.error("No credentials found")
      return
    }
    const database = yield* modelsDev.get()
    const options = credentials.map((item) => ({
      label:
        (database[item.integrationID]?.name || item.integrationID) +
        UI.Style.TEXT_DIM +
        " (" +
        item.value.type +
        ")",
      value: item.id,
      providerID: item.integrationID,
    }))
    const provider = args.provider
      ? options.find(
          (option) =>
            option.providerID === args.provider ||
            database[option.providerID]?.name?.toLowerCase() === args.provider?.toLowerCase(),
        )?.value
      : yield* promptValue(
          yield* Prompt.autocomplete({
            message: "Select provider",
            maxItems: 8,
            options,
          }),
        )
    if (!provider) return yield* fail(`Unknown configured provider "${args.provider}"`)
    yield* credential.remove(provider)
    yield* Prompt.outro("Logout successful")
  }),
})
