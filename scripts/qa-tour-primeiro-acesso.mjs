import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const viewportName = process.argv[2] || 'desktop';
const sizes = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
if (!sizes[viewportName]) throw new Error('Viewport invalido: ' + viewportName);

const output = path.resolve(process.argv[3] || 'qa-artifacts/tour-' + viewportName);
const temp = path.join(output, '.recording');
const postgresUrl = process.env.POSTGRES_TEST_URL;
if (!postgresUrl) throw new Error('POSTGRES_TEST_URL obrigatoria: tour nao pode usar SQLite legado');
const storage = path.join(output, 'storage');
const port = viewportName === 'desktop' ? 3385 : 3386;
const url = 'http://127.0.0.1:' + port;
const phases = [];
const consoleErrors = [];
const logs = [];

await rm(output, { recursive: true, force: true });
await mkdir(temp, { recursive: true });

const server = spawn(process.execPath, ['src/start-postgres-unified.js'], {
  env: {
    ...process.env,
    OFICINA_POSTGRES_REGISTRY_URL: postgresUrl,
    OFICINA_POSTGRES_OPERATIONS_URL: postgresUrl,
    OFICINA_POSTGRES_PORT: String(port),
    OFICINA_REGISTRY_NEW_INSTALL: 'true',
    OFICINA_POSTGRES_PROVISION_NEW_UNITS: 'true',
    OFICINA_POSTGRES_SCHEMA_PREFIX: 'qatour',
    OFICINA_POSTGRES_STORAGE_ROOT: storage,
    OFICINA_QA_NATIVE_DEBUG: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stdout.on('data', data => logs.push(data.toString()));
server.stderr.on('data', data => logs.push(data.toString()));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function healthy() {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (server.exitCode !== null) throw new Error('Servidor local encerrou durante o tour');
    try {
      const response = await fetch(url + '/api/health');
      if (response.ok) {
        const health = await response.json();
        if (health.engine === 'postgres' && health.operationalApiReady === true) return;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error('Servidor local do tour nao iniciou');
}

let browser;
let context;
let page;
let video;
let fatalError;

async function evidence(file, description) {
  await sleep(650);
  await page.screenshot({ path: path.join(output, file), fullPage: true });
  phases.push(description);
}

async function navigate(name) {
  const direct = page.locator('#nav button[data-page="' + name + '"]');
  if (await direct.isVisible()) {
    await direct.click();
  } else {
    await page.locator('#mobileMoreBtn').click();
    await page.locator('#mobileMorePanel [data-mobile-page="' + name + '"]').click();
  }
  await page.waitForFunction(target =>
    document.querySelector('#nav button.active')?.dataset.page === target,
  name);
}

async function openChecklist() {
  await page.locator('#firstAccessBanner').waitFor({ state: 'visible' });
  const action = page.locator('#firstAccessBanner [data-first-access-action="open"]');
  await action.click();
  await page.locator('#modalBody .first-access-panel').waitFor({ state: 'visible' });
}

function ensure(text, predicate) {
  if (!predicate) throw new Error(text);
}

try {
  await healthy();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: sizes[viewportName],
    acceptDownloads: true,
    recordVideo: { dir: temp, size: sizes[viewportName] }
  });
  page = await context.newPage();
  video = page.video();
  page.on('pageerror', error => consoleErrors.push(error.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#setupForm').waitFor({ state: 'visible' });
  await evidence('01-instalacao.png', 'Primeira instalacao: criacao de administrador');

  await page.locator('#setupForm input[name="name"]').fill('Gestor QA Oficina');
  await page.locator('#setupForm input[name="username"]').fill('gestorqa');
  await page.locator('#setupForm input[name="password"]').fill('PrimeiroAcessoQA2026!');
  await page.locator('#setupForm input[name="confirmPassword"]').fill('PrimeiroAcessoQA2026!');
  await page.locator('#setupForm button[type="submit"]').click();
  await page.locator('#loginForm').waitFor({ state: 'visible' });
  await evidence('02-login.png', 'Criacao segura de acesso e tela de login');

  await page.locator('#loginForm input[name="username"]').fill('gestorqa');
  await page.locator('#loginForm input[name="password"]').fill('PrimeiroAcessoQA2026!');
  await page.locator('#loginForm button[type="submit"]').click();
  await page.locator('#appView').waitFor({ state: 'visible' });
  await page.locator('#firstAccessBanner').waitFor({ state: 'visible' });
  ensure('Checklist inicial ausente', (await page.locator('#firstAccessBanner').textContent()).includes('Prepare sua oficina'));
  await evidence('03-checklist-inicial.png', 'Dashboard com checklist de primeiro acesso');

  await openChecklist();
  const opening = await page.locator('#modalBody').textContent();
  ensure('Etapas essenciais nao aparecem no tour', opening.includes('Dados da oficina') &&
    opening.includes('Equipe e serviços') && opening.includes('Sistema instalado'));
  ensure('Tour exibiu etapa fiscal indevida', !/certificado digital|homologacao fiscal|emissao fiscal/i.test(opening));
  await evidence('04-tour-etapas.png', 'Modal completo de preparacao: sistema, oficina e equipe');

  await page.locator('#modalBody [data-first-access-action="company"]').first().click();
  await page.locator('#companyForm').waitFor({ state: 'visible' });
  await evidence('05-cadastro-oficina.png', 'Atalho real para dados da oficina');
  await page.locator('#companyForm input[name="name"]').fill('Oficina QA Completa');
  await page.locator('#companyForm input[name="document"]').fill('11222333000181');
  await page.locator('#companyForm input[name="phone"]').fill('16999990000');
  await page.locator('#companyForm input[name="address"]').fill('Rua QA, 123 - Ribeirao Preto SP');
  await page.locator('#companyForm select[name="serviceProfile"]').selectOption('AUTOMOTIVA');
  await page.locator('#companyForm button[type="submit"]').click();
  await page.locator('#toast').filter({ hasText: 'Empresa atualizada' }).waitFor({ state: 'visible' });
  await evidence('06-oficina-salva.png', 'Cadastro da oficina salvo pelo formulario real');

  await navigate('dashboard');
  await openChecklist();
  const afterCompany = await page.locator('#modalBody').textContent();
  ensure('Cadastro da oficina nao confirmou prontidao', afterCompany.includes('Sua oficina já pode funcionar'));
  await evidence('07-oficina-pronta.png', 'Sistema pronto para operar com equipe opcional');

  await page.locator('#modalBody [data-first-access-action="services"]').first().click();
  await page.locator('#newService').waitFor({ state: 'visible' });
  await page.locator('#newService').click();
  await page.locator('#modalBody input[name="code"]').fill('REV-QA');
  await page.locator('#modalBody input[name="name"]').fill('Revisao preventiva QA');
  await page.locator('#modalBody input[name="price"]').fill('150');
  await page.locator('#modalBody input[name="minutes"]').fill('60');
  await evidence('08-servico-formulario.png', 'Atalho do tour para cadastrar servico');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#content').filter({ hasText: 'Revisao preventiva QA' }).waitFor({ state: 'visible' });
  await evidence('09-servico-cadastrado.png', 'Servico confirmado pelo backend');

  await navigate('technicians');
  await page.locator('#newTech').waitFor({ state: 'visible' });
  await page.locator('#newTech').click();
  await page.locator('#modalBody input[name="name"]').fill('Tecnico QA Oficina');
  await page.locator('#modalBody input[name="phone"]').fill('16988887777');
  await page.locator('#modalBody input[name="specialty"]').fill('Revisoes e diagnosticos');
  await evidence('10-tecnico-formulario.png', 'Cadastro da equipe tecnica opcional');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#content').filter({ hasText: 'Tecnico QA Oficina' }).waitFor({ state: 'visible' });
  await evidence('11-tecnico-cadastrado.png', 'Equipe cadastrada no sistema local');

  await navigate('dashboard');
  await openChecklist();
  const completed = await page.locator('#modalBody').textContent();
  ensure('O tour nao marcou todas as etapas concluidas', completed.includes('3 de 3'));
  await evidence('12-checklist-concluido.png', 'Checklist concluido: 3 de 3');
  await page.locator('#modalBody [data-first-access-action="dismiss"]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('#firstAccessBanner.first-access-card-compact').waitFor({ state: 'visible' });
  await evidence('13-comecar-trabalhar.png', 'Comecar a trabalhar sem remover opcao de reabrir checklist');

  // Validacao real do primeiro percurso apos concluir o tour.
  await navigate('customers');
  await page.locator('#newCustomer').waitFor({ state: 'visible' });
  await page.locator('#newCustomer').click();
  await page.locator('#modalBody input[name="name"]').fill('Cliente QA Tour');
  await page.locator('#modalBody input[name="phone"]').fill('16999990001');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#content').filter({ hasText: 'Cliente QA Tour' }).waitFor({ state: 'visible' });
  await evidence('14-primeiro-cliente.png', 'Primeiro cliente cadastrado apos o tour');

  await navigate('machines');
  await page.locator('#newMachine').waitFor({ state: 'visible' });
  await page.locator('#newMachine').click();
  await page.locator('#modalBody select[name="customerId"]').selectOption({ label: 'Cliente QA Tour' });
  await page.locator('#modalBody input[name="type"]').fill('Carro');
  await page.locator('#modalBody input[name="brand"]').fill('Volkswagen');
  await page.locator('#modalBody input[name="model"]').fill('Gol Tour');
  await page.locator('#modalBody input[name="plate"]').fill('QAT1A23');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#content').filter({ hasText: 'QAT1A23' }).waitFor({ state: 'visible' });
  await evidence('15-primeiro-veiculo.png', 'Equipamento vinculado ao cliente');

  await navigate('work-orders');
  await page.locator('#newOS').waitFor({ state: 'visible' });
  await page.locator('#newOS').click();
  await page.locator('#osCustomer').selectOption({ label: 'Cliente QA Tour' });
  const option = page.locator('#osMachine option').filter({ hasText: 'Gol Tour' });
  await option.waitFor({ state: 'attached' });
  await page.locator('#osMachine').selectOption(await option.getAttribute('value'));
  await page.locator('#modalBody textarea[name="problemReported"]').fill('Revisao preventiva apos primeiro acesso');
  await evidence('16-nova-os.png', 'Primeira ordem de servico iniciada pela interface');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('.os-card').filter({ hasText: 'Cliente QA Tour' }).first().waitFor({ state: 'visible' });
  await evidence('17-os-criada.png', 'Primeira OS criada e visivel no Kanban');

  ensure('Foram detectados erros JavaScript no navegador', consoleErrors.length === 0);
  await writeFile(path.join(output, 'qa-tour-summary.json'), JSON.stringify({
    status: 'passed',
    viewport: viewportName,
    phases,
    consoleErrors
  }, null, 2) + '\n');
} catch (error) {
  fatalError = error;
  if (page) await page.screenshot({ path: path.join(output, 'falha.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'qa-tour-summary.json'), JSON.stringify({
    status: 'failed',
    viewport: viewportName,
    phases,
    error: error.message,
    consoleErrors
  }, null, 2) + '\n').catch(() => {});
} finally {
  if (context) await context.close().catch(() => {});
  if (video) await video.saveAs(path.join(output, 'tour-primeiro-acesso-' + viewportName + '.webm')).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await writeFile(path.join(output, 'server.log'), logs.join('')).catch(() => {});
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
if (fatalError) throw fatalError;
