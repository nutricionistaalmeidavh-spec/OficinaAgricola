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
  $hardware = Invoke-RestMethod -Uri "$hostUrl/api/diagnostics/hardware" -Headers $headers
    if (-not $hardware.j1939.pythonCan) {
      throw 'Servidor Electron não conseguiu executar sua ponte de diagnóstico empacotada'
    }
    Write-Host 'PASS: Rota autenticada de diagnóstico usou ponte embutida no Windows limpo'
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

  $fiscalProfile = Join-Path $env:LOCALAPPDATA 'ArtiSys\Oficina\fiscal'
  foreach ($relative in @('config\ACBrLibNFe.ini','config\ACBrLibNFSe.ini')) {
    if (-not (Test-Path (Join-Path $fiscalProfile $relative))) {
      throw "Configuração ACBr no perfil do usuário não foi preparada: $relative"
    }
  }
  if (-not (Test-Path (Join-Path $fiscalProfile 'entrada'))) {
    throw 'Diretório privado de INIs fiscais não criado'
  }
  $settings = Invoke-RestMethod -Uri "$hostUrl/api/fiscal/settings" -Headers $headers
  if ($settings.enabled -eq $true -or $settings.enabled -eq 1) {
    throw 'Fiscal não pode iniciar habilitado no primeiro acesso'
  }

  $dbFile = Join-Path $env:LOCALAPPDATA 'ArtiSys\Oficina\data\artisys-oficina.sqlite'
  if (-not (Test-Path $dbFile)) { throw 'Banco exclusivo do aplicativo não foi criado no perfil Windows' }
  Write-Host 'PASS: NSIS instalou, bootstrap/login funcionou, e o EventBus desktop projetou evento idempotente'
  # Atualização in-place: reiniciar instalador em cima de perfil já utilizado.
  # Mesmo pacote verifica retenção; matriz entre versões distintas é gate comercial separado.
  Stop-Process -Id $appProcess.Id -Force
  Wait-Process -Id $appProcess.Id -ErrorAction SilentlyContinue
  $appProcess = $null
  $reinstall = Start-Process -FilePath $installer.FullName -ArgumentList @('/S',"/D=$installDir") -Wait -PassThru
  if ($reinstall.ExitCode -ne 0) { throw "Falha na reinstalação: $($reinstall.ExitCode)" }
  $appProcess = Start-Process -FilePath $exe.FullName -PassThru
  $ready = $false
  for ($attempt=0; $attempt -lt 80; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($appProcess.HasExited) { throw 'Aplicativo não iniciou após reinstalação' }
    try { if ((Invoke-RestMethod -Uri "$hostUrl/api/health" -TimeoutSec 2).ok) { $ready=$true; break } } catch {}
  }
  if (-not $ready) { throw 'Servidor indisponível após reinstalação' }
  $afterSetup = Invoke-RestMethod -Uri "$hostUrl/api/setup/status"
  if ($afterSetup.required -ne $false) { throw 'Reinstalação apagou o administrador' }
  $afterLogin = Invoke-RestMethod -Uri "$hostUrl/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"username":"gestorqa","password":"SenhaDeTesteQA2026!Local"}'
  if ($afterLogin.user.role -ne 'ADMIN') { throw 'Reinstalação invalidou as credenciais existentes' }
  $afterHeaders = @{ Authorization = "Bearer $($afterLogin.token)" }
  $storedCustomer = Invoke-RestMethod -Uri "$hostUrl/api/customers/$($customer.id)" -Headers $afterHeaders
  if ($storedCustomer.id -ne $customer.id -or $storedCustomer.name -ne $customer.name) {
    throw 'Reinstalação perdeu o registro canônico de cliente'
  }
  $afterFiscal = Invoke-RestMethod -Uri "$hostUrl/api/fiscal/settings" -Headers $afterHeaders
  if ($afterFiscal.enabled -eq $true -or $afterFiscal.enabled -eq 1) {
    throw 'Reinstalação habilitou o fiscal indevidamente'
  }
  Write-Host 'PASS: Reinstalação preservou cadastro e autenticação; fiscal permaneceu desabilitado'

} finally {
  if ($appProcess -and -not $appProcess.HasExited) { Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue }
}

# Atualização/reinstalação no mesmo diretório: banco e anexos precisam sobreviver.
# Mesmo instalador simula um upgrade in-place sem rodar migradores externos.
Write-Host 'Verificando preservação de dados na reinstalação Windows...'
$sentinelDir=Join-Path $env:LOCALAPPDATA 'ArtiSys\Oficina\storage\uploads'
New-Item -ItemType Directory -Path $sentinelDir -Force | Out-Null
$sentinelFile=Join-Path $sentinelDir 'qa-upgrade-preserve.txt'
$sentinel='Conteúdo QA preservado após atualização'
Set-Content -LiteralPath $sentinelFile -Value $sentinel -NoNewline -Encoding utf8
$installerAgain=Start-Process -FilePath $installer.FullName -ArgumentList @('/S',"/D=$installDir") -Wait -PassThru
if ($installerAgain.ExitCode -ne 0) { throw "Reinstalação falhou: $($installerAgain.ExitCode)" }
if (-not (Test-Path -LiteralPath $dbFile -PathType Leaf)) {
  throw 'Reinstalação apagou o banco do cliente'
}
if ((Get-Content -LiteralPath $sentinelFile -Raw -Encoding utf8) -ne $sentinel) {
  throw 'Reinstalação apagou ou modificou anexos da oficina'
}
$upgradeProcess=$null
try {
  $upgradeProcess=Start-Process -FilePath $exe.FullName -PassThru
  $upgradeReady=$false
  for ($attempt=0; $attempt -lt 80; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($upgradeProcess.HasExited) { throw 'Aplicativo não abriu após reinstalação' }
    try {
      $health=Invoke-RestMethod -Uri "$hostUrl/api/health" -TimeoutSec 2
      if ($health.ok) { $upgradeReady=$true; break }
    } catch {}
  }
  if (-not $upgradeReady) { throw 'Servidor local não respondeu após reinstalação' }
  $setupAfter=Invoke-RestMethod -Uri "$hostUrl/api/setup/status"
  if ($setupAfter.required -ne $false) { throw 'Reinstalação perdeu o administrador original' }
  $loginAfter=Invoke-RestMethod -Uri "$hostUrl/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"username":"gestorqa","password":"SenhaDeTesteQA2026!Local"}'
  if ($loginAfter.user.role -ne 'ADMIN') { throw 'Reinstalação invalidou o acesso original' }
  $authAfter=@{ Authorization="Bearer $($loginAfter.token)" }
  $customerAfter=Invoke-RestMethod -Uri "$hostUrl/api/customers/$($customer.id)" -Headers $authAfter
  if ($customerAfter.name -ne 'Cliente QA EventBus Windows' -or $customerAfter.id -ne $customer.id) {
    throw 'Reinstalação perdeu ou alterou cliente salvo no SQLite'
  }
  Write-Host 'PASS: Reinstalação preservou login, cliente, banco e arquivos locais'
} finally {
  if ($upgradeProcess -and -not $upgradeProcess.HasExited) {
    Stop-Process -Id $upgradeProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $sentinelFile -Force -ErrorAction SilentlyContinue
}
