param([switch]$Commercial)
$ErrorActionPreference = 'Stop'

Write-Host '[1/8] Instalando empacotador Electron temporariamente...'
npm install --no-save --package-lock=false electron-builder@26.15.3
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar electron-builder.' }

Write-Host '[2/8] Lint...'
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint falhou.' }

Write-Host '[3/8] Testes...'
npm test
if ($LASTEXITCODE -ne 0) { throw 'Testes falharam.' }

Write-Host '[4/8] Build web/backend...'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }

Write-Host '[5/8] E2E...'
npm run test:e2e
if ($LASTEXITCODE -ne 0) { throw 'E2E falhou.' }

Write-Host '[6/8] Compilando ponte de diagnóstico autônoma...'
& (Join-Path $PSScriptRoot 'build-diagnostic-bridge.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Ponte de diagnóstico não foi compilada.' }

Write-Host '[7/8] Preparando PostgreSQL 16 OSS embarcado...'
node scripts/stage-postgres-windows.mjs
if ($LASTEXITCODE -ne 0) { throw 'Bundle PostgreSQL 16 não foi gerado.' }

# A edição comercial só é criada por seleção explícita no builder.
if ($Commercial) {
  node scripts/stage-oficina-edition.mjs --commercial
} else {
  node scripts/stage-oficina-edition.mjs
}
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar manifesto da edição do instalador.' }

Write-Host '[8/8] Gerando instalador Electron Windows x64...'
npx electron-builder --win nsis --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'Empacotamento Electron falhou.' }

$exe = Get-ChildItem '.\dist-electron\ArtiSys-Oficina-Setup-*-Windows-x64.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw 'Instalador final não encontrado.' }

$hash = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash
Write-Host ''
Write-Host '============================================' -ForegroundColor Green
Write-Host 'INSTALADOR ARTISYS OFICINA GERADO' -ForegroundColor Green
Write-Host '============================================' -ForegroundColor Green
Write-Host "Arquivo: $($exe.FullName)"
Write-Host "Tamanho: $([math]::Round($exe.Length / 1MB, 2)) MB"
Write-Host "SHA256: $hash"

if (-not $env:CI) {
  explorer.exe $exe.DirectoryName
}
