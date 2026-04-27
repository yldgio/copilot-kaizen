#!/usr/bin/env bash
# Optional: install recommended Copilot CLI plugins.
# Requires authentication first: copilot → /login
# Run manually after container creation: bash .devcontainer/scripts/install-plugins.sh
set -euo pipefail

echo "  › Installing Copilot CLI plugins..."
echo "  (make sure you have run 'copilot' → '/login' first)"
echo ""
copilot plugin marketplace add microsoft/azure-skills
copilot plugin marketplace add github/awesome-copilot
copilot plugin marketplace add microsoft/work-iq
copilot plugin marketplace list

echo "to browse plugins in the installed marketplace, from the copilot TUI run: copilot → /plugins → Browse Marketplace"
echo "from the command line, type: copilot plugin marketplace browse MARKETPLACE-NAME"
echo "to install a plugin from the marketplace, from the copilot TUI run: copilot → /plugins install PLUGIN-NAME"
echo "example: '/plugin install azure@azure-skills' or '/plugin install workiq@work-iq'"


echo ""
echo "✅ Plugins installed."
echo "   Run 'copilot' and '/plugins' to verify."
