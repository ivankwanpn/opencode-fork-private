import { Agent, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici"

type Environment = Record<string, string | undefined>

export function applyGlobalProxy(env: Environment, warn: (error: unknown) => void) {
  try {
    const allProxy = env.all_proxy ?? env.ALL_PROXY
    const httpProxy = env.http_proxy ?? env.HTTP_PROXY ?? allProxy
    const httpsProxy = env.https_proxy ?? env.HTTPS_PROXY ?? allProxy
    const next =
      httpProxy || httpsProxy
        ? new EnvHttpProxyAgent({
            httpProxy,
            httpsProxy,
            noProxy: env.no_proxy ?? env.NO_PROXY ?? "",
          })
        : new Agent()
    const previous = getGlobalDispatcher()

    setGlobalDispatcher(next)
    if (previous === next) return
    void previous.close().catch(warn)
  } catch (error) {
    warn(error)
  }
}
