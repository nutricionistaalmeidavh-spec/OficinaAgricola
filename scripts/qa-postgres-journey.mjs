// Browser regression against the production PostgreSQL gateway in disposable CI.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

if(!process.env.POSTGRES_TEST_URL)throw Error('POSTGRES_TEST_URL obrigatório; sem fallback SQLite');
const viewportName=process.argv[2]||'desktop',output=path.resolve(process.argv[3]||'qa-artifacts/postgres');
const viewport={desktop:{width:1440,height:900},mobile:{width:390,height:844}}[viewportName];
if(!viewport)throw Error('Viewport inválido');
await mkdir(output,{recursive:true});
const base='http://127.0.0.1:3350',logs=[],errors=[];
const server=spawn(process.execPath,['src/start-postgres-unified.js'],{env:{...process.env,
  OFICINA_POSTGRES_REGISTRY_URL:process.env.POSTGRES_TEST_URL,
  OFICINA_POSTGRES_OPERATIONS_URL:process.env.POSTGRES_TEST_URL,
  OFICINA_POSTGRES_PORT:'3350',OFICINA_REGISTRY_NEW_INSTALL:'true',
  OFICINA_POSTGRES_PROVISION_NEW_UNITS:'true',OFICINA_POSTGRES_SCHEMA_PREFIX:'qaui',
  OFICINA_POSTGRES_STORAGE_ROOT:path.join(output,'storage'),
  OFICINA_QA_NATIVE_DEBUG:'1'},stdio:['ignore','pipe','pipe']});
server.stdout.on('data',chunk=>logs.push(String(chunk)));server.stderr.on('data',chunk=>logs.push(String(chunk)));
let browser,context,page;
const screenshot=name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
async function navigate(name){
  const button=page.locator('[data-page="'+name+'"]');
  if(await button.isVisible())await button.click();
  else{await page.locator('#mobileMoreBtn').click();await page.locator('[data-mobile-page="'+name+'"]').click();}
}
try{
  let ready=false;
  for(let n=0;n<120;n++){
    if(server.exitCode!==null)throw Error('Gateway encerrou: '+logs.join('').slice(-1500));
    try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready)throw Error('Gateway PostgreSQL não iniciou');
  browser=await chromium.launch({headless:true});context=await browser.newContext({viewport});page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.locator('#setupForm').waitFor({state:'visible'});
  await screenshot('01-primeiro-acesso');
  for(const [name,value] of Object.entries({name:'Gestor QA PostgreSQL',username:'gestorqa',password:'QAOnly@2026!Strong',confirmPassword:'QAOnly@2026!Strong'}))await page.locator('#setupForm [name="'+name+'"]').fill(value);
  await page.locator('#setupForm button[type=submit]').click();
  await page.locator('#loginForm').waitFor({state:'visible'});
  await page.locator('#loginForm [name=password]').fill('QAOnly@2026!Strong');
  await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#startFirstOrder').click();
  await page.locator('#osCustomer').selectOption('new');
  for(const [name,value] of Object.entries({newCustomerName:'Cliente contextual PG',newCustomerPhone:'16999990000',newMachineType:'Carro',newMachineBrand:'Fiat',newMachineModel:'Uno PG',newMachinePlate:'PGQ1A23'}))await page.locator('#modalBody [name="'+name+'"]').fill(value);
  await page.locator('#modalBody [name=problemReported]').fill('Ruído para diagnosticar');
  await screenshot('02-primeiro-atendimento-contextual');
  await page.locator('#modalBody button[type=submit]').click();
  await page.locator('#diagnosisForm').waitFor({state:'visible'});
  const os=await page.evaluate(async()=>{
    const customers=await api('/api/customers/page'),machines=await api('/api/machines/page'),orders=await api('/api/work-orders/page');
    if(customers.total!==1||machines.total!==1||orders.total!==1)throw Error('Cadastro contextual duplicado ou incompleto');
    return orders.items[0];
  });
  await page.locator('[data-status=DIAGNOSTICO]').click();await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('[data-oa-os="'+os.id+'"]').click();
  for(const text of ['Diagnóstico inicial','Diagnóstico revisado']){
    await page.locator('#diagnosisForm textarea').fill(text);
    const saved=page.waitForResponse(response=>response.url()===base+'/api/work-orders/'+os.id&&response.request().method()==='PATCH');
    await page.locator('#diagnosisForm button[type=submit]').click();assert.equal((await saved).status(),200);
    await page.waitForFunction(()=>!document.querySelector('#diagnosisForm button[type=submit]').disabled);
  }
  assert.equal(await page.evaluate(async id=>(await api('/api/work-orders/'+id)).diagnosis,os.id),'Diagnóstico revisado');
  await screenshot('03-diagnostico-consecutivo');
  await page.locator('#modalClose').click();
  const part=await page.evaluate(async()=>{
    const part=await api('/api/parts',{method:'POST',body:{requestId:newCommandId(),sku:'PG-UI-FILTRO',description:'Filtro UI PostgreSQL',barcode:'5901234123457',salePriceCents:2500}});
    await api('/api/inventory/movements',{method:'POST',body:{requestId:newCommandId(),partId:part.id,type:'ENTRADA',quantity:10}});
    await api('/api/cash/open',{method:'POST',body:{requestId:newCommandId(),openingCents:0}});return part;
  });
  await navigate('sales');await page.locator('#newSale').click();
  await page.locator('[data-sale-part] option[value="'+part.id+'"]').waitFor({state:'attached'});
  await page.locator('[data-sale-part]').selectOption(String(part.id));
  await page.locator('[data-sale-qty]').fill('2');await page.locator('#modalBody [name=discount]').fill('1');
  await page.locator('#salePreview').filter({hasText:'49,00'}).waitFor({state:'visible'});
  await screenshot('04-previa-venda');
  await page.evaluate(async id=>api('/api/parts/'+id,{method:'PATCH',body:{requestId:newCommandId(),salePriceCents:3000}}),part.id);
  await page.locator('#modalBody button[type=submit]').click();
  await page.locator('[data-form-error]').filter({hasText:'Preços alterados'}).waitFor({state:'visible'});
  assert.equal(await page.evaluate(async()=>(await api('/api/sales')).length),0);
  await page.locator('#salePreview').filter({hasText:'59,00'}).waitFor({state:'visible'});
  await screenshot('05-revisao-preco-sem-gravar');
  await page.locator('#modalBody button[type=submit]').click();await page.locator('#modal').waitFor({state:'hidden'});
  const result=await page.evaluate(async id=>({sales:await api('/api/sales'),part:await api('/api/parts/'+id)}),part.id);
  assert.equal(result.sales.length,1);assert.equal(Number(result.sales[0].total_cents),5900);assert.equal(Number(result.part.quantity),8);
  await screenshot('06-venda-confirmada');
  await navigate('inventory');
  await page.locator('#stockHistory').waitFor({state:'visible',timeout:6000}).catch(async()=>{
   const diagnostic=await page.evaluate(()=>({
    page:state.page,role:state.user?.role,ready:state.pageReady,
    content:document.querySelector('#content')?.textContent?.slice(0,1200),
    modalOpen:!document.querySelector('#modal')?.classList.contains('hidden'),
    modalDirty:modalSession?.dirty,
    title:document.querySelector('#pageTitle')?.textContent
   }));
   throw Error('Falha ao abrir estoque: '+JSON.stringify(diagnostic));
  });
  await page.locator('#stockHistory').click();
  await page.locator('#inventoryHistoryRows').getByText('PG-UI-FILTRO').first().waitFor();
  await page.locator('#inventoryHistoryType').selectOption('SAIDA_MANUAL');
  await page.locator('#inventoryHistoryFilter').click();
  await page.locator('#inventoryHistoryRows').getByText('PG-UI-FILTRO').first().waitFor();
  await screenshot('07-historico-estoque');
  await page.locator('#modalClose').click();
  await page.locator('#suppliersManage').click();
  await page.locator('#supplierNew').click();
  await page.locator('#modalBody [name=name]').fill('Fornecedor UI QA');
  await page.locator('#modalBody button[type=submit]').click();
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('#purchaseNew').click();
  await page.locator('#modalBody [name=supplierId]').selectOption({label:'Fornecedor UI QA'});
  await page.locator('[data-part-id] option[value="'+part.id+'"]').waitFor({state:'attached'});
  await page.locator('[data-part-id]').selectOption(String(part.id));
  await page.locator('[data-purchase-qty]').fill('3');
  await page.locator('[data-purchase-cost]').fill('12.50');
  await screenshot('08-pedido-compra');
  await page.locator('#modalBody button[type=submit]').click();
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('[data-purchase-open]').first().click();
  await page.locator('[data-receive-item]').fill('2');
  await screenshot('09-recebimento-parcial');
  await page.locator('#modalBody button[type=submit]').click();
  await page.locator('#modal').waitFor({state:'hidden'});
  const afterPurchase=await page.evaluate(async id=>({
   part:await api('/api/parts/'+id),orders:await api('/api/purchases/orders')
  }),part.id);
  assert.equal(Number(afterPurchase.part.quantity),10);
  assert.equal(afterPurchase.orders[0].status,'PARCIAL');
  await screenshot('10-estoque-compra-confirmada');
  await page.locator('#content [data-barcode-panel] [data-barcode-input]').fill('5901234123457');
  await page.locator('#content [data-barcode-panel] [data-barcode-input]').press('Enter');
  await page.locator('#content [data-barcode-panel] [data-barcode-status]').filter({hasText:'PG-UI-FILTRO'}).waitFor({state:'visible'});
  await screenshot('11-leitor-usb-ean-consulta');
  await page.locator('#stocktakeOpen').click();
  await page.locator('#startStocktakePage').click();
  await page.locator('[data-stocktake-count]').first().waitFor({state:'visible'});
  await screenshot('12-inventario-fisico');
  const qtyInputs=await page.locator('[data-stocktake-count]').count();
  assert.ok(qtyInputs>0);
  await page.evaluate(async()=>{
   for(const field of document.querySelectorAll('[data-stocktake-count]')){
    const part=await api('/api/parts/'+field.dataset.stocktakeCount);
    field.value=String(part.quantity);
    field.dispatchEvent(new Event('input',{bubbles:true}));
   }
  });
  await page.locator('#modalBody form button[type=submit]').click();
  await page.locator('#applyStocktake').waitFor({state:'visible'});
  await page.locator('#stocktakeReason').fill('Conferência presencial de estoque');
  await screenshot('13-inventario-conferido');
  await page.locator('#applyStocktake').click();
  await page.waitForFunction(async()=>{
   const takes=await api('/api/inventory/stocktakes');
   return takes[0]?.status==='APLICADO';
  });
  const afterCount=await page.evaluate(async id=>api('/api/parts/'+id),part.id);
  assert.equal(Number(afterCount.quantity),10);

  // P0: RBAC real de ponta a ponta (UI + HTTP), sem mocks nem contas de produção.
  const rolePassword='QAOnly@2026!Role';
  const qaRoles=[
    {role:'ATENDIMENTO',username:'qa-atendimento-pg',name:'Atendimento QA'},
    {role:'TECNICO',username:'qa-tecnico-pg',name:'Técnico QA'},
    {role:'FINANCEIRO',username:'qa-financeiro-pg',name:'Financeiro QA'}
  ];
  // O apply e o refresh da página são assíncronos: não tentar sair durante um salvamento.
  await page.waitForFunction(()=>!modalSession?.busy&&!state.pageSaving);
  await page.locator('#modalClose').click();
  // O motivo de inventário marca o modal como editado; confirmar descarte da UI.
  const discard=page.locator('#modalDiscardPrompt [data-discard-edit]');
  if(await discard.isVisible())await discard.click();
  if(await page.locator('#modal').isVisible()){
    const diagnostic=await page.evaluate(()=>({busy:modalSession?.busy,dirty:modalSession?.dirty,
      prompt:!!document.querySelector('#modalDiscardPrompt'),title:document.querySelector('#modalTitle')?.textContent,
      page:state.page,saving:state.pageSaving,modal:document.querySelector('#modal')?.className}));
    throw Error('Inventário não liberou o fechamento do modal: '+JSON.stringify(diagnostic));
  }
  await navigate('settings');
  for(const user of qaRoles){
    await page.locator('#newUser').click();
    await page.locator('#modalBody [name=name]').fill(user.name);
    await page.locator('#modalBody [name=username]').fill(user.username);
    await page.locator('#modalBody [name=role]').selectOption(user.role);
    await page.locator('#modalBody [name=password]').fill(rolePassword);
    const created=page.waitForResponse(response=>response.url()===base+'/api/users'&&response.request().method()==='POST');
    await page.locator('#modalBody button[type=submit]').click();
    assert.equal((await created).status(),201,'Criação do funcionário '+user.role);
    await page.locator('#modal').waitFor({state:'hidden'});
  }
  await screenshot('14-equipe-acessos');
  async function navigateAs(rolePage,name){
    const direct=rolePage.locator('[data-page="'+name+'"]');
    if(await direct.isVisible())await direct.click();
    else{
      await rolePage.locator('#mobileMoreBtn').click();
      await rolePage.locator('[data-mobile-page="'+name+'"]').click();
    }
  }
  for(const user of qaRoles){
    const roleContext=await browser.newContext({viewport});
    try{
      const rolePage=await roleContext.newPage();
      rolePage.on('pageerror',error=>errors.push(user.role+': '+error.message));
      await rolePage.goto(base);
      await rolePage.locator('#loginForm [name=username]').fill(user.username);
      await rolePage.locator('#loginForm [name=password]').fill(rolePassword);
      await rolePage.locator('#loginForm button[type=submit]').click();
      await rolePage.locator('#appView').waitFor({state:'visible'});
      assert.equal((await rolePage.locator('#userRole').textContent()).trim(),
        {ATENDIMENTO:'Atendimento',TECNICO:'Técnico',FINANCEIRO:'Financeiro'}[user.role]);

      // Tentativas HTTP diretas comprovam autorização no servidor, não apenas botões ocultos.
      const denied=await rolePage.evaluate(async ids=>{
        const request=async(method,path,body)=>{
          const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},
            body:body===undefined?undefined:JSON.stringify(body)});
          return response.status;
        };
        return {
          users:await request('GET','/api/users'),
          receipt:ids.role==='FINANCEIRO'?null:await request('POST','/api/work-orders/'+ids.osId+'/receipts',
            {amountCents:100,method:'PIX',requestId:'qa-rbac-unauthorized-'+ids.role}),
          customer:ids.role==='ATENDIMENTO'?null:await request('POST','/api/customers',
            {name:'Nao pode cadastrar por '+ids.role,requestId:'qa-rbac-customer-'+ids.role}),
          quote:ids.role!=='FINANCEIRO'?null:await request('PUT','/api/work-orders/'+ids.osId+'/quote',
            {items:[{kind:'MAO_DE_OBRA',description:'Alteração proibida',quantity:1,unitPriceCents:90000}]}),
          saleCancel:ids.role==='FINANCEIRO'?null:await request('POST','/api/sales/'+ids.saleId+'/cancel',
            {reason:'Tentativa não autorizada',requestId:'qa-rbac-cancel-'+ids.role})
        };
      },{osId:os.id,saleId:result.sales[0].id,role:user.role});
      assert.equal(denied.users,403,'Funcionário não lê cadastros de usuários');
      if(user.role!=='FINANCEIRO')assert.equal(denied.receipt,403,'Sem acesso a recebimentos da OS');
      if(user.role==='TECNICO'){
        assert.equal(denied.customer,403,'Técnico não cadastra cliente');
        assert.equal(denied.saleCancel,403,'Técnico não cancela vendas');
        await navigateAs(rolePage,'work-orders');
        await rolePage.locator('[data-oa-os="'+os.id+'"]').click();
        assert.equal(await rolePage.locator('#payBtn').count(),0,'Técnico sem botão de recebimento');
        assert.equal(await rolePage.locator('#quoteBtn').count(),0,'Técnico sem edição de orçamento');
        await rolePage.locator('#diagnosisForm textarea').fill('Diagnóstico técnico validado pelo perfil');
        const saved=rolePage.waitForResponse(response=>response.url()===base+'/api/work-orders/'+os.id&&response.request().method()==='PATCH');
        await rolePage.locator('#diagnosisForm button[type=submit]').click();
        assert.equal((await saved).status(),200,'Técnico salva diagnóstico permitido');
      }else if(user.role==='ATENDIMENTO'){
        assert.equal(denied.saleCancel,403,'Atendimento não pode cancelar venda');
        await navigateAs(rolePage,'customers');
        await rolePage.locator('#newCustomer').click();
        await rolePage.locator('#modalBody [name=name]').fill('Cliente cadastrado pelo atendimento QA');
        const created=rolePage.waitForResponse(response=>response.url()===base+'/api/customers'&&response.request().method()==='POST');
        await rolePage.locator('#modalBody button[type=submit]').click();
        assert.ok([200,201].includes((await created).status()),'Atendimento cadastra cliente');
      }else{
        assert.equal(denied.quote,403,'Financeiro não altera orçamento');
        assert.equal(denied.customer,403,'Financeiro não cadastra cliente');
        await navigateAs(rolePage,'sales');
        await rolePage.locator('[data-sale="'+result.sales[0].id+'"]').click();
        await rolePage.locator('#cancelSale').waitFor({state:'visible'});
        await rolePage.locator('#cancelSale').click();
        await rolePage.locator('#modalBody textarea[name=reason]').fill('Devolução autorizada e registrada pelo financeiro QA');
        const canceled=rolePage.waitForResponse(response=>response.url()===base+'/api/sales/'+result.sales[0].id+'/cancel'&&response.request().method()==='POST');
        await rolePage.locator('#modalBody button[type=submit]').click();
        assert.equal((await canceled).status(),200,'Financeiro cancela venda pela interface');
        await rolePage.locator('#modal').waitFor({state:'hidden'});
      }
      await rolePage.screenshot({path:path.join(output,'15-perfil-'+user.role.toLowerCase()+'.png'),fullPage:true});
    }finally{
      await roleContext.close();
    }
  }
  const afterCancellation=await page.evaluate(async ids=>({
    sale:await api('/api/sales/'+ids.saleId),
    part:await api('/api/parts/'+ids.partId),
    customers:await api('/api/customers/page')
  }),{saleId:result.sales[0].id,partId:part.id});
  assert.equal(afterCancellation.sale.status,'CANCELADA','Venda cancelada permanece no histórico');
  assert.equal(Number(afterCancellation.part.quantity),12,'Estorno repõe duas peças exatamente uma vez');
  assert.equal(afterCancellation.customers.total,2,'Cadastro feito pelo atendimento persiste');
  await screenshot('16-saldo-apos-estorno');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'summary.json'),JSON.stringify({status:'passed',engine:'postgres',viewport:viewportName,checks:['first-admin-ui','contextual-customer-machine-order','diagnosis-save-twice','sale-preview','price-conflict-no-write','sale-confirmed-stock-once','inventory-history-ui','supplier-create-ui','purchase-order-ui','partial-receipt-ui','barcode-usb-keyboard-ui','physical-stocktake-review-ui','rbac-admin-ui','rbac-roles-login-ui','rbac-forbidden-http','rbac-technician-diagnosis-ui','rbac-attendance-customer-ui','finance-sale-cancel-ui','stock-restored-once']},null,2));
}catch(error){
  if(page){
    const observed=await page.evaluate(async()=>{
      const read=async path=>{try{const r=await fetch(path);return {status:r.status,body:(await r.text()).slice(0,500)}}catch(e){return {error:String(e)}}};
      return {forms:[...document.querySelectorAll('#loginForm,#setupForm,#licenseForm')].map(e=>({id:e.id,className:e.className,hidden:e.hidden})),
        license:await read('/api/license/status'),setup:await read('/api/setup/status')};
    }).catch(error=>({diagnosticError:String(error)}));
    console.error('QA primeiro acesso:',JSON.stringify({observed,errors}));
  }
  const diagnostic=logs.join('').split(/\r?\n/).filter(line=>line.includes('[qa-native-error]')).slice(-8);
  if(diagnostic.length)console.error('SQL QA trace:\n'+diagnostic.join('\n'));
  if(page)await screenshot('failure').catch(()=>{});
  await writeFile(path.join(output,'summary.json'),JSON.stringify({status:'failed',error:error.message,errors},null,2));throw error;
}finally{
  await context?.close().catch(()=>{});await browser?.close().catch(()=>{});server.kill('SIGTERM');
  await writeFile(path.join(output,'server.log'),logs.join(''));
}
