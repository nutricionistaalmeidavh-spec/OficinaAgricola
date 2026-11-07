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

# Confirme que a edição distribuída não contém pacotes fiscais.
if (Test-Path -LiteralPath (Join-Path $installDir 'resources\fiscal')) { throw 'Instalador contém pacote fiscal inativo' }
if (Test-Path -LiteralPath (Join-Path $installDir 'resources\nfse-national')) { throw 'Instalador contém SDK NFS-e inativo' }

# O smoke de inicialização/login/persistência PostgreSQL fica em
# scripts/smoke-postgres-portable.ps1, executado como gate obrigatório em seguida.
# Nunca voltar a exercitar event bus ou banco SQLite como se fossem o core.
Write-Host 'PASS: NSIS instalado; diagnóstico embarcado íntegro e fiscal ausente. PostgreSQL smoke a seguir.'
