$ErrorActionPreference = 'Stop'

$exe = Get-ChildItem '.\dist-electron\OficinaAgro-Setup-*-Windows-x64.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw 'Instalador final não encontrado para publicação.' }

$stage = Join-Path $env:TEMP 'oficina-agro-circle-artifact'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null

$hash = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$chunkSize = 45MB
$parts = @()
$input = [System.IO.File]::OpenRead($exe.FullName)
try {
  $buffer = New-Object byte[] $chunkSize
  $index = 1
  while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $name = ('part-{0:D3}.bin' -f $index)
    $path = Join-Path $stage $name
    $output = [System.IO.File]::Create($path)
    try { $output.Write($buffer, 0, $read) } finally { $output.Dispose() }
    $parts += [ordered]@{ name = $name; size = $read }
    $index++
  }
} finally {
  $input.Dispose()
}

$manifest = [ordered]@{
  schemaVersion = 1
  sourceCommit = $env:CIRCLE_SHA1
  fileName = $exe.Name
  size = $exe.Length
  sha256 = $hash
  parts = $parts
}
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $stage 'artifact.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Artefato preparado: $($exe.Name)"
Write-Host "SHA256: $hash"
Write-Host "Partes: $($parts.Count)"

# Publica apenas chunks do instalador em uma branch técnica. O workflow ignora esta branch,
# evitando loops de CI. O instalador completo permanece também em store_artifacts do CircleCI.
git config user.name 'CircleCI Release Bot'
git config user.email 'circleci-release@artisys.local'
git remote set-url origin 'git@github.com:nutricionistaalmeidavh-spec/OficinaAgricola.git'
git checkout --orphan circle-artifact-publish
git rm -rf --ignore-unmatch .
git clean -fdx
New-Item -ItemType Directory -Path '.\release' | Out-Null
Copy-Item (Join-Path $stage '*') '.\release' -Force

git add release
git commit -m "artifact: Oficina Agro $env:CIRCLE_SHA1 [skip ci]"
git push --force origin HEAD:circle-artifact
