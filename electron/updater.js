import {app,dialog} from 'electron';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {checkGitHubUpdate,downloadVerifiedUpdate} from './update-service.js';

const CHECK_INTERVAL_MS=6*60*60*1000;

function installOnExit(installer){
  // NSIS substitui apenas o diretório do aplicativo. O PostgreSQL, uploads,
  // usuários e licenças permanecem em LOCALAPPDATA/ArtiSys/Oficina.
  // O pequeno atraso permite ao Electron e ao PostgreSQL encerrarem totalmente.
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  const script=[
    'Start-Sleep -Seconds 5',
    '$process = Start-Process -FilePath '+quote(installer)+" -ArgumentList '/S' -PassThru -Wait",
    'if ($process.ExitCode -eq 0) { Start-Process -FilePath '+quote(process.execPath)+' }'
  ].join('; ');
  const child=spawn('powershell.exe',[
    '-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden',
    '-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')
  ],{detached:true,windowsHide:true,stdio:'ignore'});
  child.unref();
}

export function startDesktopUpdates({getWindow,isCommercial=false}){
  // Não tentar atualizar a versão comercial com um release da edição livre.
  if(!app.isPackaged||process.platform!=='win32'||process.arch!=='x64'||isCommercial)return;
  let busy=false;
  let closingForUpdate=false;

  async function check(){
    if(busy||closingForUpdate)return;
    busy=true;
    const window=getWindow();
    try{
      const update=await checkGitHubUpdate(app.getVersion());
      if(!update||!window||window.isDestroyed())return;
      const question=await dialog.showMessageBox(window,{
        type:'info',
        title:'Atualização disponível · ArtiSys Oficina',
        message:'Nova versão '+update.version+' disponível',
        detail:'O instalador oficial será baixado do GitHub e validado com SHA256. Seus dados da oficina continuarão no computador.',
        buttons:['Baixar atualização','Mais tarde'],defaultId:0,cancelId:1,noLink:true
      });
      if(question.response!==0)return;
      window.setProgressBar(0);
      const installer=await downloadVerifiedUpdate(update,
        join(app.getPath('userData'),'updates'),{
          onProgress:(downloaded,total)=>{
            if(!window.isDestroyed()&&total>0)window.setProgressBar(downloaded/total);
          }
        });
      if(!window.isDestroyed())window.setProgressBar(-1);
      if(!getWindow()||getWindow().isDestroyed())return;
      const answer=await dialog.showMessageBox(getWindow(),{
        type:'question',
        title:'Atualização pronta · ArtiSys Oficina',
        message:'Versão '+update.version+' verificada e pronta',
        detail:'Salve qualquer edição em andamento. O programa será fechado, atualizará o instalador NSIS e será reaberto automaticamente. O banco PostgreSQL e os arquivos locais não serão removidos.',
        buttons:['Instalar e reiniciar','Depois'],defaultId:0,cancelId:1,noLink:true
      });
      if(answer.response!==0)return;
      closingForUpdate=true;
      app.once('quit',()=>{
        try{installOnExit(installer);}
        catch(error){console.error('[updater] instalação não iniciada:',error);}
      });
      app.quit(); // before-quit do main encerra o PostgreSQL antes do instalador
    }catch(error){
      console.warn('[updater] atualização indisponível:',error?.message||error);
      const active=getWindow();
      if(active&&!active.isDestroyed()){
        await dialog.showMessageBox(active,{
          type:'warning',
          title:'Atualização não concluída',
          message:'A atualização não pôde ser concluída com segurança.',
          detail:'Nenhuma alteração foi aplicada. Verifique a conexão e tente novamente mais tarde.',
          buttons:['OK']
        }).catch(()=>{});
      }
    }finally{
      if(window&&!window.isDestroyed())window.setProgressBar(-1);
      busy=false;
    }
  }
  const timer=setInterval(()=>void check(),CHECK_INTERVAL_MS);
  timer.unref?.();
  app.once('will-quit',()=>clearInterval(timer));
  void check();
}
