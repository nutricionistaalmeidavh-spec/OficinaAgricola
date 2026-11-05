import assert from 'node:assert/strict';
import path from 'node:path';

// Runs in the same isolated browser/database as qa-demo, with no paid service.
export async function verifyUiContract(page,viewportName,outputDir){
  const original=page.viewportSize();
  const findings=[];
  for(const width of viewportName==='mobile'?[320,390,840]:[1024,1440]){
    await page.setViewportSize({width,height:width===320?568:900});
    await page.locator('#globalSearch').waitFor({state:'visible'});
    const geometry=await page.evaluate(()=>{
      const rect=el=>el.getBoundingClientRect();
      const status=rect(document.querySelector('#serverStatus'));
      const content=rect(document.querySelector('#content'));
      const buttons=[...document.querySelectorAll('#nav button')];
      const labels=buttons.map(button=>{
        const b=rect(button),label=rect(button.querySelector('b'));
        return {text:button.textContent.trim(),fits:label.left>=b.left-1&&label.right<=b.right+1&&label.top>=b.top-1&&label.bottom<=b.bottom+1};
      });
      // Resolve translucent backgrounds through ancestors before comparing contrast.
      const rgba=value=>(value.match(/[\d.]+/g)||[]).map(Number);
      const background=el=>{
        if(!el)return [255,255,255];
        const c=rgba(getComputedStyle(el).backgroundColor),alpha=c[3]??1;
        const below=alpha<1?background(el.parentElement):[0,0,0];
        return c.slice(0,3).map((v,i)=>v*alpha+below[i]*(1-alpha));
      };
      const luminance=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
        .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const contrast=el=>{
        const a=luminance(rgba(getComputedStyle(el).color).slice(0,3)),b=luminance(background(el));
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      };
      const contrasts=buttons.map(el=>({text:el.textContent.trim(),ratio:contrast(el)}));
      return {overflow:document.documentElement.scrollWidth>innerWidth,statusOverlaps:status.bottom>content.top,labels,contrasts,
        statusPosition:getComputedStyle(document.querySelector('#serverStatus')).position,
        searchVisible:!!document.querySelector('#globalSearch').getClientRects().length};
    });
    assert.ok(geometry.contrasts.every(item=>item.ratio>=4.5),`Nav contrast below AA: ${JSON.stringify(geometry.contrasts)}`);
    assert.equal(geometry.overflow,false,`Page overflows at ${width}px`);
    assert.equal(geometry.statusOverlaps,false,'Server status obscures content');
    assert.equal(geometry.statusPosition,'static');
    assert.equal(geometry.searchVisible,true);
    assert.ok(geometry.labels.every(item=>item.fits),`Nav labels overlap: ${JSON.stringify(geometry.labels)}`);
    if(width<=840){
      // Configurações está no menu Mais: o destino equivalente no nav principal é oculto.
      const more=page.locator('#mobileMoreBtn');
      await more.waitFor({state:'visible'});
      await more.click();
      const settings=page.locator('#mobileMorePanel [data-mobile-page="settings"]');
      await settings.waitFor({state:'visible'});
      const last=await settings.boundingBox();
      assert.ok(last&&last.x>=0&&last.x+last.width<=width,'Last menu item is unreachable');
      assert.equal(await more.getAttribute('aria-expanded'),'true');
      await more.click();
      await settings.waitFor({state:'hidden'});
    }else{
      await page.locator('[data-page="settings"]').scrollIntoViewIfNeeded();
    }
    findings.push({width,...geometry});
  }
  await page.setViewportSize(original);
  const customersNav=page.locator('[data-page="customers"]');
  if(await customersNav.isVisible())await customersNav.click();
  else{
    const more=page.locator('#mobileMoreBtn');
    await more.click();
    const customersMobile=page.locator('#mobileMorePanel [data-mobile-page="customers"]');
    await customersMobile.waitFor({state:'visible'});
    await customersMobile.click();
  }
  await page.locator('#newCustomer').click();
  const dialog=page.getByRole('dialog',{name:'Novo cliente',exact:true});
  await dialog.waitFor({state:'visible'});
  assert.equal(await page.locator('#appView').evaluate(el=>el.inert),true);
  assert.equal(await page.evaluate(()=>document.querySelector('[role="dialog"]').contains(document.activeElement)),true);
  const last=dialog.locator('button[type="submit"]');
  await last.focus();await page.keyboard.press('Tab');
  assert.equal(await page.locator('#modalClose').evaluate(el=>el===document.activeElement),true,'Tab escaped dialog');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await last.evaluate(el=>el===document.activeElement),true,'Shift+Tab escaped dialog');
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  assert.equal(await page.locator('#newCustomer').evaluate(el=>el===document.activeElement),true,'Dialog failed to restore trigger focus');
  assert.equal(await page.locator('#appView').evaluate(el=>el.inert),false);

  // A confirmed server rejection keeps the form, error and draft available for recovery.
  await page.locator('#newCustomer').click();
  await dialog.locator('input[name="name"]').fill('Rascunho de falha QA');
  const reject=route=>route.request().method()==='POST'
    ?route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'Falha temporária de QA'})})
    :route.continue();
  await page.route('**/api/customers',reject);
  await last.click();
  await dialog.locator('[data-form-error]').waitFor({state:'visible'});
  assert.equal(await dialog.locator('input[name="name"]').inputValue(),'Rascunho de falha QA');
  await page.unroute('**/api/customers',reject);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Continuar editando',exact:true}).waitFor({state:'visible'});
  await page.getByRole('button',{name:'Continuar editando',exact:true}).click();
  assert.equal(await dialog.locator('input[name="name"]').inputValue(),'Rascunho de falha QA');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Descartar alterações',exact:true}).click();
  await dialog.waitFor({state:'hidden'});

  const search=page.locator('#globalSearch');
  await search.fill('zz-sem-resultado-qa');
  await page.getByRole('button',{name:'Buscar',exact:true}).click();
  await page.getByRole('dialog').getByText('Nenhum cliente, máquina ou OS encontrado.').waitFor({state:'visible'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Limpar busca'}).click();
  assert.equal(await search.inputValue(),'');
  assert.equal(await search.evaluate(el=>el===document.activeElement),true);
  await search.fill('João');await search.press('Enter');
  await page.getByRole('dialog').getByText('Ordens de Serviço',{exact:true}).waitFor({state:'visible'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Limpar busca'}).click();

  // Regressão P0: desistir do cancelamento nunca solicita estorno ao servidor.
  const fakeSale={
    id:999992,sale_number:992,status:'CONCLUIDA',customer_name:'Cliente QA',
    created_at:'2026-11-03T12:00:00.000Z',payment_method:'DINHEIRO',
    total_cents:3500,subtotal_cents:3500,discount_cents:0,
    items:[{description:'Peça QA',quantity:1,unit_price_cents:3500,total_cents:3500}]
  };
  let cancelRequests=0,cancelBody=null;
  const salesRoute=async route=>{
    const url=new URL(route.request().url()),method=route.request().method();
    if(url.pathname==='/api/sales/page'&&method==='GET')
      return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({items:[fakeSale],total:1,nextCursor:null})});
    if(url.pathname==='/api/sales'&&method==='GET')
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([fakeSale])});
    if(url.pathname==='/api/sales/'+fakeSale.id&&method==='GET')
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fakeSale)});
    if(url.pathname==='/api/sales/'+fakeSale.id+'/cancel'&&method==='POST'){
      cancelRequests++;cancelBody=route.request().postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...fakeSale,status:'CANCELADA'})});
    }
    return route.continue();
  };
  await page.route('**/api/sales**',salesRoute);
  if(viewportName==='mobile'){
    await page.locator('#mobileMoreBtn').click();
    await page.locator('[data-mobile-page="sales"]').click();
  }else await page.locator('[data-page="sales"]').click();
  await page.locator('[data-sale="'+fakeSale.id+'"]').click();
  await page.locator('#cancelSale').click();
  const cancelDialog=page.getByRole('dialog',{name:'Confirmar cancelamento da venda #'+fakeSale.sale_number});
  await cancelDialog.waitFor({state:'visible'});
  assert.equal(await cancelDialog.locator('textarea[name="reason"]').getAttribute('required'),'');
  await cancelDialog.getByRole('button',{name:'Manter venda'}).click();
  assert.equal(cancelRequests,0,'Cancelar o formulário disparou uma transação financeira');
  await page.locator('[data-sale="'+fakeSale.id+'"]').click();
  await page.locator('#cancelSale').click();
  await cancelDialog.getByRole('button',{name:'Confirmar cancelamento e estorno'}).click();
  assert.equal(cancelRequests,0,'Validação HTML permitiu motivo vazio');
  await cancelDialog.locator('textarea[name="reason"]').fill('Devolução aprovada QA');
  await cancelDialog.getByRole('button',{name:'Confirmar cancelamento e estorno'}).click();
  await cancelDialog.waitFor({state:'hidden'});
  assert.equal(cancelRequests,1);
  assert.equal(cancelBody.reason,'Devolução aprovada QA');
  assert.ok(cancelBody.requestId,'Falta chave de idempotência na confirmação');
  await page.unroute('**/api/sales**',salesRoute);

  // P1: seleção fiscal é por operação pesquisável, não por ID interno.
  if(viewportName==='mobile'){
    await page.locator('#mobileMoreBtn').click();
    await page.locator('[data-mobile-page="fiscal"]').click();
  }else await page.locator('[data-page="fiscal"]').click();
  try{
    await page.locator('#fiscalNew').waitFor({state:'visible',timeout:8000});
  }catch(error){
    const message=await page.locator('#content').innerText().catch(()=>'(sem conteúdo)');
    const pageName=await page.evaluate(()=>state?.page||'desconhecida').catch(()=>'desconhecida');
    throw new Error('QA: página fiscal não carregou. Página='+pageName+
      ', conteúdo='+message.slice(0,1000),{cause:error});
  }
  await page.locator('#fiscalNew').click();
  const fiscalDialog=page.getByRole('dialog',{name:'Preparar documento fiscal'});
  await fiscalDialog.waitFor({state:'visible'});
  assert.equal(await fiscalDialog.locator('#fiscalDraftSubmit').isDisabled(),true);
  await fiscalDialog.locator('#fiscalOriginType').selectOption('SALE');
  await fiscalDialog.locator('#fiscalOriginSearch').fill('zz-venda-inexistente-qa');
  await fiscalDialog.getByText('Nenhuma operação encontrada. Tente outro número ou nome.').waitFor({state:'visible'});
  assert.equal(await fiscalDialog.locator('#fiscalDraftSubmit').isDisabled(),true);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Descartar alterações',exact:true}).click();
  await fiscalDialog.waitFor({state:'hidden'});

  await page.locator('[data-page="dashboard"]').click();
  await page.locator('.oa-order-mini').first().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor({state:'visible'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.oa-order-mini').first().evaluate(el=>el===document.activeElement),true);
  // Hide the intentionally generated error toast before recording the normal UI.
  await page.evaluate(()=>document.querySelector('#toast').classList.add('hidden'));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:path.join(outputDir,'09-ui-accessible.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#pageTitle').click();
  return findings;
}
