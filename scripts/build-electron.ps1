$ErrorActionPreference = 'Stop'

Write-Host '[1/6] Instalando empacotador Electron temporariamente...'
npm install --no-save --package-lock=false electron-builder@26.15.3
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar electron-builder.' }

Write-Host '[2/6] Lint...'
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint falhou.' }

Write-Host '[3/6] Testes...'
npm test
if ($LASTEXITCODE -ne 0) { throw 'Testes falharam.' }

Write-Host '[4/6] Build web/backend...'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }

Write-Host '[5/6] E2E...'
npm run test:e2e
if ($LASTEXITCODE -ne 0) { throw 'E2E falhou.' }

Write-Host '[6/6] Gerando instalador Electron Windows x64...'
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
