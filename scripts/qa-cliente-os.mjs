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
  if (errors.length) throw new Error('Erros JS na jornada: ' + errors.join(' | '));

  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({
    status: 'passed', viewport: viewportName, osId,
    checks: ['login', 'cliente-ui', 'veiculo-ui', 'os-ui', 'diagnostico-ui',
      'orcamento-ui', 'aprovacao-ui', 'pagamento-pix-ui', 'entrega-ui',
      'arquivo-pdf', 'historico-ui', 'console-sem-erros']
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
