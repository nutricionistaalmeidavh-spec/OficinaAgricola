# Diagnóstico físico multimarcas — J2534 e J1939

O ArtiSys Oficina não exige assinaturas, serviços externos nem API de fabricante para operar.
Os recursos de hardware são **opt-in**: só funcionam quando há equipamento, driver
e protocolo compatíveis. O sistema continua offline e com todas as demais funções
quando os dispositivos não estão instalados.

## Como acessar
1. Execute o ArtiSys Oficina no **computador principal** e entre como ADMIN, ATENDIMENTO ou TECNICO.
2. Abra **Equipamentos > Histórico > Ler OBD-II** (para máquinas agrícolas, o mesmo módulo).
3. Selecione a interface J2534 ou J1939, configure o dispositivo e clique em
   **Conectar e registrar diagnóstico**.
4. Os dados só são gravados na ficha do equipamento/OS após a leitura e a validação.
   O laudo PDF é gerado localmente. No simulador, laudos são identificados como simulação.

Não habilitar capturas físicas de clientes remotos em LAN: a rota de hardware aceita
apenas conexões originadas no próprio computador principal. O sistema não apaga DTCs,
não programa ECU e não executa atuadores.

## Windows — J2534 Pass-Thru
- Na versão **Windows instalada pelo NSIS**, Python e a ponte de diagnóstico já acompanham o aplicativo; não é preciso instalar Python, configurar PATH nem executar comandos no terminal.
- Instale o **driver J2534 04.04 fornecido pelo fabricante do seu equipamento**.
  O driver precisa aparecer em `HKLM\SOFTWARE\PassThruSupport.04.04` no registro
  Windows (incluindo a visualização 32-bit, quando aplicável).
- Confirme que a arquitetura da DLL corresponde à do Python (32/64 bits).
- Conecte a interface ao veículo e escolha o driver detectado na tela.
- Há suporte inicial para **ISO15765 CAN de 11 bits, 250 ou 500 kbit/s**, com consultas
  OBD-II padrão dos serviços 01, 03, 07 e 0A. Não há desbloqueio de fabricante,
  programação OEM, UDS proprietário ou cobertura garantida para ABS/airbag.
- Se a DLL estiver ausente, a ECU não responder ou o protocolo for incompatível, o
  aplicativo apresenta erro explícito; jamais substitui resposta real por simulação.

## J1939 — CAN agrícola/comercial
- É necessária uma interface CAN com backend suportado: SocketCAN em Linux, ou
  PCAN, Kvaser, Vector, IXXAT, SLCAN e outros backends do `python-can`.
- No Linux, SocketCAN é suportado com biblioteca padrão do Python. O canal precisa
  estar configurado na própria máquina, por exemplo `can0` em 250 kbit/s.
- Na versão **Windows instalada**, `python-can` já vem empacotado. Para PCAN e outros backends, somente o driver local do fabricante do equipamento pode ser necessário. Em instalações manuais/Linux, `python-can` pode ser instalado separadamente.
- Selecione backend, canal (ex.: `PCAN_USBBUS1`), bitrate 250/500 kbit/s
  e tempo de escuta de 5–15 segundos.
- A captura é **totalmente passiva**: não chama `bus.send` e não transmite
  nenhum quadro na rede CAN. Lê quadros estendidos de 29 bits, decodificando
  RPM (PGN 61444 / SPN 190), temperatura do líquido (PGN 65262 / SPN 110),
  horas de motor (PGN 65253 / SPN 247) e falhas DM1 de quadros únicos
  (PGN 65226 / SPN/FMI).
- Mensagens multipacote, PGNs privados, leitura ativa por solicitação, programação
  e diagnóstico completo de todas as ECUs não são parte desta entrega.

## Tratamento de problemas
- **Driver J2534 não encontrado:** verifique registro do Windows, instalação e
  arquitetura da DLL do equipamento; reinicie o aplicativo após instalar o driver.
- **Ponte de diagnóstico ausente no Windows:** reparar/reinstalar o ArtiSys Oficina. Não instalar Python manualmente.
- **Backend CAN indisponível:** conferir driver do equipamento, canal escolhido e suporte desse modelo; `python-can` faz parte do instalador Windows.
- **Sem quadros J1939:** confira alimentação/ignição, conexão física, bitrate,
  backend, canal e se a ECU realmente transmite PGNs no barramento.
- **Sem resposta J2534:** confira driver, ignição, velocidade ISO15765 e se o veículo
  é compatível com OBD-II genérico; protocolos proprietários exigem integração adicional.

## Homologação
Os testes automatizados verificam a interpretação das mensagens, as permissões
da API e que o leitor J1939 nunca transmite quadros. **Não homologam automaticamente
um equipamento físico nem um veículo real.** Antes de vender como serviço de scanner
multimarcas, a combinação modelo/driver/veículo deve ser testada presencialmente.


## Empacotamento autônomo do instalador Windows

O build Windows inclui uma ponte executável independente em
`resources/diagnostics/ArtiSys-Diagnostic-Bridge/ArtiSys-Diagnostic-Bridge.exe`,
criada com PyInstaller a partir de `diagnostic-worker.py`. Inclui o interpretador
Python e a biblioteca open source `python-can`. É um componente interno do
aplicativo, sem janelas ou passos de instalação para o usuário.

- O processo Electron **não** usa Python do PATH na instalação NSIS; se a ponte
  estiver ausente, apresenta uma mensagem de reparo em vez de executar software
  inesperado ou inventar leituras.
- A compilação utiliza `scripts/build-diagnostic-bridge.ps1` com dependências de
  build pinadas em `scripts/requirements-diagnostic-bridge.txt`.
- O smoke do Windows verifica o executável instalado com PATH sem Python e valida
  que a rota autenticada de diagnóstico usa a ponte embutida.
- Desenvolvimento e instalação manual (fora do NSIS) podem continuar usando o
  Python instalado pelo desenvolvedor; essa exigência não é repassada ao cliente.
- Os drivers/dll de fornecedores de interface física continuam externos, podendo
  exigir instalador do fabricante e compatibilidade da arquitetura x64.
- Bibliotecas open source: PyInstaller (GPL com exceção de empacotamento) e
  python-can (LGPL-3.0-only), com fontes e licenças disponibilizadas pelos projetos.
