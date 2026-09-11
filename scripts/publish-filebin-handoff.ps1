$ErrorActionPreference = 'Stop'

$exe = Get-ChildItem '.\dist-electron\OficinaAgro-Setup-*-Windows-x64.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw 'Instalador final não encontrado para handoff.' }

$openssl = (Get-Command openssl.exe -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
  $gitOpenSsl = 'C:\Program Files\Git\usr\bin\openssl.exe'
  if (Test-Path $gitOpenSsl) { $openssl = $gitOpenSsl }
}
if (-not $openssl) { throw 'OpenSSL não encontrado no runner Windows.' }

$bin = 'um5bq2jyhlg2i2e5'
$short = if ($env:CIRCLE_SHA1) { $env:CIRCLE_SHA1.Substring(0, 16) } else { 'manual' }
$stage = Join-Path $env:TEMP "oficina-agro-filebin-$short"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null

$encryptedName = "OficinaAgro-$short.exe.enc"
$keyName = "OficinaAgro-$short.key.enc"
$manifestName = "OficinaAgro-$short.manifest.json"
$encryptedPath = Join-Path $stage $encryptedName
$keyPath = Join-Path $stage $keyName
$manifestPath = Join-Path $stage $manifestName
$passPath = Join-Path $stage 'pass.txt'

& $openssl rand -hex 32 | Set-Content -Path $passPath -Encoding ascii -NoNewline
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar chave temporária.' }

& $openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -in $exe.FullName -out $encryptedPath -pass "file:$passPath"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criptografar instalador.' }

& $openssl pkeyutl -encrypt -pubin -inkey '.\.circleci\release-transfer-public.pem' -in $passPath -out $keyPath -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256
if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger chave de handoff.' }
Remove-Item $passPath -Force

$originalHash = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$encryptedHash = (Get-FileHash $encryptedPath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  schemaVersion = 1
  sourceCommit = $env:CIRCLE_SHA1
  fileName = $exe.Name
  size = $exe.Length
  sha256 = $originalHash
  encryptedFile = $encryptedName
  encryptedSha256 = $encryptedHash
  encryptedKeyFile = $keyName
  cipher = 'aes-256-cbc-pbkdf2-200000'
  keyWrap = 'rsa-oaep-sha256'
}
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))

function Upload-File([string]$path, [string]$name) {
  $url = "https://filebin.net/$bin/$name"
  & curl.exe --fail --silent --show-error --request POST --data-binary "@$path" $url | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha ao enviar $name para handoff temporário." }
  Write-Host "Handoff enviado: $url"
}

Upload-File $encryptedPath $encryptedName
Upload-File $keyPath $keyName
Upload-File $manifestPath $manifestName

$checksums = & curl.exe --fail --silent --show-error "https://filebin.net/sha256/$bin"
if ($LASTEXITCODE -ne 0 -or -not ($checksums -match [regex]::Escape($encryptedHash))) {
  throw 'Falha ao verificar upload criptografado no handoff temporário.'
}

Write-Host "Handoff Filebin concluído para commit $env:CIRCLE_SHA1"
Write-Host "SHA256 original: $originalHash"
