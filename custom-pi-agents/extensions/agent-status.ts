import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

function sanitizeAgentName(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\r\n\t\x00-\x1f\x7f]/g, " ")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, 80)
}

export default function (pi: ExtensionAPI) {
  const agentName = sanitizeAgentName(
    process.env.PI_AGENT_PROFILE_NAME || process.env.PI_AGENT_NAME
  )

  if (!agentName) return

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return

    ctx.ui.setStatus("00-agent-profile", `agent:${agentName}`)
    ctx.ui.setTitle(`pi - ${agentName}`)
  })
}
