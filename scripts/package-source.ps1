param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$qiliRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path (Split-Path -Parent $qiliRoot) 'deliverables'
}
$qiliOutput = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($qiliOutput) | Out-Null
$qiliNow = [DateTimeOffset]::UtcNow
$qiliChinaTime = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($qiliNow, 'China Standard Time')
$qiliStamp = $qiliChinaTime.ToString('yyyyMMdd-HHmmss')
$qiliZip = Join-Path $qiliOutput "qili-study-source-$qiliStamp.zip"
if (Test-Path -LiteralPath $qiliZip) { throw 'Output already exists; retry with a different timestamp.' }
$qiliTemp = Join-Path ([IO.Path]::GetTempPath()) ('qili-source-' + [guid]::NewGuid().ToString('N'))
$qiliStage = Join-Path $qiliTemp 'qili-study'
[IO.Directory]::CreateDirectory($qiliStage) | Out-Null

# Explicit allowlist: never recursively copy the whole working directory.
$qiliRootFiles = @('README.md','SUBMISSION.md','TESTING.md','package.json','server.js','start.ps1','LICENSE','THIRD_PARTY.md','.env.example','.gitignore')
$qiliFiles = @($qiliRootFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $qiliRoot $_) })
$qiliFiles += @(Get-ChildItem -LiteralPath $qiliRoot -File -Filter '*.cmd')
foreach ($qiliDirectory in @('public','src','tests','scripts','docs','engine')) {
    $qiliFiles += @(Get-ChildItem -LiteralPath (Join-Path $qiliRoot $qiliDirectory) -Recurse -File)
}
$qiliManifest = @()
foreach ($qiliFile in $qiliFiles) {
    $qiliRelative = $qiliFile.FullName.Substring($qiliRoot.Length + 1).Replace('\','/')
    if ($qiliRelative -eq 'engine/pikafish.nnue') { continue }
    if ($qiliFile.Name -eq '.env' -or ($qiliFile.Name -like '.env.*' -and $qiliFile.Name -ne '.env.example') -or $qiliFile.Extension -in @('.log','.tmp','.bak')) { continue }
    if ($qiliFile.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked file: $qiliRelative" }
    $qiliDestination = Join-Path $qiliStage $qiliRelative
    [IO.Directory]::CreateDirectory((Split-Path -Parent $qiliDestination)) | Out-Null
    Copy-Item -LiteralPath $qiliFile.FullName -Destination $qiliDestination
    $qiliManifest += [ordered]@{ path=$qiliRelative; bytes=$qiliFile.Length; sha256=(Get-FileHash -LiteralPath $qiliDestination -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$qiliVersion = (Get-Content -LiteralPath (Join-Path $qiliRoot 'package.json') -Raw | ConvertFrom-Json).version
$qiliMetadata = [ordered]@{ application='qili-study'; version=$qiliVersion; createdAt=$qiliNow.ToString('o'); archiveTimeZone='Asia/Shanghai'; excluded=@('.env','personal learning records','evidence','logs','generated engine/pikafish.nnue'); files=$qiliManifest }
[IO.File]::WriteAllText((Join-Path $qiliStage 'SOURCE-MANIFEST.json'), ($qiliMetadata | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($qiliTemp, $qiliZip, [IO.Compression.CompressionLevel]::Optimal, $false, [Text.Encoding]::UTF8)
[pscustomobject]@{ Archive=$qiliZip; Files=$qiliManifest.Count; Bytes=(Get-Item -LiteralPath $qiliZip).Length; SHA256=(Get-FileHash -LiteralPath $qiliZip -Algorithm SHA256).Hash.ToLowerInvariant(); Staging=$qiliStage }
