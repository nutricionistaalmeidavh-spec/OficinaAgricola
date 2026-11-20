import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { printDocument } from '../electron/print-document.js';

const orders = readFileSync('public/app-orders.js','utf8');
const documents = readFileSync('public/document-print.js','utf8');

for (const outcome of ['success','cancel','failure','route-error']) {
  test('OS quote button and native print transport: '+outcome, async () => {
    const html = '<!doctype html><html><body>OS #17 — orçamento</body></html>';
    const calls = [], messages = [];
    class PrintWindow extends EventEmitter {
      constructor(options) {
        super();
        assert.equal(options.show,false);
        assert.equal(options.webPreferences.javascript,false);
        this.webContents = Object.assign(new EventEmitter(), {
          setWindowOpenHandler() {},
          session: { webRequest: { onBeforeRequest() {} } },
          async loadURL(url) {
            assert.equal(decodeURIComponent(url.split(',')[1]), html);
            calls.push('load');
          },
          print(options,done) {
            assert.equal(options.silent,false);
            assert.equal(options.pageSize,'A4');
            calls.push('print');
            done(outcome==='success',outcome==='cancel'?'Print job canceled':'Printer unavailable');
          }
        });
      }
      isDestroyed() { return false; }
      destroy() { calls.push('close'); this.emit('closed'); }
    }
    const window = { oficinaPrinter: { printDocument: html => printDocument(PrintWindow, {}, html) } };
    const context = { window, document: {}, toast: message => messages.push(message),
      async api(path, options) {
        assert.equal(path,'/api/work-orders/17/documents/quote');
        assert.equal(options.raw,true);
        calls.push('read');
        if(outcome==='route-error') throw Error('Rota não migrada para PostgreSQL');
        return html;
      }
    };
    runInNewContext(documents,context);
    runInNewContext(orders,context);
    await context.printWorkOrderDocument(17,'quote');
    assert.deepEqual(calls,outcome==='route-error'?['read']:['read','load','print','close']);
    if(outcome==='failure') assert.match(messages[0],/Printer unavailable/);
    else if(outcome==='route-error') assert.match(messages[0],/Rota não migrada/);
    else assert.deepEqual(messages,[]);
  });
}
