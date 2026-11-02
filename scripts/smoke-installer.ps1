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

$hostUrl = 'http://127.0.0.1:3344'
$appProcess = $null
try {
  $appProcess = Start-Process -FilePath $exe.FullName -PassThru
  $ready = $false
  for ($attempt=0; $attempt -lt 80; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($appProcess.HasExited) { throw "O aplicativo fechou antes de iniciar o servidor. Exit=$($appProcess.ExitCode)" }
    try {
      $health = Invoke-RestMethod -Uri "$hostUrl/api/health" -TimeoutSec 2
      if ($health.ok) { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) { throw 'O servidor local não iniciou após instalação Windows limpa' }

  $state = Invoke-RestMethod -Uri "$hostUrl/api/setup/status"
  if ($state.required -ne $true) { throw 'Máquina limpa deve exigir criação do administrador' }
  $legacy = Invoke-WebRequest -Uri "$hostUrl/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"username":"admin","password":"Admin@1234"}' -SkipHttpErrorCheck
  if ($legacy.StatusCode -ne 401) { throw 'Senha padrão incorretamente aceita em instalação limpa' }

  # QA-only value; no real user credentials or secrets are transmitted.
  $body = @{
    username = 'gestorqa'
    name = 'Administrador QA Windows'
    password = 'SenhaDeTesteQA2026!Local'
    confirmPassword = 'SenhaDeTesteQA2026!Local'
  } | ConvertTo-Json -Compress
  $setup = Invoke-RestMethod -Uri "$hostUrl/api/setup/initialize" -Method Post -ContentType 'application/json' -Body $body
  if ($setup.role -ne 'ADMIN') { throw 'Administrador não criado pela interface local' }
  $state = Invoke-RestMethod -Uri "$hostUrl/api/setup/status"
  if ($state.required -ne $false) { throw 'Setup não foi bloqueado após criação do primeiro admin' }
  $login = Invoke-RestMethod -Uri "$hostUrl/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"username":"gestorqa","password":"SenhaDeTesteQA2026!Local"}'
  if ($login.user.role -ne 'ADMIN') { throw 'Login do administrador configurado falhou' }

  $dbFile = Join-Path $env:LOCALAPPDATA 'ArtiSys\Oficina\data\artisys-oficina.sqlite'
  if (-not (Test-Path $dbFile)) { throw 'Banco exclusivo do aplicativo não foi criado no perfil Windows' }
  Write-Host 'PASS: NSIS instalou, app iniciou, primeiro acesso foi configurado e login funcionou'
} finally {
  if ($appProcess -and -not $appProcess.HasExited) { Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue }
}
