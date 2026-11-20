(function(document,window){
 'use strict';
 // Document HTML is rendered and escaped by the canonical SQL backend.
 // The desktop bridge prints the same HTML that the browser previews.
 const preparedFrame=(html,label)=>{
   const frame=document.createElement('iframe');
   frame.setAttribute('title',label);
   frame.setAttribute('sandbox','allow-same-origin allow-modals');
   frame.setAttribute('referrerpolicy','no-referrer');
   frame.srcdoc=html;
   return frame;
 };
 function printHtml(html){
   if(window.oficinaPrinter)return window.oficinaPrinter.printDocument(html);
   return new Promise((resolve,reject)=>{
     const frame=preparedFrame(html,'Documento para impressão');
     frame.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
     let completed=false,timer;
     const cleanup=()=>{
       if(completed)return;
       completed=true;
       if(timer)clearTimeout(timer);
       frame.remove();
     };
     frame.onload=()=>{
       try{
         const target=frame.contentWindow;
         if(!target)throw new Error('Visualizador de impressão indisponível');
         target.addEventListener('afterprint',cleanup,{once:true});
         // Time-bound cleanup is a fallback for printers without afterprint.
         timer=setTimeout(cleanup,120000);
         target.focus();
         target.print();
         resolve();
       }catch(error){cleanup();reject(error);}
     };
     frame.onerror=()=>{cleanup();reject(Error('Documento de impressão não pôde ser aberto'))};
     document.body.appendChild(frame);
   });
 }
 function previewHtml(html,label='Documento'){
   const veil=document.createElement('section');
   veil.setAttribute('role','dialog');
   veil.setAttribute('aria-modal','true');
   veil.setAttribute('aria-label',label);
   veil.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(12,18,26,.88);padding:clamp(8px,2vw,22px);display:flex;flex-direction:column;gap:10px';
   const toolbar=document.createElement('div');
   toolbar.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;color:white';
   const title=document.createElement('strong');
   title.textContent=label;
   const actions=document.createElement('div');
   actions.style.cssText='display:flex;align-items:center;gap:8px';
   const print=document.createElement('button');
   print.type='button';print.textContent='Imprimir';print.className='btn primary';
   const close=document.createElement('button');
   close.type='button';close.textContent='Fechar';close.className='btn sm';
   const frame=preparedFrame(html,label);
   frame.style.cssText='flex:1;width:100%;min-height:0;border:0;background:white;border-radius:9px';
   const onKey=e=>{if(e.key==='Escape')closePreview();};
   const closePreview=()=>{document.removeEventListener('keydown',onKey);veil.remove()};
   close.onclick=closePreview;
   const status=document.createElement('span');
   status.setAttribute('role','alert');
   print.onclick=async()=>{
     print.disabled=true;
     status.textContent='';
     try{await printHtml(html);}
     catch(error){status.textContent='Falha na impressão: '+error.message;}
     finally{print.disabled=false;}
   };
   toolbar.appendChild(status);
   actions.appendChild(print);actions.appendChild(close);
   toolbar.appendChild(title);toolbar.appendChild(actions);
   veil.appendChild(toolbar);veil.appendChild(frame);
   document.body.appendChild(veil);
   document.addEventListener('keydown',onKey);
   close.focus();
   return {close:closePreview};
 }
 window.OficinaDocuments=Object.freeze({printHtml,previewHtml});
})(document,window);
