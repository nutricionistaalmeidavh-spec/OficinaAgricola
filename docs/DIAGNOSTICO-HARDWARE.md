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
- Instale **Python 3** com `python` acessível no PATH ou configure seu interpretador
  com `DIAGNOSTIC_PYTHON`; ele é opcional para o núcleo do ArtiSys Oficina.
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
- Para PCAN e outros backends (inclusive no Windows), instale a biblioteca **livre**
  `python -m pip install python-can` e os drivers locais do equipamento.
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
- **Python não encontrado:** instale Python 3 e ajuste o PATH ou `DIAGNOSTIC_PYTHON`.
- **python-can não encontrado:** instale apenas se quiser usar backend CAN que dependa dele.
- **Sem quadros J1939:** confira alimentação/ignição, conexão física, bitrate,
  backend, canal e se a ECU realmente transmite PGNs no barramento.
- **Sem resposta J2534:** confira driver, ignição, velocidade ISO15765 e se o veículo
  é compatível com OBD-II genérico; protocolos proprietários exigem integração adicional.

## Homologação
Os testes automatizados verificam a interpretação das mensagens, as permissões
da API e que o leitor J1939 nunca transmite quadros. **Não homologam automaticamente
um equipamento físico nem um veículo real.** Antes de vender como serviço de scanner
multimarcas, a combinação modelo/driver/veículo deve ser testada presencialmente.
