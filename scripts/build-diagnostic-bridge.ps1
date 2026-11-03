$ErrorActionPreference = 'Stop'

# A ponte inclui Python e python-can em uma pasta própria distribuída pelo NSIS.
# Nunca baixa bibliotecas durante a instalação ou execução no PC do cliente.
$python = if ($env:DIAGNOSTIC_BUILD_PYTHON) { $env:DIAGNOSTIC_BUILD_PYTHON } else { 'python' }
$requirements = Join-Path $PSScriptRoot 'requirements-diagnostic-bridge.txt'
$source = Join-Path (Split-Path $PSScriptRoot -Parent) 'src/platform/diagnostic-worker.py'
$root = Split-Path $PSScriptRoot -Parent
$bundle = Join-Path $root 'build/diagnostics/ArtiSys-Diagnostic-Bridge'
$exe = Join-Path $bundle 'ArtiSys-Diagnostic-Bridge.exe'

Write-Host 'Instalando dependências open source apenas no ambiente de compilação...'
& $python -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar build da ponte de diagnóstico' }

Write-Host 'Empacotando Python e os backends python-can para Windows x64...'
& $python -m PyInstaller --noconfirm --clean --onedir --name ArtiSys-Diagnostic-Bridge `
  --distpath (Join-Path $root 'build/diagnostics') `
  --workpath (Join-Path $root 'build/diagnostic-pyinstaller') `
  --specpath (Join-Path $root 'build/diagnostic-pyinstaller') `
  --collect-submodules can --copy-metadata python-can $source
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar a ponte de diagnóstico integrada' }

if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
  throw 'Ponte de diagnóstico não foi produzida pelo PyInstaller'
}

# Verifica execução real da ponte com entrada JSON, sem dependência de python.exe no PATH.
$previousPath = $env:PATH
try {
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
  $raw = '{"action":"probe"}' | & $exe
  if ($LASTEXITCODE -ne 0) { throw "A ponte integrada falhou no probe: $LASTEXITCODE" }
  $data = ($raw | Out-String | ConvertFrom-Json)
  if ($data.ok -ne $true -or $data.data.j1939.pythonCan -ne $true) {
    throw 'A ponte integrada não contém a biblioteca python-can'
  }
} finally { $env:PATH = $previousPath }

Write-Host 'PASS: Ponte J2534/J1939 compilada com runtime Python e python-can embutidos.'
