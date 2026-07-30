import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { Effect } from "effect"
import { McpAuth } from "./auth"

export const OAUTH_CALLBACK_PORT = 19876
export const OAUTH_CALLBACK_PATH = "/mcp/oauth/callback"

export interface McpOAuthConfig {
  readonly clientId?: string
  readonly clientSecret?: string
  readonly scope?: string
  readonly callbackPort?: number
  readonly redirectUri?: string
}

export interface McpOAuthCallbacks {
  readonly onRedirect: (url: URL) => void | Promise<void>
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    protected readonly mcpName: string,
    protected readonly serverUrl: string,
    protected readonly config: McpOAuthConfig,
    private readonly callbacks: McpOAuthCallbacks,
    protected readonly auth: McpAuth.Interface,
  ) {}

  get redirectUrl(): string {
    if (this.config.redirectUri) return this.config.redirectUri
    const port = this.config.callbackPort ?? OAUTH_CALLBACK_PORT
    return `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "OpenCode",
      client_uri: "https://opencode.ai",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
      ...(this.config.scope ? { scope: this.config.scope } : {}),
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    if (this.config.clientId)
      return {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }

    const entry = await Effect.runPromise(this.auth.getForUrl(this.mcpName, this.serverUrl))
    if (!entry?.clientInfo) return undefined
    if (
      entry.clientInfo.clientSecretExpiresAt &&
      entry.clientInfo.clientSecretExpiresAt < Date.now() / 1_000
    )
      return undefined
    return {
      client_id: entry.clientInfo.clientId,
      client_secret: entry.clientInfo.clientSecret,
    }
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await Effect.runPromise(
      this.auth.updateClientInfo(
        this.mcpName,
        {
          clientId: info.client_id,
          clientSecret: info.client_secret,
          clientIdIssuedAt: info.client_id_issued_at,
          clientSecretExpiresAt: info.client_secret_expires_at,
        },
        this.serverUrl,
      ),
    )
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const entry = await Effect.runPromise(this.auth.getForUrl(this.mcpName, this.serverUrl))
    if (!entry?.tokens) return undefined
    return {
      access_token: entry.tokens.accessToken,
      token_type: "Bearer",
      refresh_token: entry.tokens.refreshToken,
      expires_in: entry.tokens.expiresAt
        ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1_000))
        : undefined,
      scope: entry.tokens.scope,
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await Effect.runPromise(
      this.auth.updateTokens(
        this.mcpName,
        {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_in ? Date.now() / 1_000 + tokens.expires_in : undefined,
          scope: tokens.scope,
        },
        this.serverUrl,
      ),
    )
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.callbacks.onRedirect(authorizationUrl)
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await Effect.runPromise(this.auth.updateCodeVerifier(this.mcpName, codeVerifier))
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await Effect.runPromise(this.auth.get(this.mcpName)))?.codeVerifier
    if (!verifier) throw new Error(`No code verifier saved for MCP server: ${this.mcpName}`)
    return verifier
  }

  async saveState(state: string): Promise<void> {
    await Effect.runPromise(this.auth.updateOAuthState(this.mcpName, state))
  }

  async state(): Promise<string> {
    const current = (await Effect.runPromise(this.auth.get(this.mcpName)))?.oauthState
    if (current) return current
    const state = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
    await Effect.runPromise(this.auth.updateOAuthState(this.mcpName, state))
    return state
  }

  async invalidateCredentials(type: "all" | "client" | "tokens"): Promise<void> {
    const entry = await Effect.runPromise(this.auth.get(this.mcpName))
    if (!entry) return
    switch (type) {
      case "all":
        await Effect.runPromise(this.auth.remove(this.mcpName))
        return
      case "client":
        delete entry.clientInfo
        break
      case "tokens":
        delete entry.tokens
        break
    }
    await Effect.runPromise(this.auth.set(this.mcpName, entry))
  }
}

export class McpOAuthPendingProvider extends McpOAuthProvider {
  private pendingClientInfo?: OAuthClientInformationFull
  private pendingTokens?: OAuthTokens

  override async clientInformation(): Promise<OAuthClientInformation | undefined> {
    if (!this.config.clientId) return this.pendingClientInfo
    return {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    }
  }

  override async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    this.pendingClientInfo = info
  }

  override async tokens(): Promise<OAuthTokens | undefined> {
    return this.pendingTokens
  }

  override async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.pendingTokens = tokens
  }

  override async invalidateCredentials(type: "all" | "client" | "tokens"): Promise<void> {
    if (type === "all" || type === "client") this.pendingClientInfo = undefined
    if (type === "all" || type === "tokens") this.pendingTokens = undefined
  }

  async commit(): Promise<void> {
    if (!this.pendingTokens) return
    await Effect.runPromise(
      this.auth.set(
        this.mcpName,
        {
          tokens: {
            accessToken: this.pendingTokens.access_token,
            refreshToken: this.pendingTokens.refresh_token,
            expiresAt: this.pendingTokens.expires_in
              ? Date.now() / 1_000 + this.pendingTokens.expires_in
              : undefined,
            scope: this.pendingTokens.scope,
          },
          clientInfo:
            this.pendingClientInfo && !this.config.clientId
              ? {
                  clientId: this.pendingClientInfo.client_id,
                  clientSecret: this.pendingClientInfo.client_secret,
                  clientIdIssuedAt: this.pendingClientInfo.client_id_issued_at,
                  clientSecretExpiresAt: this.pendingClientInfo.client_secret_expires_at,
                }
              : undefined,
        },
        this.serverUrl,
      ),
    )
  }
}

export function parseRedirectUri(redirectUri?: string): { port: number; path: string } {
  if (!redirectUri) return { port: OAUTH_CALLBACK_PORT, path: OAUTH_CALLBACK_PATH }
  try {
    const url = new URL(redirectUri)
    const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80
    return { port, path: url.pathname || OAUTH_CALLBACK_PATH }
  } catch {
    return { port: OAUTH_CALLBACK_PORT, path: OAUTH_CALLBACK_PATH }
  }
}
