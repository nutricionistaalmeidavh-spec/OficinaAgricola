$ErrorActionPreference='Stop'
$exe=Get-ChildItem '.\dist-electron' -Filter 'ArtiSys-Oficina-Setup-*-Windows-x64.exe' |
 Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw 'Instalador Windows não encontrado' }
$installDir=Join-Path $env:RUNNER_TEMP 'artisys-oficina-clean-install'
$app=Join-Path $installDir 'ArtiSys Oficina.exe'
if (-not (Test-Path $app)) { throw 'App Windows não instalado' }
$bundle=Join-Path $installDir 'resources\postgresql'
foreach($file in @('postgresql-bundle.json','bin\initdb.exe','bin\pg_ctl.exe','bin\postgres.exe','share\postgres.bki')){
 if (-not (Test-Path (Join-Path $bundle $file))) {throw "PostgreSQL não embarcado: $file"}
}
$originalLocal=$env:LOCALAPPDATA
$root=Join-Path $env:RUNNER_TEMP 'artisys-postgres-first-install'
$env:LOCALAPPDATA=$root
$process=$null
function Start-Officina {
 $script:process=Start-Process -FilePath $app -PassThru
 for($attempt=0;$attempt -lt 160;$attempt++){
   Start-Sleep -Milliseconds 350
   if($script:process.HasExited){
     throw "Oficina PostgreSQL terminou antes de abrir: $($script:process.ExitCode)"
   }
   try{
     $response=Invoke-RestMethod 'http://127.0.0.1:3344/api/health' -TimeoutSec 1
     if($response.engine -eq 'postgres' -and $response.operationalApiReady -eq $true){
       return
     }
   }catch{}
 }
 throw 'PostgreSQL não iniciou automaticamente no Windows limpo'
}
function Stop-Officina {
 if($script:process -and -not $script:process.HasExited){
   $null=$script:process.CloseMainWindow()
   for($i=0;$i -lt 50;$i++){
     Start-Sleep -Milliseconds 200
     if($script:process.HasExited){break}
   }
   if(-not $script:process.HasExited){
     Stop-Process -Id $script:process.Id -Force -ErrorAction SilentlyContinue
   }
 }
 $script:process=$null
}
try{
 Start-Officina
 $profile=Join-Path $root 'ArtiSys\Oficina\postgres'
 $cluster=Join-Path $profile 'cluster\PG_VERSION'
 $secret=Join-Path $profile 'connection.json'
 if(-not(Test-Path $cluster) -or -not(Test-Path $secret)){
   throw 'O app não criou um cluster PostgreSQL privado no primeiro acesso'
 }
 if((Get-Content $cluster -Raw).Trim() -ne '16'){
   throw 'PostgreSQL versão incorreta'
 }
 $originalHash=(Get-FileHash $secret -Algorithm SHA256).Hash
 $setup=Invoke-RestMethod 'http://127.0.0.1:3344/api/setup/status'
 if($setup.required -ne $true){throw 'Primeira instalação não solicitou administrador'}
 $body=@{
   username='pg-admin-qa'
   name='QA PostgreSQL Windows'
   password='SenhaFortePG2026!Local'
 }|ConvertTo-Json -Compress
 $admin=Invoke-RestMethod 'http://127.0.0.1:3344/api/setup/initialize' -Method POST -ContentType 'application/json' -Body $body
 if($admin.role -ne 'ADMIN'){throw 'Administrador PostgreSQL não criado'}
 $login=Invoke-RestMethod 'http://127.0.0.1:3344/api/auth/login' -Method POST -ContentType 'application/json' -Body '{"username":"pg-admin-qa","password":"SenhaFortePG2026!Local"}'
 if(-not $login.token){throw 'Login PostgreSQL falhou'}
 $headers=@{Authorization="Bearer $($login.token)"}
 $customer=Invoke-RestMethod 'http://127.0.0.1:3344/api/customers' -Method POST -ContentType 'application/json' -Headers $headers -Body '{"name":"Cliente PostgreSQL Offline","requestId":"windows-postgres-once"}'
 if(-not $customer.id){throw 'Cliente não foi salvo no PostgreSQL'}
 Stop-Officina
 Start-Officina
 if((Get-FileHash $secret -Algorithm SHA256).Hash -ne $originalHash){
   throw 'Atualização/reabertura alterou as credenciais privadas PostgreSQL'
 }
 $login2=Invoke-RestMethod 'http://127.0.0.1:3344/api/auth/login' -Method POST -ContentType 'application/json' -Body '{"username":"pg-admin-qa","password":"SenhaFortePG2026!Local"}'
 $secondHeaders=@{Authorization="Bearer $($login2.token)"}
 $rows=@(Invoke-RestMethod 'http://127.0.0.1:3344/api/customers' -Headers $secondHeaders)
 if(-not($rows | Where-Object { $_.id -eq $customer.id })){
   throw 'Cliente PostgreSQL desapareceu após reabrir o aplicativo'
 }

 # Reinstalação silenciosa da MESMA versão; não substitui teste de migração entre versões.
 $sentinelDir=Join-Path $root 'ArtiSys\Oficina\storage\uploads'
 New-Item -ItemType Directory -Path $sentinelDir -Force | Out-Null
 $sentinel=Join-Path $sentinelDir 'qa-reinstall-preserve.txt'
 Set-Content -LiteralPath $sentinel -Value 'arquivo-de-teste-pg' -NoNewline -Encoding utf8
 Stop-Officina
 $installerAgain=Start-Process -FilePath $exe.FullName -ArgumentList @('/S',"/D=$installDir") -Wait -PassThru
 if($installerAgain.ExitCode -ne 0){throw "Reinstalação silenciosa falhou: $($installerAgain.ExitCode)"}
 Start-Officina
 $afterSetup=Invoke-RestMethod 'http://127.0.0.1:3344/api/setup/status'
 if($afterSetup.required -ne $false){throw 'Reinstalação perdeu o administrador'}
 $afterLogin=Invoke-RestMethod 'http://127.0.0.1:3344/api/auth/login' -Method POST -ContentType 'application/json' -Body '{"username":"pg-admin-qa","password":"SenhaFortePG2026!Local"}'
 if(-not $afterLogin.token){throw 'Reinstalação invalidou o login'}
 $afterHeaders=@{Authorization="Bearer $($afterLogin.token)"}
 $afterCustomers=@(Invoke-RestMethod 'http://127.0.0.1:3344/api/customers' -Headers $afterHeaders)
 if(-not($afterCustomers | Where-Object { $_.id -eq $customer.id -and $_.name -eq $customer.name })){
   throw 'Reinstalação perdeu cadastro persistido no PostgreSQL'
 }
 if((Get-FileHash $secret -Algorithm SHA256).Hash -ne $originalHash){
   throw 'Reinstalação alterou credenciais privadas do PostgreSQL'
 }
 if((Get-Content -LiteralPath $sentinel -Raw -Encoding utf8) -ne 'arquivo-de-teste-pg'){
   throw 'Reinstalação apagou arquivos locais da oficina'
 }
 $afterFiscal=Invoke-RestMethod 'http://127.0.0.1:3344/api/fiscal/settings' -Headers $afterHeaders
 if($afterFiscal.enabled -eq $true -or $afterFiscal.enabled -eq 1){
   throw 'Reinstalação habilitou emissão fiscal sem credenciamento'
 }
 Remove-Item -LiteralPath $sentinel -Force
 Write-Host 'PASS: Reinstalação PostgreSQL preservou administrador, cliente, cluster e anexos'

 Write-Host 'PASS: PostgreSQL 16 offline instalado automaticamente pelo Oficina, login e dados persistentes sem npm/terminal.'
}finally{
 Stop-Officina
 $env:LOCALAPPDATA=$originalLocal
}
