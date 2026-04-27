# install.ps1 — copilot-kaizen one-liner installer
#
# Usage:
#   irm https://raw.githubusercontent.com/yldgio/copilot-kaizen/main/install.ps1 | iex
#
# Installs copilot-kaizen globally from GitHub, then sets up kaizen in the
# current directory (if it is a git repository).
#
# Wrapped in a scriptblock so that `return` exits cleanly when run via `iex`
# without closing the caller's PowerShell session.

& {
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Write-Host "❌ PowerShell 5.1+ required"
        return
    }

    $Repo = "yldgio/copilot-kaizen"

    Write-Host ""
    Write-Host "🔧 copilot-kaizen installer"
    Write-Host ""

    # ---- Check Node.js ---------------------------------------------------

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Node.js not found."
        Write-Host "   Install Node.js 18+: https://nodejs.org"
        return
    }

    $nodeVersion = node -e "process.stdout.write(process.versions.node)" 2>&1
    $nodeMajor   = [int]($nodeVersion.ToString().Split('.')[0])
    if ($nodeMajor -lt 18) {
        Write-Host "❌ Node.js 18+ required (found v$nodeVersion)"
        return
    }

    Write-Host "   Node.js v$nodeVersion ✓"

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "❌ npm not found."
        Write-Host "   Install npm: https://docs.npmjs.com/downloading-and-installing-node-js-and-npm"
        return
    }

    # ---- Install globally ------------------------------------------------

    Write-Host "   Installing copilot-kaizen..."
    npm install -g "github:$Repo"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Installation failed. See output above."
        return
    }

    Write-Host "   ✅ kaizen installed"
    Write-Host ""

    # ---- Set up current project (if in a git repo) -----------------------

    $inGitRepo = $false
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $null = git rev-parse --git-dir 2>&1
        $inGitRepo = $?
    }

    if ($inGitRepo) {
        Write-Host "   Setting up kaizen in current project..."
        kaizen install .
        if ($LASTEXITCODE -ne 0) {
            Write-Host "⚠️  kaizen install reported an error. Check output above."
        }
    } else {
        Write-Host "   Not in a git repository. To set up kaizen in a project:"
        Write-Host "     cd your-project; kaizen install ."
    }
}
