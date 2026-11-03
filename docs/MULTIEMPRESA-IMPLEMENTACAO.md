# Multiempresa — implementação incremental

## Contrato
Uma empresa pode possuir múltiplas unidades; um usuário pode ter vínculos distintos com empresas diferentes. Todos os recursos sensíveis (clientes, veículos, OS, financeiro, estoque, documentos, auditoria) devem ser filtrados por empresa no servidor, nunca apenas na UI.

## Infraestrutura suportada (meta)
- Core local: SQLite e arquivos em disco.
- VPS/servidor Linux: PostgreSQL e disco/MinIO.
- Cloudflare opcional: D1 e R2.
- Provedores pagos não são dependências obrigatórias.

## Estado desta branch
Primeiro componente de segurança: validador fail-closed de contexto empresa/unidade e helper de escopo SQL parametrizado, com testes unitários. **Ainda não conectado às rotas nem às consultas legadas. Não há isolamento multiempresa de produção nesta etapa.**

## Próximas etapas obrigatórias
1. Inventariar todas as tabelas e rotas e definir ownership por empresa/unidade, incluindo registros globais.
2. Criar migrações aditivas e reversíveis, com empresa padrão para dados legados e backup anterior.
3. Persistir memberships e sessões, validar vínculo em cada request, autorização por papel e unidade.
4. Aplicar escopo no repositório de dados e em TODAS as rotas (inclusive exportações, pesquisa, PDFs, uploads e jobs).
5. Implementar adaptadores SQLite/PostgreSQL/D1 e disco/MinIO/R2 com testes de contrato idênticos.
6. Validar concorrência, sincronização offline, índices, auditoria, isolamento cruzado, E2E e restauração.
7. Expor seleção de empresa/unidade na interface somente após backend seguro.

Não fazer merge nem deploy até testes e gates de regressão aprovados. Não modificar secrets.
