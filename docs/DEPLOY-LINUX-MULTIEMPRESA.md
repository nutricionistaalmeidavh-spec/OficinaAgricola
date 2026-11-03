# Deploy Linux multiempresa (sem dependência paga)

## Instalação

O servidor ArtiSys Oficina pode rodar em Debian/Ubuntu ou outra distribuição com Node.js >=22.16.0. A licença do core é MIT. O banco SQLite e os arquivos ficam no próprio servidor.

1. Crie usuário de serviço não privilegiado (artisys) e diretório /srv/artisys-oficina com dono desse usuário.
2. Instale o repositório na pasta /opt/artisys-oficina. Execute npm ci com a versão do Node exigida pelo package.json.
3. Copie deploy/linux/artisys-oficina-multi.service para /etc/systemd/system. Ajuste WorkingDirectory e ExecStart se seu checkout estiver em outra pasta.
4. Inicie: sudo systemctl daemon-reload && sudo systemctl enable --now artisys-oficina-multi.
5. Confirme GET http://127.0.0.1:3344/api/health no host. O modo multiempresa devolve mode=multiempresa.
6. Instale Caddy/Nginx aberto, configure DNS e use HTTPS público. Exemplo em deploy/linux/Caddyfile.example.
7. Faça setup inicial apenas via localhost no próprio servidor; não exponha setup inicial numa instância ainda não configurada.
8. Faça backup externo do volume /srv/artisys-oficina/backups, incluindo o registro e unidades. Teste restauração em outro servidor.

O core funciona sem Cloudflare, AWS, serviço de banco pago ou licenciamento mensal. O custo da VPS, domínio ou tráfego, caso contratados, é infraestrutura escolhida pelo cliente.

## Operação

- Bancos das filiais ficam em TENANCY_DATA_ROOT/company-ID/unit-ID/oficina.sqlite.
- Usuários, sessões e vínculos ficam no TENANCY_REGISTRY_PATH. Arquivos são gravados em uploads exclusivos por unidade.
- Evite executar o modo tradicional e o multiempresa simultaneamente apontando para o mesmo SQLite legado.
- Use HTTPS, atualize o sistema operacional, restrinja portas, proteja backups, monitore capacidade em disco e valide regressões em staging antes de atualizar.
- O novo motor de storage ainda não integra PostgreSQL/D1/R2/MinIO; esta receita usa SQLite + disco e NÃO representa compatibilidade cloud nativa.

## Segurança de rede

O processo Node permanece ligado a 127.0.0.1 e o reverse proxy no mesmo host encerra HTTPS. Não configure HOST=0.0.0.0 sem certificados válidos diretamente no Node; a aplicação impede abertura remota em HTTP por padrão.

Para várias empresas completamente isoladas, use empresas/unidades com autenticação no registro central e confirme sempre o contexto antes das operações.
