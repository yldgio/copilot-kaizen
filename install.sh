#!/usr/bin/env bash
# install.sh — copilot-kaizen one-liner installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yldgio/copilot-kaizen/main/install.sh | bash
#
# Installs copilot-kaizen globally from GitHub, then sets up kaizen in the
# current directory (if it is a git repository).

set -euo pipefail

REPO="yldgio/copilot-kaizen"

echo ""
echo "🔧 copilot-kaizen installer"
echo ""

# ---- Check Node.js -------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js not found."
  echo "   Install Node.js 18+: https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js 18+ required (found $(node --version))"
  exit 1
fi

echo "   Node.js $(node --version) ✓"

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm not found."
  echo "   Install npm: https://docs.npmjs.com/downloading-and-installing-node-js-and-npm"
  exit 1
fi

# ---- Install globally ----------------------------------------------------

echo "   Installing copilot-kaizen..."
npm install -g "github:${REPO}"
echo "   ✅ kaizen installed"
echo ""

# ---- Set up current project (if in a git repo) ---------------------------

if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "   Setting up kaizen in current project..."
  kaizen install .
else
  echo "   Not in a git repository. To set up kaizen in a project:"
  echo "     cd your-project && kaizen install ."
fi
