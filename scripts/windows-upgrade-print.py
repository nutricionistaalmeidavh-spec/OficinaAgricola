"""Commercial upgrade and interactive Windows print acceptance, on a disposable runner."""
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright
import pymupdf
from pywinauto import Desktop

root, previous, candidate, pdf = map(Path, sys.argv[1:5])
version = sys.argv[5]
base = 'http://127.0.0.1:3344'
install = root / 'app'
environment = os.environ.copy()
environment['LOCALAPPDATA'] = str(root / 'profile')
admin = {'username': 'qa-print', 'password': 'Oficina-QA-local-123!', 'name': 'QA PDF'}
item = 'Revisao QA persistida'
customer_name = 'Oficina Cliente QA PDF'


class TestLicenseAuthority(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path != '/v1/activation/verify' or body.get('email') != 'qa@example.invalid':
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({'product': 'OFICINA', 'licenseId': 'qa-ephemeral',
                                     'accountEmail': body['email'], 'expiresAt': None}).encode())


def api(path, body=None, token=None, method=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(base + '/api/' + path, headers=headers, method=method,
                                     data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(request, timeout=8) as result:
        return json.load(result)


def install_version(installer):
    subprocess.run([str(installer), '/S', '/D=' + str(install)], check=True, timeout=240)


def start_app():
    app = subprocess.Popen([str(install / 'ArtiSys Oficina.exe'), '--remote-debugging-port=19342'],
                           env=environment)
    for _ in range(120):
        if app.poll() is not None:
            raise RuntimeError('Oficina encerrou antes da inicialização')
        try:
            if api('health')['engine'] == 'postgres':
                return app
        except OSError:
            pass
        time.sleep(.5)
    raise TimeoutError('Inicialização do PostgreSQL')


def stop_app(app):
    # The health endpoint can answer before Electron has shown its main window.
    # A published newer release can also open a native dialog on the old install.
    deadline = time.monotonic() + 45
    while app.poll() is None and time.monotonic() < deadline:
        for window in Desktop(backend='uia').windows(process=app.pid):
            for button in window.descendants(control_type='Button'):
                if button.window_text() == 'Mais tarde' and button.is_enabled():
                    button.invoke()
                    break
        subprocess.run(['powershell', '-NoProfile', '-Command',
                        f'(Get-Process -Id {app.pid} -ErrorAction SilentlyContinue).CloseMainWindow()'],
                       capture_output=True)
        try:
            app.wait(timeout=2)
        except subprocess.TimeoutExpired:
            continue
    if app.poll() is None:
        raise TimeoutError('Fechamento normal do Oficina excedeu 45 segundos')



def confirm_print():
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        for dialog in Desktop(backend='uia').windows():
            if dialog.window_text().strip().lower() not in ('print', 'imprimir'):
                continue
            for button in dialog.descendants(control_type='Button'):
                if button.window_text().replace('&', '').strip().lower() in ('print', 'imprimir', 'ok') and button.is_enabled():
                    button.invoke()
                    return
        time.sleep(.3)
    raise TimeoutError('Janela de impressão do Windows não localizada')


cert, key = root / 'qa.crt', root / 'qa.key'
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
                '-keyout', str(key), '-out', str(cert)], check=True)
authority = ThreadingHTTPServer(('127.0.0.1', 0), TestLicenseAuthority)
tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
tls.load_cert_chain(cert, key)
authority.socket = tls.wrap_socket(authority.socket, server_side=True)
threading.Thread(target=authority.serve_forever, daemon=True).start()
environment.update(NODE_EXTRA_CA_CERTS=str(cert), OFICINA_LICENSE_ENDPOINT=f'https://127.0.0.1:{authority.server_port}')

install_version(previous)
app = start_app()
try:
    assert api('license/activate', {'email': 'qa@example.invalid', 'code': '123456'})['active']
    api('setup/initialize', admin)
    token = api('auth/login', admin)['token']
    customer = api('customers', {'name': customer_name}, token)
    machine = api('machines', {'customerId': customer['id'], 'type': 'AUTOMOVEL', 'model': 'Modelo QA'}, token)
    order = api('work-orders', {'customerId': customer['id'], 'machineId': machine['id'], 'problemReported': item}, token)
    path = 'work-orders/' + str(order['id'])
    api(path + '/status', {'toStatus': 'DIAGNOSTICO', 'expectedVersion': order['version']}, token)
    api(path + '/quote', {'items': [{'kind': 'MAO_DE_OBRA', 'description': item, 'quantity': 1, 'unitPriceCents': 15000}]}, token, 'PUT')
finally:
    stop_app(app)

install_version(candidate)
exe = install / 'ArtiSys Oficina.exe'
product_version = subprocess.check_output(['powershell', '-NoProfile', '-Command',
    f"(Get-Item -LiteralPath '{exe}').VersionInfo.ProductVersion"], text=True).strip()
assert product_version.split('+')[0] in (version, version+'.0'), product_version
app = start_app()
try:
    assert api('license/status')['active']
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp('http://127.0.0.1:19342')
        page = next(p for p in browser.contexts[0].pages if p.url.startswith(base))
        form = page.locator('#loginForm')
        form.locator('[name=username]').fill(admin['username'])
        form.locator('[name=password]').fill(admin['password'])
        form.locator('[type=submit]').click()
        page.locator('[data-page="settings"]:visible').first.click()
        page.locator('#checkDesktopUpdate').wait_for()
        page.wait_for_function("v => document.querySelector('#desktopVersion')?.textContent.includes(v)", arg=version)
        page.locator('#checkDesktopUpdate').click()
        page.get_by_text('Seu sistema está atualizado.', exact=True).wait_for()
        page.locator('#settings-updates').screenshot(path=str(pdf.parent / 'atualizacoes.png'))
        page.locator('[data-page="work-orders"]:visible').first.click()
        page.locator(f'[data-os="{order["id"]}"]:visible').first.click()
        for kind in ('work-order', 'quote', 'delivery', 'receipt'):
            button = page.locator(f'.detail-block [data-print="{kind}"]')
            assert button.count() == 1 and button.locator('svg').count() == 1
        page.locator('#modalBody').screenshot(path=str(pdf.parent / 'documentos-os.png'))
        # Drive the separate Gerar PDF button, including saving the downloaded bytes.
        downloads = root / 'downloads'
        downloads.mkdir()
        cdp = browser.new_browser_cdp_session()
        cdp.send('Browser.setDownloadBehavior', {'behavior': 'allow', 'downloadPath': str(downloads)})
        with page.expect_response(lambda r: r.url.endswith('/documents/work-order/pdf')) as export:
            page.locator('#pdfOS').click()
        assert export.value.status == 200 and export.value.headers['content-type'].startswith('application/pdf')
        deadline = time.monotonic() + 45
        target = downloads / f'OS-{order["os_number"]}.pdf'
        while not target.exists() and time.monotonic() < deadline:
            time.sleep(.25)
        with pymupdf.open(target) as document:
            text = ' '.join(sheet.get_text() for sheet in document)
            for expected in ('ORDEM DE SERVIÇO', customer_name, item, '150,00', 'ASSINATURAS'):
                assert expected in text, (expected, text)
        (pdf.parent / 'os-gerar-pdf.pdf').write_bytes(target.read_bytes())
        print('PASS Gerar PDF: downloaded original OS, customer, item, total and signatures')
        with page.expect_response(lambda r: r.url.endswith('/documents/quote')) as reply:
            page.locator('[data-print=quote]').click()
        assert reply.value.status == 200 and item in reply.value.text()
        confirm_print()
        # The spooler can create the output with an exclusive handle before
        # writing the last PDF page. Read only after the job releases it.
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                printed = pdf.read_bytes()
                if printed.rstrip().endswith(b'%%EOF'):
                    break
            except (FileNotFoundError, PermissionError):
                pass
            time.sleep(.3)
        else:
            raise TimeoutError('O spooler não concluiu o PDF em 90 segundos')
        # The Windows PDF driver can flatten type into images/paths. Verify
        # what the customer actually sees by reading rendered pages with OCR.
        with pymupdf.open(stream=printed, filetype='pdf') as doc:
            assert len(doc) >= 1
            words = []
            for n, sheet in enumerate(doc):
                image = root / f'printed-{n}.png'
                sheet.get_pixmap(dpi=300).save(image)
                read = subprocess.check_output([os.environ['OFICINA_QA_TESSERACT'],
                    str(image), 'stdout', '-l', 'eng', '--psm', '6'], encoding='utf-8')
                words.append(read)
            visible = ' '.join(' '.join(words).split())
            print('Visible PDF content:', visible)
            for expected in (customer_name, item):
                assert expected.casefold() in visible.casefold(), expected
            assert re.search(r'150[,.]00', visible), visible
        print('PASS commercial upgrade, existing OS, native Windows PDF:', hashlib.sha256(printed).hexdigest())
finally:
    stop_app(app)
    authority.shutdown()
