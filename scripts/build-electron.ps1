$ErrorActionPreference = 'Stop'

Write-Host '[1/10] Instalando empacotador Electron temporariamente...'
npm install --no-save --package-lock=false electron-builder@26.15.3
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar electron-builder.' }

Write-Host '[2/10] Lint...'
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint falhou.' }

Write-Host '[3/10] Testes...'
npm test
if ($LASTEXITCODE -ne 0) { throw 'Testes falharam.' }

Write-Host '[4/10] Build web/backend...'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }

Write-Host '[5/10] E2E...'
npm run test:e2e
if ($LASTEXITCODE -ne 0) { throw 'E2E falhou.' }

Write-Host '[6/10] Gerando executor fiscal standalone (sem Python no cliente)...'
python -m pip install --disable-pip-version-check pyinstaller==6.16.0
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar PyInstaller no builder.' }
python -m PyInstaller --noconfirm --clean --onefile --console --name acbrlib-worker --distpath build/fiscal-worker --workpath build/pyinstaller-tmp --specpath build/pyinstaller-src src/platform/acbrlib-worker.py
if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar worker fiscal.' }

Write-Host '[7/10] Compilando DLLs ACBr NFe/NFSe a partir dos fontes LGPL...'
& "$PSScriptRoot/build-acbr-native.ps1"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar ACBr nativo.' }

Write-Host '[8/10] Validando ABI fiscal e integridade do bundle...'
foreach ($dll in @('ACBrNFe64.dll','ACBrNFSe64.dll')) {
  $probe = & ./build/fiscal-worker/acbrlib-worker.exe --probe "build/fiscal-native/$dll" | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $probe.ok) { throw "Biblioteca ACBr incompatível: $dll" }
}
node scripts/stage-fiscal-bundle.mjs
if ($LASTEXITCODE -ne 0) { throw 'Bundle ACBr não foi gerado.' }

Write-Host '[9/10] Compilando ponte de diagnóstico autônoma...'
& (Join-Path $PSScriptRoot 'build-diagnostic-bridge.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Ponte de diagnóstico não foi compilada.' }

Write-Host '[10/11] Preparando PostgreSQL 16 OSS embarcado...'
node scripts/stage-postgres-windows.mjs
if ($LASTEXITCODE -ne 0) { throw 'Bundle PostgreSQL 16 não foi gerado.' }

Write-Host '[11/11] Gerando instalador Electron Windows x64...'
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
