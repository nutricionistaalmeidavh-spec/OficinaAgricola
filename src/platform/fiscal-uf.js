// Contrato regional explícito. Os endereços de SEFAZ são resolvidos pelo ACBr;
// nunca fixar URLs de webservice no app nem aceitar CSC/certificado via HTTP.
export const FISCAL_UFS = Object.freeze({
  SP: Object.freeze({code:'35',ibge:'35',nfce:true,credential:'credenciamento NFC-e/CSC',notes:'SAT substituído pela NFC-e desde 01/01/2026; sem inutilização desde 01/11/2026',official:'https://portal.fazenda.sp.gov.br/servicos/nfce'}),
  PR: Object.freeze({code:'41',ibge:'41',nfce:true,credential:'habilitação do aplicativo e CSC pela Receita/PR',notes:'Autorizador próprio de NFC-e',official:'https://sped.fazenda.pr.gov.br/NFCe/Pagina/Credenciamento-de-emissores'}),
  MG: Object.freeze({code:'31',ibge:'31',nfce:true,credential:'credenciamento de contribuinte e CSC no SIARE',notes:'Desenvolvedor deve observar normas estaduais de credenciamento',official:'https://portalsped.fazenda.mg.gov.br/spedmg/nfce/'}),
  RJ: Object.freeze({code:'33',ibge:'33',nfce:true,credential:'permissão de emissão e CSC no Portal DF-e',notes:'NFC-e autorizada via SVRS',official:'https://portal.fazenda.rj.gov.br/dfe/'}),
  SC: Object.freeze({code:'42',ibge:'42',nfce:true,credential:'desenvolvedor PAF-NFC-e credenciado, autorização de uso e exigências de homologação aplicáveis',notes:'Ato DIAT 54/2026: não distribuir PAF-NFC-e sem os requisitos legais',official:'https://www.sef.sc.gov.br/saiba-mais/nfc-e-nota-fiscal-de-consumidor-eletronica'}),
  RS: Object.freeze({code:'43',ibge:'43',nfce:true,credential:'CSC no e-CAC e credenciamento aplicável',notes:'NFC-e e meios eletrônicos de pagamento devem estar integrados conforme a operação',official:'https://receita.fazenda.rs.gov.br/servicos-a-empresas/servicos?servico=1727'})
});
export function fiscalUfProfile(uf){
  const profile=FISCAL_UFS[String(uf||'').toUpperCase()];
  if(!profile)throw new Error('Integração NF-e/NFC-e disponível inicialmente apenas para SP, PR, MG, RJ, SC e RS');
  return profile;
}
export function assertFiscalIssuerUf({uf,municipalityIbge}={}){
  const profile=fiscalUfProfile(uf);
  const ibge=String(municipalityIbge||'');
  if(!/^\d{7}$/.test(ibge)||!ibge.startsWith(profile.ibge))
    throw new Error('Município IBGE não corresponde à UF do emitente');
  return profile;
}
export function assertReviewedFiscalUf({kind,issuer,sections}={}){
  const profile=assertFiscalIssuerUf(issuer);
  if(!['NFE','NFCE'].includes(kind))throw new Error('Modelo fiscal estadual não suportado');
  const ide=sections?.Identificacao;
  if(!ide||String(ide.cUF)!==profile.code||String(ide.cMunFG)!==String(issuer.municipalityIbge))
    throw new Error('cUF/cMunFG do INI divergem do município/UF do emitente');
  if(String(ide.mod)!==(kind==='NFCE'?'65':'55'))
    throw new Error('Modelo de documento fiscal diferente do rascunho');
  if(String(ide.tpAmb)!==(issuer.environment==='HOMOLOGACAO'?'2':'1'))
    throw new Error('Ambiente fiscal do INI não corresponde ao emitente');
  if(kind==='NFCE'){
    if(String(ide.idDest)!=='1'||String(ide.indFinal)!=='1'||!['1','4'].includes(String(ide.indPres)))
      throw new Error('NFC-e exige venda interna a consumidor final, com presença informada');
    if(String(ide.tpEmis)!=='1')
      throw new Error('Contingência NFC-e offline não implementada: somente emissão normal é permitida');
    const payments=Object.entries(sections||{}).filter(([name])=>/^pag\d{3}$/.test(name));
    if(!payments.length)throw new Error('NFC-e exige grupo pag001 revisado para o documento');
    if(payments.some(([,p])=>!/^\d{2}$/.test(String(p.tPag||''))||
       !/^(?:0|[1-9]\d*)\.\d{2}$/.test(String(p.vPag||''))))
      throw new Error('NFC-e exige código e valor de pagamento revisados');
    if(issuer.uf==='RS'&&payments.some(([name,p])=>{
      if(!['03','04','17'].includes(String(p.tPag)))return false;
      const number=name.slice(3);
      const card=sections['card'+number];
      return String(card?.tpIntegra)!=='1'||!String(card?.cAut||'').trim()||
        (['03','04'].includes(String(p.tPag))&&(!/^\\d{14}$/.test(String(card?.CNPJ||''))||!String(card?.tBand||'').trim()));
    }))throw new Error('RS: pagamento eletrônico exige grupo cardNNN com autorização e integração');
  }
  return profile;
}
