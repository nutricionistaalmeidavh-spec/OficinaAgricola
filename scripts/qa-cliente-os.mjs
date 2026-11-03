import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const viewportName = process.argv[2] || 'desktop';
const outputDir = path.resolve(process.argv[3] || 'qa-artifacts/jornada');
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
if (!viewports[viewportName]) throw new Error('Viewport invalido: ' + viewportName);
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const logs = [];
const server = spawn(process.execPath, ['src/start.js'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: '3344',
    DATABASE_PATH: '.qa/artisys-oficina.sqlite', STORAGE_DIR: '.qa/uploads' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stdout.on('data', data => logs.push(data.toString()));
server.stderr.on('data', data => logs.push(data.toString()));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function navigate(page, name) {
  const direct = page.locator('[data-page="' + name + '"]');
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await page.locator('#mobileMoreBtn').click();
  await page.locator('#mobileMorePanel [data-mobile-page="' + name + '"]').click();
}
async function healthy() {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('Servidor encerrou durante inicializacao');
    try {
      const response = await fetch('http://127.0.0.1:3344/api/health');
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Servidor nao iniciou em 30 segundos');
}

let browser, context, page;
const errors = [];
try {
  await healthy();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: viewports[viewportName], acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('http://127.0.0.1:3344', { waitUntil: 'domcontentloaded' });
  await page.locator('#loginForm input[name="username"]').fill('admin');
  await page.locator('#loginForm input[name="password"]').fill('Admin@1234');
  await page.locator('#loginForm button[type="submit"]').click();
  await page.locator('#appView').waitFor({ state: 'visible' });

  // Etapa 1: cliente novo pela UI real.
  const clientName = 'Cliente Jornada Oficina E2E';
  await navigate(page, 'customers');
  await page.locator('#newCustomer').click();
  await page.locator('#modalBody input[name="name"]').fill(clientName);
  await page.locator('#modalBody input[name="phone"]').fill('16999990000');
  await page.locator('#modalBody input[name="email"]').fill('jornada@example.invalid');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#content').filter({ hasText: clientName }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, '01-cliente.png'), fullPage: true });

  // Etapa 2: carro registrado e associado ao cliente pela UI.
  await navigate(page, 'machines');
  await page.locator('#newMachine').click();
  await page.locator('#modalBody select[name="customerId"]').selectOption({ label: clientName });
  await page.locator('#modalBody input[name="type"]').fill('Carro');
  await page.locator('#modalBody input[name="brand"]').fill('Volkswagen');
  await page.locator('#modalBody input[name="model"]').fill('Gol Jornada');
  await page.locator('#modalBody input[name="plate"]').fill('JRN1A23');
  await page.locator('#modalBody input[name="vin"]').fill('9BWZZZ377VT004251');
  await page.locator('#modalBody input[name="odometerKm"]').fill('48200');
  await page.locator('#modalBody input[name="renavam"]').fill('12345678901');
  await page.locator('#modalBody input[name="engine"]').fill('1.6 MSI');
  await page.locator('#modalBody select[name="fuelType"]').selectOption('FLEX');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#content').filter({ hasText: 'JRN1A23' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, '02-veiculo.png'), fullPage: true });

  // Etapa 3: abrir OS apenas com veiculo do cliente.
  await navigate(page, 'work-orders');
  await page.locator('#newOS').click();
  await page.locator('#osCustomer').selectOption({ label: clientName });
  await page.locator('#osMachine').selectOption({ index: 1 });
  await page.locator('#modalBody textarea[name="problemReported"]').fill('Falha no motor e revisao preventiva');
  await page.locator('#modalBody select[name="priority"]').selectOption('ALTA');
  await page.locator('#modalBody button[type="submit"]').click();
  const card = page.locator('.os-card').filter({ hasText: clientName }).first();
  await card.waitFor({ state: 'visible' });
  const osId = await card.getAttribute('data-os');
  if (!osId) throw new Error('OS criada sem identificador no DOM');
  await card.click();
  await page.locator('[data-status="DIAGNOSTICO"]').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, '03-os-entrada.png'), fullPage: true });

  // Etapa 4: diagnostico, orcamento e aprovacao.
  await page.locator('[data-status="DIAGNOSTICO"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('.os-card[data-os="' + osId + '"]').click();
  await page.locator('#diagnosisForm textarea[name="diagnosis"]').fill('Filtro saturado; necessita manutencao');
  await page.locator('#diagnosisForm button[type="submit"]').click();
  await page.getByRole('status').filter({ hasText: 'Diagnóstico salvo' }).waitFor({ state: 'visible' });
  await page.locator('#modalClose').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('.os-card[data-os="' + osId + '"]').click();
  await page.locator('#quoteBtn').click();
  await page.locator('#quoteItems [data-q-description]').first().fill('Revisao e substituicao de filtro');
  await page.locator('#quoteItems [data-q-quantity]').first().fill('1');
  await page.locator('#quoteItems [data-q-price]').first().fill('220');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#submitQuote').waitFor({ state: 'visible' });
  await page.locator('#submitQuote').click();
  await page.locator('#approveQuote').waitFor({ state: 'visible' });
  await page.locator('#approveQuote').click();
  await page.locator('#payBtn').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, '04-orcamento-aprovado.png'), fullPage: true });

  // Etapa 5: pagamento e entrega - sem dependencia de API paga.
  await page.locator('#payBtn').click();
  await page.locator('#modalBody input[name="amount"]').fill('220');
  await page.locator('#modalBody select[name="method"]').selectOption('PIX');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#modalBody').filter({ hasText: 'PAGO' }).waitFor({ state: 'visible' });
  await page.locator('[data-status="EM_SERVICO"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('.os-card[data-os="' + osId + '"]').click();
  await page.locator('[data-status="PRONTA"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('.os-card[data-os="' + osId + '"]').click();
  await page.locator('[data-status="ENTREGUE"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  const archiveCard = page.locator('#osArchiveRows .os-card[data-os="' + osId + '"]');
  await archiveCard.waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, '05-os-entregue.png'), fullPage: true });

  // Etapa 6: PDF e historico consultados na OS fechada.
  await archiveCard.click();
  await page.locator('#pdfOS').waitFor({ state: 'visible' });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#pdfOS').click()
  ]);
  if (!download.suggestedFilename().endsWith('.pdf')) throw new Error('PDF sem extensao correta');
  await page.locator('#historyOS').click();
  await page.locator('#modalTitle').filter({ hasText: 'Histórico da OS' }).waitFor({ state: 'visible' });
  await page.locator('#modalBody').filter({ hasText: 'ENTREGUE' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, '06-historico-os.png'), fullPage: true });
  // Etapa 7: caminhos alternativos reais na interface: reprovar, revisar e aprovar.
  await page.locator('#modalClose').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await navigate(page, 'work-orders');
  const secondCard = page.locator('.os-card').filter({ hasText: 'Empresa Alfa' }).first();
  await secondCard.waitFor({ state: 'visible' });
  const exceptionId = await secondCard.getAttribute('data-os');
  if (!exceptionId) throw new Error('OS da Empresa Alfa sem identificador');
  await secondCard.click();
  await page.locator('#rejectQuote').waitFor({ state: 'visible' });
  page.once('dialog', dialog => dialog.accept('Cliente pediu revisao de preco'));
  await page.locator('#rejectQuote').click();
  await page.locator('#quoteBtn').waitFor({ state: 'visible' });
  await page.locator('#quoteBtn').click();
  await page.locator('#quoteItems [data-q-price]').first().fill('179');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#submitQuote').waitFor({ state: 'visible' });
  await page.locator('#submitQuote').click();
  await page.locator('#approveQuote').waitFor({ state: 'visible' });
  await page.locator('#approveQuote').click();
  await page.locator('[data-status="EM_SERVICO"]').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, '07-reprovado-revisado-aprovado.png'), fullPage: true });

  // Etapa 8: estoque/financeiro com estornos visiveis e rastreaveis.
  // Apenas os dados de preparacao sao criados pela API; consumo e estorno sao clicados na UI.
  const seedPart = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json' };
    const post = async (endpoint, body) => {
      const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(endpoint + ': ' + await response.text());
      return response.json();
    };
    const part = await post('/api/parts', { sku: 'QA-E2E-STORNO', description: 'Filtro teste de estorno', salePriceCents: 1500 });
    await post('/api/inventory/movements', { partId: part.id, type: 'ENTRADA', quantity: 3 });
    return part.id;
  });
  if (!seedPart) throw new Error('Peca de QA nao foi criada');
  await page.locator('#partBtn').click();
  await page.locator('#modalBody select[name="partId"]').selectOption(String(seedPart));
  await page.locator('#modalBody input[name="quantity"]').fill('1');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('[data-reverse-part]').waitFor({ state: 'visible' });
  page.once('dialog', dialog => dialog.accept('Peca devolvida ao estoque'));
  await page.locator('[data-reverse-part]').click();
  await page.locator('[data-reverse-part]').waitFor({ state: 'hidden' });
  await page.locator('#modalBody').filter({ hasText: 'ESTORNADO' }).waitFor({ state: 'visible' });

  await page.locator('#payBtn').click();
  await page.locator('#modalBody input[name="amount"]').fill('10');
  await page.locator('#modalBody select[name="method"]').selectOption('PIX');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('[data-reverse-receipt]').waitFor({ state: 'visible' });
  const reverseDialogs = dialog => dialog.accept(dialog.type() === 'prompt' ? 'Pagamento devolvido ao cliente' : undefined);
  page.on('dialog', reverseDialogs);
  await page.locator('[data-reverse-receipt]').click();
  await page.locator('[data-reverse-receipt]').waitFor({ state: 'hidden' });
  page.off('dialog', reverseDialogs);
  await page.screenshot({ path: path.join(outputDir, '08-estoque-e-financeiro-estornados.png'), fullPage: true });

  // Etapa 9: interrupcao real da rede do navegador, seguida de replay da mesma acao.
  await context.setOffline(true);
  await page.locator('[data-status="EM_SERVICO"]').click();
  await sleep(450);
  if (!(await page.locator('#modal').isVisible())) throw new Error('UI fechou OS sem confirmar a operacao offline');
  await context.setOffline(false);
  await page.locator('[data-status="EM_SERVICO"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  const afterOffline = page.locator('.os-card[data-os="' + exceptionId + '"]');
  await afterOffline.waitFor({ state: 'visible' });
  await afterOffline.click();
  const statusHistory = await page.evaluate(async id => {
    const response = await fetch('/api/work-orders/' + id + '/history');
    if (!response.ok) throw new Error('Falha ao ler historico apos offline');
    return response.json();
  }, exceptionId);
  if (statusHistory.filter(entry => entry.type === 'STATUS' && entry.new_value === 'EM_SERVICO').length !== 1)
    throw new Error('Replay offline produziu mudanca de status duplicada');

  // Etapa 10: cancelamento explicito com motivo e dupla confirmacao.
  await page.locator('[data-status="CANCELADA"]').waitFor({ state: 'visible' });
  const cancelDialogs = dialog => dialog.accept(dialog.type() === 'prompt' ? 'Cliente desistiu do servico' : undefined);
  page.on('dialog', cancelDialogs);
  await page.locator('[data-status="CANCELADA"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  page.off('dialog', cancelDialogs);
  await page.locator('#osArchiveRows .os-card[data-os="' + exceptionId + '"]').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, '09-os-cancelada-com-estornos.png'), fullPage: true });

  // Etapa 11: percorre a interface com os tres papeis, em janela isolada.
  const qaUsers = [
    { username: 'qa_atendimento', name: 'QA Atendimento', role: 'ATENDIMENTO' },
    { username: 'qa_tecnico', name: 'QA Tecnico', role: 'TECNICO' },
    { username: 'qa_financeiro', name: 'QA Financeiro', role: 'FINANCEIRO' }
  ];
  for (const user of qaUsers) {
    const result = await page.evaluate(async person => {
      const response = await fetch('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...person, password: 'Admin@1234' })
      });
      return { status: response.status, body: await response.text() };
    }, user);
    if (result.status !== 200) throw new Error('Cadastro de perfil QA: ' + result.status + ' ' + result.body);
  }
  for (const user of qaUsers) {
    const roleContext = await browser.newContext({ viewport: viewports[viewportName] });
    try {
      const rolePage = await roleContext.newPage();
      rolePage.on('pageerror', error => errors.push(user.role + ': ' + error.message));
      await rolePage.goto('http://127.0.0.1:3344', { waitUntil: 'domcontentloaded' });
      await rolePage.locator('#loginForm input[name="username"]').fill(user.username);
      await rolePage.locator('#loginForm input[name="password"]').fill('Admin@1234');
      await rolePage.locator('#loginForm button[type="submit"]').click();
      await rolePage.locator('#appView').waitFor({ state: 'visible' });
      const actualRole = (await rolePage.locator('#userRole').textContent()).trim();
      if (actualRole !== user.role) throw new Error('Perfil incorreto: ' + actualRole);
      await navigate(rolePage, 'work-orders');
      const activeProblem = user.role === 'FINANCEIRO'
        ? 'Troca de SSD e reinstalação do sistema'
        : 'Aparelho não carrega pela USB-C';
      const roleCard = rolePage.locator('.os-card').filter({ hasText: activeProblem }).first();
      await roleCard.waitFor({ state: 'visible' });
      await roleCard.click();
      if (user.role === 'TECNICO') {
        if (await rolePage.locator('#quoteBtn').count()) throw new Error('Tecnico pode editar orcamento indevidamente');
        if (await rolePage.locator('#payBtn').count()) throw new Error('Tecnico pode receber pagamento indevidamente');
        if (await rolePage.locator('#diagnosisForm textarea').getAttribute('readonly') !== null)
          throw new Error('Tecnico nao pode editar diagnostico');
      } else if (user.role === 'ATENDIMENTO') {
        await rolePage.locator('#quoteBtn').waitFor({ state: 'visible' });
        if (await rolePage.locator('#payBtn').count()) throw new Error('Atendimento pode receber pagamento indevidamente');
      } else {
        await rolePage.locator('#payBtn').waitFor({ state: 'visible' });
        if (await rolePage.locator('[data-status]').count()) throw new Error('Financeiro pode mudar status indevidamente');
        if (await rolePage.locator('#diagnosisForm textarea').getAttribute('readonly') === null)
          throw new Error('Financeiro pode editar diagnostico indevidamente');
      }
      await rolePage.screenshot({
        path: path.join(outputDir, '10-perfil-' + user.role.toLowerCase() + '.png'),
        fullPage: true
      });
    } finally {
      await roleContext.close();
    }
  }

  if (errors.length) throw new Error('Erros JS na jornada: ' + errors.join(' | '));

  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({
    status: 'passed', viewport: viewportName, osId,
    checks: ['login', 'cliente-ui', 'veiculo-ui', 'os-ui', 'diagnostico-ui',
      'orcamento-ui', 'aprovacao-ui', 'pagamento-pix-ui', 'entrega-ui',
      'arquivo-pdf', 'historico-ui', 'reprovacao-e-revisao-ui', 'estorno-estoque-ui',
      'estorno-recebimento-ui', 'offline-e-replay-ui', 'cancelamento-ui',
      'papeis-atendimento-tecnico-financeiro-ui', 'console-sem-erros']
  }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({
    status: 'failed', viewport: viewportName, error: error.message, errors
  }, null, 2)).catch(() => {});
  throw error;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await writeFile(path.join(outputDir, 'server.log'), logs.join('')).catch(() => {});
}
