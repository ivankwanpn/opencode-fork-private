import { describe, expect, test } from "bun:test"
import { OauthCallbackPage } from "../src/oauth/page"

describe("OauthCallbackPage", () => {
  test("escapes provider errors rendered in callback HTML", () => {
    const detail = `<script>alert("xss" & 'more')</script>`
    const html = OauthCallbackPage.error(detail, { provider: "MCP" })

    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;more&#39;)&lt;/script&gt;")
    expect(html).not.toContain(detail)
  })

  test("keeps normal provider errors readable", () => {
    const html = OauthCallbackPage.error("The user denied access", { provider: "MCP" })

    expect(html).toContain('<pre class="detail" id="oc-detail">The user denied access</pre>')
  })

  test("escapes bootstrap options embedded in the inline script", () => {
    const html = OauthCallbackPage.bootstrap({
      provider: `xAI</script><script>alert("provider")</script>`,
      tokenPath: `/token</script><script>alert("path")</script>`,
    })

    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain(`xAI\\u003c/script>\\u003cscript>alert(\\\"provider\\\")\\u003c/script>`)
    expect(html).toContain(`/token\\u003c/script>\\u003cscript>alert(\\\"path\\\")\\u003c/script>`)
  })
})
