$ErrorActionPreference = 'Stop'

$installer = Get-ChildItem -Path '.\dist-electron' -Filter 'ArtiSys-Oficina-Setup-*-Windows-x64.exe' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw 'Instalador NSIS Windows x64 não encontrado' }

$sha256 = (Get-FileHash -Path $installer.FullName -Algorithm SHA256).Hash
Write-Host "NSIS SHA256: $sha256"

# Hosted GitHub Actions Windows is a fresh, disposable VM/profile.
$installDir = Join-Path $env:RUNNER_TEMP 'artisys-oficina-clean-install'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$installerProcess = Start-Process -FilePath $installer.FullName -ArgumentList @('/S',"/D=$installDir") -Wait -PassThru
if ($installerProcess.ExitCode -ne 0) { throw "Instalador encerrou com código $($installerProcess.ExitCode)" }
$exe = Get-ChildItem -Path $installDir -Filter 'ArtiSys Oficina.exe' -Recurse -File | Select-Object -First 1
if (-not $exe) { throw 'Executável não instalado no diretório limpo' }

# Garantir que o pacote final contém a ponte real e que ela funciona sem Python do Windows.
$bridgeExe = Join-Path $exe.DirectoryName 'resources\diagnostics\ArtiSys-Diagnostic-Bridge\ArtiSys-Diagnostic-Bridge.exe'
if (-not (Test-Path -LiteralPath $bridgeExe -PathType Leaf)) {
  throw 'Instalador não incluiu a ponte J2534/J1939 embutida'
}
$originalPath = $env:PATH
try {
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
  $probe = '{"action":"probe"}' | & $bridgeExe
  if ($LASTEXITCODE -ne 0) { throw 'Ponte embutida falhou sem Python no PATH' }
  $probeJson = $probe | Out-String | ConvertFrom-Json
  if ($probeJson.ok -ne $true -or $probeJson.data.j1939.pythonCan -ne $true) {
    throw 'Ponte embutida não está funcional ou python-can não foi empacotado'
  }
} finally {
  $env:PATH = $originalPath
}
Write-Host 'PASS: Ponte J2534/J1939 embutida funciona sem Python instalado no PATH'

# A instalação só é considerada válida se o pacote fiscal nativo, em resources,
# estiver completo, íntegro e carregável, SEM Python instalado no cliente.
$fiscalDir = Join-Path $installDir 'resources\fiscal'
$manifestFile = Join-Path $fiscalDir 'acbr-bundle.json'
if (-not (Test-Path $manifestFile)) { throw 'Instalador sem pacote fiscal/manifesto ACBr' }
$manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.architecture -ne 'x64') {
  throw 'Manifesto ACBr inválido'
}
foreach ($file in $manifest.files.PSObject.Properties) {
  $name = $file.Name
  if ($name -notmatch '^(?:[a-zA-Z0-9._-]+|deps/[a-zA-Z0-9._-]+)$') {
    throw "Caminho fiscal suspeito: $name"
  }
  $local = Join-Path $fiscalDir $name
  if (-not (Test-Path $local)) { throw "Pacote ACBr incompleto: $name" }
  if ((Get-FileHash -Path $local -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.Value) {
    throw "Pacote ACBr adulterado: $name"
  }
}
$worker = Join-Path $fiscalDir 'acbrlib-worker.exe'
$workerState = & $worker --self-test | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $workerState.ok -or -not $workerState.frozen) {
  throw 'Worker fiscal exige Python ou falhou no Windows limpo'
}
foreach ($dll in @('ACBrNFe64.dll','ACBrNFSe64.dll')) {
  $native = & $worker --probe (Join-Path $fiscalDir $dll) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $native.ok) { throw "ACBr não carregou no instalador: $dll" }
}
Write-Host 'PASS: worker standalone e duas DLLs ACBr reais carregadas sem Python do cliente'

# O smoke de inicialização/login/persistência PostgreSQL fica em
# scripts/smoke-postgres-portable.ps1, executado como gate obrigatório em seguida.
# Nunca voltar a exercitar event bus ou banco SQLite como se fossem o core.
Write-Host 'PASS: NSIS instalado; ACBr e diagnóstico embarcados íntegros. PostgreSQL smoke a seguir.'
