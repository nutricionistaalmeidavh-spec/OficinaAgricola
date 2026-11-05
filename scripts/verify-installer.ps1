param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
  [switch]$RequireSignature
)
$ErrorActionPreference = 'Stop'
# Somente leitura: verificação offline antes de liberar atualização/distribuição.
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Instalador não encontrado' }
$actual = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
if ($actual.ToUpperInvariant() -ne $ExpectedSha256.ToUpperInvariant()) {
  throw "SHA256 inválido: arquivo recebido diferente do manifesto de distribuição"
}
$signature = Get-AuthenticodeSignature -LiteralPath $Installer
if ($RequireSignature -and $signature.Status -ne 'Valid') {
  throw "Assinatura Authenticode obrigatória para esta distribuição: $($signature.Status)"
}
Write-Host "OK SHA256: $actual"
Write-Host "Assinatura Authenticode: $($signature.Status)"
Write-Host 'A assinatura é opcional para builds internos e obrigatória apenas com -RequireSignature.'
Write-Host 'Este comando não instala nem publica o aplicativo.'
