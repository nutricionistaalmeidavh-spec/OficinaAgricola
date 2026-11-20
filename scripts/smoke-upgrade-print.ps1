# Disposable Windows Actions VM. Send the default PDF queue to a known file
# so the real native dialog requires only confirmation.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP 'oficina-upgrade-print'
New-Item -ItemType Directory -Force $root, 'qa-output' | Out-Null
$destination = Join-Path (Resolve-Path 'qa-output') 'orcamento-windows.pdf'
$old = 'ArtiSys-Oficina-Setup-1.0.11-Windows-x64-Commercial.exe'
gh release download v1.0.11 --pattern $old --dir $root
if ($LASTEXITCODE -ne 0) { throw 'Download da versão anterior falhou' }
$previous = Join-Path $root $old
if ((Get-FileHash $previous).Hash -ne '9e2b126f09ff3ce9f4363083812d75e970d4c6afbf961b12eab323ae712ad294') { throw 'Checksum anterior inválido' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$current = (Resolve-Path "dist-electron/ArtiSys-Oficina-Setup-$version-Windows-x64-Commercial.exe").Path
Start-Service Spooler
if (-not (Get-PrinterDriver -Name 'Microsoft Print To PDF' -ErrorAction SilentlyContinue)) {
  Enable-WindowsOptionalFeature -Online -FeatureName Printing-PrintToPDFServices-Features -All -NoRestart
  Add-PrinterDriver -Name 'Microsoft Print To PDF'
}
Add-PrinterPort -Name $destination
Add-Printer -Name 'Oficina QA PDF' -DriverName 'Microsoft Print To PDF' -PortName $destination
(Get-CimInstance Win32_Printer -Filter "Name='Oficina QA PDF'") | Invoke-CimMethod -MethodName SetDefaultPrinter | Out-Null
python -m pip install --disable-pip-version-check playwright==1.51.0 pywinauto==0.6.9 pypdf==5.4.0
if ($LASTEXITCODE -ne 0) { throw 'Dependências do teste Windows indisponíveis' }
python scripts/windows-upgrade-print.py $root $previous $current $destination $version
if ($LASTEXITCODE -ne 0) { throw 'Validação do upgrade e PDF falhou' }
