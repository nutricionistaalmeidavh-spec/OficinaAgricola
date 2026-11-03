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

  # Smoke real da fila do servidor desktop: criar cliente duas vezes com a
  # mesma chave e verificar exatamente um evento de domínio projetado no JSONL.
  $headers = @{ Authorization = "Bearer $($login.token)" }
  $clientBody = '{"name":"Cliente QA EventBus Windows","requestId":"windows-event-outbox-once"}'
  $customer = Invoke-RestMethod -Uri "$hostUrl/api/customers" -Method Post -Headers $headers -ContentType 'application/json' -Body $clientBody
  $again = Invoke-RestMethod -Uri "$hostUrl/api/customers" -Method Post -Headers $headers -ContentType 'application/json' -Body $clientBody
  if ($customer.id -ne $again.id) { throw 'Reenvio do comando criou outro cliente' }
  $eventsFile = Join-Path $env:LOCALAPPDATA 'ArtiSys\Oficina\events\events.jsonl'
  $matching = @()
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    Start-Sleep -Milliseconds 400
    if (Test-Path $eventsFile) {
      $matching = @(
        Get-Content -Path $eventsFile | ForEach-Object {
          try { $_ | ConvertFrom-Json } catch { $null }
        } | Where-Object {
          $_ -and $_.type -eq 'ENTITY_MUTATED' -and
          $_.payload.path -eq '/api/customers' -and
          $_.payload.resourceId -eq $customer.id
        }
      )
      if ($matching.Count -ge 1) { break }
    }
  }
  if ($matching.Count -ne 1) {
    throw "EventBus do desktop precisa registrar exatamente um evento por cliente; eventos=$($matching.Count)"
  }

  $dbFile = Join-Path $env:LOCALAPPDATA 'ArtiSys\Oficina\data\artisys-oficina.sqlite'
  if (-not (Test-Path $dbFile)) { throw 'Banco exclusivo do aplicativo não foi criado no perfil Windows' }
  Write-Host 'PASS: NSIS instalou, bootstrap/login funcionou, e o EventBus desktop projetou evento idempotente' 
} finally {
  if ($appProcess -and -not $appProcess.HasExited) { Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue }
}
