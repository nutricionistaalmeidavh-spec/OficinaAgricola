# Ativação comercial opcional — ArtiSys Oficina

## Separação de edições

O repositório e o núcleo **MIT, R$ 0, self-hosted** funcionam sem licença, Cloudflare, internet ou SaaS.
A distribuição comercial **somente exige ativação** quando o responsável
pelo empacotamento configura explicitamente `OFICINA_REQUIRE_COMMERCIAL_ACTIVATION=true`.
Nunca usar uma variável implícita ou segredo escondido para exigir pagamento no core livre.

O modo comercial reutiliza **a mesma Central do PDV ArtiSys desktop**:
`https://pdv-artisys.sistema-artisys.workers.dev/admin`, no repositório
`PDV-ARTISYS` (branch `feat/oficina-license-product-scope`).
Na tela de liberação o administrador seleciona **Produto: ArtiSys Oficina**,
informa o e-mail e validade opcional, recebe código de 6 dígitos (48h, uso único)
e o entrega ao cliente. Suspensão, cancelamento e reativação usam as ações do portal.
Licenças PDV existentes ficam marcadas como `PDV`, e o mesmo e-mail
pode ter produtos diferentes sem misturar códigos ou cancelamentos.

## Fluxo para o usuário comercial

1. Instalar o aplicativo na máquina principal; o PostgreSQL e os dados da oficina são locais.
2. Abrir o aplicativo: antes de criar o Administrador, a tela **Liberar ArtiSys Oficina**
   pede e-mail e código fornecidos pela ArtiSys.
3. A Central verifica código e produto `OFICINA`, associando à instalação (ID persistente).
4. O usuário cria Administrador e senha **somente localmente** e pode operar normalmente.
5. O servidor verifica a licença no máximo a cada 15 minutos nas requisições em execução.
   Se a internet falhar, a última licença local confirmada como ativa continua funcionando
   até a validade conhecida. Licenças já conhecidas como canceladas, suspensas ou
   expiradas não voltam a funcionar sem nova validação online.

## Configuração da distribuição comercial

```sh
OFICINA_REQUIRE_COMMERCIAL_ACTIVATION=true
OFICINA_LICENSE_ENDPOINT=https://pdv-artisys.sistema-artisys.workers.dev
OFICINA_LICENSE_STORAGE_ROOT=/caminho/privado/do/perfil/licencas
```

A segunda variável é opcional (o domínio acima já é padrão).
O diretório privado de estado, quando omitido, fica ao lado do storage PostgreSQL.
Preserve-o na reinstalação; perda do arquivo exige reativação pelo portal.
Nenhum segredo do Cloudflare entra no instalador e o Administrador local não é transmitido.

A Central deve ser publicada **antes** de distribuir instaladores comerciais.
A migração D1 é aditiva: coluna `licenses.product`, com padrão `PDV` para
licenças antigas. `/v1/activation/verify` aceita `product:'OFICINA'` e
`/v1/license/status` aceita `product=OFICINA`. Omitir o produto continua
significando `PDV` para clientes legados.

## Segurança e critérios para produção

- A ativação pode ser feita apenas via API local da máquina principal; o
  servidor valida origem e produto antes de liberar autenticação/operacional.
- O estado local é JSON com permissões privadas e escrita atômica, **não é
  licença criptograficamente assinada**. O controle comercial não é resistência
  forte a adulteração por alguém com acesso ao sistema de arquivos ou ao código MIT.
- Confirmar migração e regressão de licenças PDV reais em staging;
  testar homologação Windows limpa, reinstalação, reativação e revogação,
  queda de internet e múltiplas instalações.
- Não executar migração D1 remota, deploy, merge ou edição de segredos
  sem QA verde e aprovação das alterações.
