"""Commercial upgrade and interactive Windows print acceptance, on a disposable runner."""
import hashlib
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright
from pypdf import PdfReader
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
    subprocess.run(['powershell', '-NoProfile', '-Command',
                    f'(Get-Process -Id {app.pid}).CloseMainWindow()'], check=True)
    app.wait(timeout=45)


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
        page.locator('[data-page="work-orders"]:visible').first.click()
        page.locator(f'[data-os="{order["id"]}"]:visible').first.click()
        with page.expect_response(lambda r: r.url.endswith('/documents/quote')) as reply:
            page.locator('[data-print=quote]').click()
        assert reply.value.status == 200 and item in reply.value.text()
        confirm_print()
        for _ in range(100):
            if pdf.is_file() and pdf.read_bytes().rstrip().endswith(b'%%EOF'):
                break
            time.sleep(.3)
        reader = PdfReader(pdf)
        text = ' '.join(p.extract_text() for p in reader.pages)
        for expected in (customer_name, item, '150,00'):
            assert expected in text, (expected, text)
        print('PASS commercial upgrade, existing OS, native Windows PDF:', hashlib.sha256(pdf.read_bytes()).hexdigest())
finally:
    stop_app(app)
    authority.shutdown()
