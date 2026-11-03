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
      return {overflow:document.documentElement.scrollWidth>innerWidth,statusOverlaps:status.bottom>content.top,labels,
        statusPosition:getComputedStyle(document.querySelector('#serverStatus')).position,
        searchVisible:!!document.querySelector('#globalSearch').getClientRects().length};
    });
    assert.equal(geometry.overflow,false,`Page overflows at ${width}px`);
    assert.equal(geometry.statusOverlaps,false,'Server status obscures content');
    assert.equal(geometry.statusPosition,'static');
    assert.equal(geometry.searchVisible,true);
    assert.ok(geometry.labels.every(item=>item.fits),`Nav labels overlap: ${JSON.stringify(geometry.labels)}`);
    await page.locator('[data-page="settings"]').scrollIntoViewIfNeeded();
    if(width<=840){
      const last=await page.locator('[data-page="settings"]').boundingBox();
      assert.ok(last.x>=0&&last.x+last.width<=width,'Last menu item is unreachable');
    }
    findings.push({width,...geometry});
  }
  await page.setViewportSize(original);
  await page.locator('[data-page="customers"]').click();
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

  await page.locator('[data-page="dashboard"]').click();
  await page.locator('.oa-order-mini').first().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor({state:'visible'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.oa-order-mini').first().evaluate(el=>el===document.activeElement),true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:path.join(outputDir,'09-ui-accessible.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'no-preference'});
  return findings;
}
