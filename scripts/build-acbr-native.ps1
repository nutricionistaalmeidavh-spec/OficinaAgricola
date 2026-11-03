# Compilação local/CI sem ACBr Pro ou downloads de DLLs comerciais.
# Requer Lazarus/FPC + SVN + Git no COMPUTADOR DE BUILD, nunca no computador cliente.
param(
  [string]$Revision = '48608',
  [string]$SourceRoot = '.build/acbr-source'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Compilar ACBr para NSIS exige Windows x64.' }
if ($Revision -notmatch '^[0-9]+$') { throw 'Revisão SVN numérica obrigatória.' }

$source = [IO.Path]::GetFullPath($SourceRoot)
$output = [IO.Path]::GetFullPath('build/fiscal-native')
New-Item -ItemType Directory -Path $source,$output -Force | Out-Null
$remote = 'https://svn.code.sf.net/p/acbr/code/trunk2'
function Run([string]$exe,[string[]]$params) {
  & $exe @params
  if ($LASTEXITCODE -ne 0) { throw "$exe falhou ($LASTEXITCODE)" }
}
if (-not (Get-Command svn -ErrorAction SilentlyContinue)) { throw 'SVN indisponível no builder.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git indisponível no builder.' }
$laz = Get-Command lazbuild -ErrorAction SilentlyContinue | Select-Object -First 1
if ($laz) { $lazbuild = $laz.Source }
else {
  $candidate = @('C:\lazarus\lazbuild.exe','C:\tools\lazarus\lazbuild.exe') |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $candidate) { throw 'Lazarus/FPC não encontrado; instale open source no computador de build.' }
  $lazbuild = $candidate
}
# Exporta apenas os diretórios necessários, com revisão explícita e rastreável.
$subtrees = @(
  'Fontes','Pacotes','Projetos/ACBrLib/Fontes',
  'DLLs/LibXml2/x64','DLLs/OpenSSL/3.1.3/x64','DLLs/XMLSec'
)
foreach ($sub in $subtrees) {
  $dest = Join-Path $source ($sub.Replace('/',[IO.Path]::DirectorySeparatorChar))
  if (-not (Test-Path $dest)) {
    New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
    Run 'svn' @('export','--non-interactive','--quiet','-r',$Revision,"$remote/$sub",$dest)
  }
}
# Dependências open source para renderização usada pelos pacotes do ACBr.
$outside = Join-Path $source '_external'
New-Item -ItemType Directory -Path $outside -Force | Out-Null
$deps = @(
  @('fortesreport-ce','https://github.com/fortesinformatica/fortesreport-ce.git'),
  @('PowerPDF','https://github.com/drungrin/PowerPDF.git')
)
foreach ($dep in $deps) {
  $dest = Join-Path $outside $dep[0]
  if (-not (Test-Path $dest)) { Run 'git' @('clone','--depth','1',$dep[1],$dest) }
}
$pcp = Join-Path $source '_lazarus-profile'
New-Item -ItemType Directory -Path $pcp -Force | Out-Null
$allPackages = @(Get-ChildItem -Path (Join-Path $source 'Pacotes/Lazarus') -Filter '*.lpk' -File -Recurse | Sort-Object FullName)
if ($allPackages.Count -lt 20) { throw 'Checkout oficial ACBr incompleto: menos de 20 pacotes Lazarus.' }
# Vincular todos os .lpk disponíveis evita supor nomes de pacotes agregadores
# (por exemplo ACBrTXT é um diretório, não um arquivo .lpk).
# --add-package-link apenas registra; nenhum pacote não requerido será compilado.
foreach ($pkg in $allPackages) {
  Run $lazbuild @("--pcp=$pcp",'--add-package-link',$pkg.FullName)
}
$extraPackages = @(
  (Join-Path $outside 'fortesreport-ce/Packages/frce.lpk'),
  (Join-Path $outside 'PowerPDF/pack_powerpdf.lpk')
)
foreach ($pkg in $extraPackages) {
  if (-not (Test-Path $pkg)) { throw "Pacote externo open source ausente: $pkg" }
  Run $lazbuild @("--pcp=$pcp",'--add-package-link',$pkg)
}
$projects = @(
  @('NFe','ACBrLibNFe.lpi','ACBrNFe64.dll'),
  @('NFSe','ACBrLibNFSe.lpi','ACBrNFSe64.dll')
)
foreach ($item in $projects) {
  $projectDir = Join-Path $source ('Projetos/ACBrLib/Fontes/'+$item[0])
  $project = Join-Path $projectDir $item[1]
  if (-not (Test-Path $project)) { throw "Fonte ACBr não encontrado: $project" }
  Run $lazbuild @("--pcp=$pcp",'-B','--build-mode=Win64-x86_64-CDECL',$project)
  $nativeFile = Join-Path $projectDir ('bin/Windows/ST/Cdecl/'+$item[2])
  if (-not (Test-Path $nativeFile)) { throw "DLL não foi gerada: $nativeFile" }
  Copy-Item -Path $nativeFile -Destination (Join-Path $output $item[2]) -Force
}
$depDir = Join-Path $output 'deps'
New-Item -ItemType Directory -Path $depDir -Force | Out-Null
foreach ($from in @(
  (Join-Path $source 'DLLs/LibXml2/x64'),
  (Join-Path $source 'DLLs/OpenSSL/3.1.3/x64')
)) {
  Get-ChildItem -Path $from -Filter '*.dll' -File | ForEach-Object {
    Copy-Item $_.FullName -Destination (Join-Path $depDir $_.Name) -Force
  }
}
# XMLSec DLLs adicionais para provedores ACBr que exigem certificados XML.
Get-ChildItem -Path (Join-Path $source 'DLLs/XMLSec') -Filter '*.dll' -File |
  ForEach-Object { Copy-Item $_.FullName -Destination (Join-Path $depDir $_.Name) -Force }
New-Item -ItemType Directory -Path 'build' -Force | Out-Null
Set-Content -Path 'build/acbr-revision.txt' -Value $Revision -NoNewline
Write-Host "ACBr OSS compilado de SVN r$Revision em $output"
