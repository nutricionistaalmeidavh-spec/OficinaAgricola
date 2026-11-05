#!/usr/bin/env python3
"""Integra IBS/CBS no fluxo tipado de perfis fiscais existente na main."""
from pathlib import Path

def replace_unique(data, find, replacement, path):
    count=data.count(find)
    if count!=1:
        raise RuntimeError(f'Âncora esperada {path}: {count} ocorrências: {find[:100]!r}')
    return data.replace(find,replacement)

ui=Path('public/app-fiscal.js')
s=ui.read_text()
old="  const itemRows=lines.map((line,i)=>'<fieldset class=\"form-stack\"><legend>Item '+(i+1)+"
new='''  const ibsField=(i,key,label)=>'<label>'+label+'<input name="item'+i+key+'" inputmode="decimal"></label>';
  const ibsValues=i=>'<details><summary>IBS/CBS da reforma tributária, quando aplicável</summary>'+
    '<p class="muted">Preencha somente com classificação fiscal conferida. Benefícios e diferimento exigem cClassTrib oficial.</p>'+
    ibsField(i,'IbsCst','CST IBS/CBS (3 dígitos)')+
    ibsField(i,'IbsClass','cClassTrib (6 dígitos)')+
    ibsField(i,'IbsBase','Base IBS/CBS (R$)')+
    ibsField(i,'IbsUfRate','Alíquota IBS UF (%)')+
    ibsField(i,'IbsMunRate','Alíquota IBS Município (%)')+
    ibsField(i,'IbsCbsRate','Alíquota CBS (%)')+
    '<details><summary>Redução de alíquota, se autorizada</summary>'+
    ibsField(i,'IbsReductionUf','Redução IBS UF (%)')+
    ibsField(i,'IbsReductionMun','Redução IBS Município (%)')+
    ibsField(i,'IbsReductionCbs','Redução CBS (%)')+'</details>'+
    '<details><summary>Diferimento, se autorizado</summary>'+
    ibsField(i,'IbsDeferralUf','Diferimento IBS UF (%)')+
    ibsField(i,'IbsDeferralMun','Diferimento IBS Município (%)')+
    ibsField(i,'IbsDeferralCbs','Diferimento CBS (%)')+'</details></details>';
  const itemRows=lines.map((line,i)=>'<fieldset class="form-stack"><legend>Item '+(i+1)+'''
s=replace_unique(s,old,new,str(ui))
s=replace_unique(s,
    "taxValues(i,'Icms')+taxValues(i,'Pis')+taxValues(i,'Cofins')+'</details></fieldset>').join('');",
    "taxValues(i,'Icms')+taxValues(i,'Pis')+taxValues(i,'Cofins')+'</details>'+ibsValues(i)+'</fieldset>').join('');",
    str(ui))
needle="      const body={company:addr('issuer'),"
helper='''      const typedIbs=i=>{
        const names=['Cst','Class','Base','UfRate','MunRate','CbsRate',
          'ReductionUf','ReductionMun','ReductionCbs',
          'DeferralUf','DeferralMun','DeferralCbs'];
        const selected=Object.fromEntries(names.map(key=>[key,String(o['item'+i+'Ibs'+key]||'').trim().replace(',','.')]));
        if(!Object.values(selected).some(Boolean))return null;
        return {cst:selected.Cst,cClassTrib:selected.Class,base:selected.Base,
          ufRate:selected.UfRate,munRate:selected.MunRate,cbsRate:selected.CbsRate,
          reductionUf:selected.ReductionUf,reductionMun:selected.ReductionMun,reductionCbs:selected.ReductionCbs,
          deferralUf:selected.DeferralUf,deferralMun:selected.DeferralMun,deferralCbs:selected.DeferralCbs};
      };
      const body={company:addr('issuer'),'''
s=replace_unique(s,needle,helper,str(ui))
needle="icms:taxes(i,'Icms'),pis:taxes(i,'Pis'),cofins:taxes(i,'Cofins')}))};"
s=replace_unique(s,needle,"icms:taxes(i,'Icms'),pis:taxes(i,'Pis'),cofins:taxes(i,'Cofins'),\n          ibscbs:typedIbs(i)}))};",str(ui))
ui.write_text(s)

backend=Path('src/platform/fiscal-tax-review.js')
s=backend.read_text()
anchor="   sections['COFINS'+suffix]=cofins;\n   gross+=Number(line.subtotalCents);"
addition='''   sections['COFINS'+suffix]=cofins;
   // IBS/CBS recebe somente valores tipados, jamais seções INI livres do navegador.
   if(chosen.ibscbs!=null){
     const input=chosen.ibscbs;
     if(typeof input!=='object'||Array.isArray(input))fail('IBS/CBS exige classificação tipada');
     const taxCst=match(input.cst,/^\\d{3}$/,'CST IBS/CBS');
     const taxClass=match(input.cClassTrib,/^\\d{6}$/,'cClassTrib');
     const base=taxMoney(input.base),baseCents=Math.round(Number(base)*100);
     const formatted=cents=>(cents/100).toFixed(2);
     const part=(nominalKey,reductionKey,deferralKey,pKey,vKey)=>{
       const pText=percentage(input[nominalKey]),nominal=Number(pText);
       const redText=String(input[reductionKey]??'').trim();
       const defText=String(input[deferralKey]??'').trim();
       if(redText&&defText)fail('IBS/CBS redução e diferimento simultâneos exigem revisão especializada');
       const reduced=redText?percentage(redText):null;
       const deferred=defText?percentage(defText):null;
       const effective=reduced===null?nominal:
         Math.round(nominal*(1-Number(reduced)/100)*10000)/10000;
       const accrued=Math.round(baseCents*effective/100);
       const withheld=deferred===null?0:Math.round(accrued*Number(deferred)/100);
       const values={[pKey]:pText,[vKey]:formatted(accrued-withheld)};
       if(reduced!==null){values.pRedAliq=reduced;values.pAliqEfet=effective.toFixed(4);}
       if(deferred!==null){values.pDif=deferred;values.vDif=formatted(withheld);}
       return values;
     };
     const uf=part('ufRate','reductionUf','deferralUf','pIBSUF','vIBSUF');
     const mun=part('munRate','reductionMun','deferralMun','pIBSMun','vIBSMun');
     const cbs=part('cbsRate','reductionCbs','deferralCbs','pCBS','vCBS');
     sections['IBSCBS'+suffix]={CST:taxCst,cClassTrib:taxClass};
     sections['gIBSCBS'+suffix]={vBC:base,vIBS:formatted(
       Math.round(Number(uf.vIBSUF)*100)+Math.round(Number(mun.vIBSMun)*100))};
     sections['gIBSUF'+suffix]=uf;
     sections['gIBSMun'+suffix]=mun;
     sections['gCBS'+suffix]=cbs;
   }
   gross+=Number(line.subtotalCents);'''
s=replace_unique(s,anchor,addition,str(backend))
backend.write_text(s)
print('COMPAT_FISCAL_TYPED_IBS_OK: tela e revisão canônica integradas')
