# ArtiSys Assistência Técnica

Versão separada do sistema de oficina, mantida no mesmo repositório sem substituir nem alterar a aplicação Oficina Agrícola existente.

## Isolamento

- aplicação: `apps/assistencia-tecnica/`;
- porta padrão: `3344`;
- banco local: `data/assistencia-tecnica.sqlite`;
- anexos: `storage/assistencia-tecnica/uploads/`;
- Electron: `%LOCALAPPDATA%/ArtiSys/AssistenciaTecnica`;
- appId: `com.artisys.assistenciatecnica`;
- instalador e atalho próprios.

O sistema original continua na raiz do repositório e não depende desta aplicação.

## Princípios

- core R$ 0;
- self-hosted;
- funcionamento local/offline;
- SQLite local;
- nenhuma API ou SaaS pago obrigatório;
- serviços pagos, se adicionados futuramente, devem permanecer opcionais.

## Entregas 00–08

### 00 — Proteção

A versão estável anterior foi preservada em branch de backup antes da criação desta edição. O desenvolvimento ocorre em branch separada.

### 01 — Estrutura isolada

Aplicação independente dentro do mesmo repositório, com banco, configuração, porta, identidade Electron/PWA e instalador próprios.

### 02 — Cadastros

Clientes, equipamentos, técnicos, peças e catálogo de serviços com preço padrão e tempo estimado.

### 03 — Ordens de serviço

Criação, edição, consulta, histórico e fluxo auditável de status da entrada até a entrega.

### 04 — Execução técnica

Diagnóstico, checklists, fotos/anexos, peças consumidas, observações e acompanhamento técnico vinculados à OS.

### 05 — Orçamentos

Itens de peça, mão de obra e terceiros, desconto, validade, aprovação/reprovação e conversão do fluxo para execução.

### 06 — Estoque

Entradas, saídas, ajustes, consumo por OS, alerta de mínimo e baixa automática de peças em vendas de balcão. Cancelamento de venda estorna o estoque de forma auditável.

### 07 — Caixa e vendas

Venda de peças e serviços, cliente opcional, desconto, formas de pagamento, abertura/fechamento de caixa, suprimento, sangria, ajuste e estorno.

### 08 — Documentos

OS, orçamento, entrega e recibo imprimíveis/PDF, além da visão de relatórios operacionais e financeiros já integrada à aplicação isolada.

## Entrega 10 — Local / Offline

A aplicação funciona sem internet externa, com o computador principal atuando como servidor local.

- `HOST=0.0.0.0` permite acesso pela rede local;
- porta padrão `3344`;
- banco SQLite e anexos permanecem somente no computador servidor;
- tablet e celular acessam `http://IP-DO-COMPUTADOR:3344` enquanto estiverem na mesma rede;
- a interface mostra o estado **Servidor local disponível / indisponível**;
- erros de conexão informam claramente quando o computador servidor não está acessível;
- o shell PWA possui cache local para ambientes onde Service Worker é permitido;
- nenhuma API externa é necessária para o funcionamento principal.

### Observação sobre PWA em tablet/celular

O acesso web pela rede local funciona por HTTP sem internet. Entretanto, navegadores modernos normalmente exigem HTTPS para instalar/ativar Service Worker fora de `localhost`. Portanto, em `http://IP-DO-COMPUTADOR:3344` o sistema continua utilizável no navegador enquanto o servidor local estiver ligado, mas a instalação PWA/offline do shell pode ser bloqueada pelo próprio navegador. Não foi introduzido certificado externo nem serviço pago para contornar essa restrição.

## Execução local

```bash
cd apps/assistencia-tecnica
cp .env.example .env
npm run db:migrate
npm run db:seed
npm start
```

No próprio computador, abra `http://127.0.0.1:3344`.

Para uso em tablet/celular:

1. mantenha `HOST=0.0.0.0`;
2. conecte os dispositivos à mesma rede do computador;
3. descubra o IPv4 local do computador, por exemplo `192.168.1.20`;
4. abra `http://192.168.1.20:3344` no dispositivo;
5. caso o Windows solicite, permita o acesso do aplicativo à rede privada/firewall.

O terminal também lista os endereços LAN encontrados ao iniciar o servidor.

## Testes

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

O teste `tests/local-offline.test.js` cobre porta/rede local, indicador de disponibilidade, shell PWA, ausência de SaaS obrigatório e bloqueio de instaladores em entregas intermediárias.
