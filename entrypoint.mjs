// entrypoint.mjs — SDK connector for copilot-kaizen
// This is the file loaded by the trampoline. It imports the handlers
// and wires them to the Copilot SDK. Separated from extension.mjs so
// tests can import handlers without triggering joinSession().

import {
  onSessionStart,
  onPreToolUse,
  onPostToolUse,
  onErrorOccurred,
  onShutdown,
  TOOL_DEFINITIONS,
} from './extension.mjs'

try {
  const { joinSession } = await import('@github/copilot-sdk/extension')

  const session = await joinSession({
    hooks: {
      onSessionStart,
      onPreToolUse,
      onPostToolUse,
      onErrorOccurred,
    },
    tools: TOOL_DEFINITIONS,
  })

  session.on('session.shutdown', (event) => {
    onShutdown(event?.data ?? event)
  })
} catch {
  // Extension load failure must not crash the CLI
}
