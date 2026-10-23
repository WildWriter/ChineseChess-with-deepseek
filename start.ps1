$ErrorActionPreference = 'Stop'
$qiliRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $qiliRoot
$qiliNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $qiliNode) {
    $qiliBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $qiliBundledNode) { $qiliNodePath = $qiliBundledNode }
    else { throw '请安装 Node.js 22.9 或更新版本，然后重新启动。' }
} else { $qiliNodePath = $qiliNode.Source }
if (-not (Test-Path -LiteralPath '.\engine\pikafish.nnue')) {
    & $qiliNodePath scripts/prepare-engine.js
    if ($LASTEXITCODE -ne 0) { Write-Host '引擎尚未就绪，仍可使用基础练习与教案。' }
}
Write-Host '打开 http://127.0.0.1:8787，按 Ctrl+C 停止服务。'
& $qiliNodePath --env-file-if-exists=.env server.js
