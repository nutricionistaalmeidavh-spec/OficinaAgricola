$ErrorActionPreference='Stop'
$exe=Get-ChildItem '.\dist-electron' -Filter 'ArtiSys-Oficina-Setup-*-Windows-x64.exe' |
 Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw 'Instalador Windows não encontrado' }
$installDir=Join-Path $env:RUNNER_TEMP 'artisys-oficina-clean-install'
$app=Join-Path $installDir 'ArtiSys Oficina.exe'
if (-not (Test-Path $app)) { throw 'App Windows não instalado' }
$bundle=Join-Path $installDir 'resources\postgresql'
foreach($file in @('postgresql-bundle.json','bin\initdb.exe','bin\pg_ctl.exe','bin\postgres.exe','share\postgres.bki','bin\vcruntime140.dll','bin\vcruntime140_1.dll','bin\msvcp140.dll')){
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
 # Diagnóstico seguro do runner: não mostrar connection.json nem password.
 $profile=Join-Path $env:LOCALAPPDATA 'ArtiSys\\Oficina\\postgres'
 $status=@{
   pg_version=Test-Path (Join-Path $profile 'cluster\\PG_VERSION')
   credentials=Test-Path (Join-Path $profile 'connection.json')
   pending=Test-Path (Join-Path $profile 'bootstrap.pending.json')
   bootstrap_lock=Test-Path (Join-Path $profile 'bootstrap.lock')
 }
 Write-Warning ('PostgreSQL first-launch state: '+($status | ConvertTo-Json -Compress))
 $pglog=Join-Path $profile 'postgres.log'
 if(Test-Path $pglog){
   Get-Content -LiteralPath $pglog -Tail 35 | ForEach-Object { Write-Warning ('PGLOG: '+$_) }
 }
 $diag=Join-Path $profile 'bootstrap-diagnostic.json'
 if(Test-Path $diag){
   $d=Get-Content -LiteralPath $diag -Raw | ConvertFrom-Json
   Write-Warning ('BOOTSTRAP: stage='+$d.stage+' code='+$d.code+' signal='+$d.signal)
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
 $afterFiscal=Invoke-WebRequest 'http://127.0.0.1:3344/api/fiscal/settings' -Headers $afterHeaders -SkipHttpErrorCheck
 if([int]$afterFiscal.StatusCode -ne 410){
   throw 'Reinstalação não preservou o bloqueio fiscal obrigatório'
 }
 Remove-Item -LiteralPath $sentinel -Force
 Write-Host 'PASS: Reinstalação PostgreSQL preservou administrador, cliente, cluster e anexos'

 # Reproduzir a exata falha da v1.0.4: o connection.json já existe, mas o
 # initdb foi interrompido antes de criar PG_VERSION. Nenhum dado é apagado.
 Stop-Officina
 $resumeRoot=Join-Path $env:RUNNER_TEMP 'artisys-postgres-interrupted-first-install'
 $resumeProfile=Join-Path $resumeRoot 'ArtiSys\Oficina\postgres'
 New-Item -ItemType Directory -Path $resumeProfile -Force | Out-Null
 $resumeSecret=Join-Path $resumeProfile 'connection.json'
 # Simular o connection.json escrito pela v1.0.4 ANTES de executar initdb.
 # Usar nova porta: copiar a configuração de um cluster que já funcionou
 # pode reutilizar sua porta enquanto o primeiro PostgreSQL encerra.
 $listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
 $listener.Start()
 $resumePort=$listener.LocalEndpoint.Port
 $listener.Stop()
 $resumePassword=[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48)).TrimEnd('=').Replace('+','-').Replace('/','_')
 $resumeConfig=@{schemaVersion=1;user='oficina_local_owner';port=$resumePort;password=$resumePassword}
 $resumeConfig | ConvertTo-Json -Compress | Set-Content -LiteralPath $resumeSecret -NoNewline -Encoding utf8NoBOM
 $resumePassword=$null
 $resumeHash=(Get-FileHash -LiteralPath $resumeSecret -Algorithm SHA256).Hash
 if(Test-Path (Join-Path $resumeProfile 'cluster\PG_VERSION')){
   throw 'Fixture da instalação interrompida não está limpa'
 }
 $env:LOCALAPPDATA=$resumeRoot
 try{
   Start-Officina
 }catch{
   Write-Warning ("Recovery first launch failed: "+$_.Exception.Message)
   $resumeVersion=Test-Path (Join-Path $resumeProfile 'cluster\PG_VERSION')
   $resumePending=Test-Path (Join-Path $resumeProfile 'bootstrap.pending.json')
   Write-Warning ("Diagnostic: PG_VERSION="+$resumeVersion+" pending="+$resumePending+" pgport="+$resumePort)
   $pglog=Join-Path $resumeProfile 'postgres.log'
   if(Test-Path $pglog){
     Get-Content -LiteralPath $pglog -Tail 30 | ForEach-Object {
       Write-Warning ("PostgreSQL log: "+($_ -replace 'postgresql://[^\s]+','postgresql://[REDACTED]'))
     }
   }
   throw
 }
 if(-not(Test-Path (Join-Path $resumeProfile 'cluster\PG_VERSION'))){
   throw 'Falha ao retomar initdb interrompido da v1.0.4'
 }
 if((Get-FileHash -LiteralPath $resumeSecret -Algorithm SHA256).Hash -ne $resumeHash){
   throw 'Recuperação da instalação inicial trocou credenciais'
 }
 $resumeSetup=Invoke-RestMethod 'http://127.0.0.1:3344/api/setup/status'
 if($resumeSetup.required -ne $true){throw 'Instalação recuperada não voltou ao primeiro acesso'}
 if(Test-Path (Join-Path $resumeProfile 'bootstrap.pending.json')){
   throw 'Marcador de bootstrap não foi concluído após recuperação'
 }
 Stop-Officina
 Write-Host 'PASS: v1.0.4 interrompida antes de PG_VERSION foi recuperada sem apagar dados ou rotacionar credenciais'

 # Regressão cliente real: conta Windows pode conter espaços e acentos,
 # o que fez o app empacotado desligar um PostgreSQL já iniciado.
 $unicodeRoot=Join-Path $env:RUNNER_TEMP 'oficina-perfil-Deus e fiél'
 $env:LOCALAPPDATA=$unicodeRoot
 Start-Officina
 $unicodePg=Join-Path $unicodeRoot 'ArtiSys\Oficina\postgres\cluster\PG_VERSION'
 if(-not(Test-Path $unicodePg)){
   throw 'Perfil Windows acentuado não inicializou cluster PostgreSQL'
 }
 # Verificar que os executáveis PG usam um drive ASCII, nunca uma rota
 # unicode de LOCAlAPPDATA, sem mover dados do cliente.
 $mapped=$false
 foreach($letter in 'ZYXWVUTSRQP'.ToCharArray()){
   $aliasCheck=("{0}:\\cluster\\PG_VERSION" -f $letter)
   if(Test-Path -LiteralPath $aliasCheck){
     $mapped=$true
     break
   }
 }
 if(-not $mapped){throw 'PostgreSQL não usou alias ASCII SUBST no perfil acentuado'}
 Stop-Officina
 Write-Host 'PASS: Perfil Windows acentuado usou alias ASCII sem mover dados nem perder acesso.'
 
 Write-Host 'PASS: PostgreSQL 16 offline instalado automaticamente pelo Oficina, login e dados persistentes sem npm/terminal.'
}finally{
 Stop-Officina
 $env:LOCALAPPDATA=$originalLocal
}
