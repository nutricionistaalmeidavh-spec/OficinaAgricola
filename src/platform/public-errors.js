// Não expor mensagens de infraestrutura nas respostas HTTP.
const GENERIC='Não foi possível concluir a operação. Tente novamente ou consulte o suporte.';
const SENSITIVE=/SQLITE_|SQLITE\b|UNIQUE constraint|FOREIGN KEY constraint|NOT NULL constraint|database is locked|no such table|no such column|SQL logic error|(?:^|\s)(?:TypeError|ReferenceError|SyntaxError|RangeError|AggregateError|ERR_[A-Z_]+|EACCES|ENOENT|ECONN\w*|ETIMEDOUT)\b|\b(?:stack|traceback|node:internal|file:\/\/|\/src\/|\\src\\|\.sqlite|\.db\b|\.env\b|token\s*[:=]|password\s*[:=]|secret\s*[:=]|authorization\s*[:=]|bearer\s+[a-z0-9._-]+)/i;
const PUBLIC_TEXT=/^(?:Acesso|Ação|Arquivo|Ajuste|Anexo|Apenas|Assinatura|Autorização|Baixa|Caixa|Cancelamento|Categoria|Certificado|Cliente|Código|Comando|Configuração|Conflito|Consulta|Credenciais|Data|Desconto|Documento|Emissão|Emissor|Equipamento|Erro de validação|Estoque|Evento|Falha de validação|Forma de pagamento|Horário|Informe|Item|Já |Limite|Máquina|Manutenção|Motivo|Movimentação|Nenhum|Nenhuma|Não |Número|O |Operação|Ordem|Origem|Pagamento|Peça|Permissão|Plano|Preencha|Produto|Protocolo|Quantidade|Recebimento|Registro|Requisição|Resposta|Saldo|Selecione|Senha|Sessão|Situação|Só |Status|Técnico|Tentativa|Totais|Transição|Usuário|Valor|Venda|Versão|Vínculo)/i;
export function publicErrorMessage(error){
  const message=String(error?.message||'').trim();
  if(!message||message.length>240||/[\r\n\t\x00-\x1f]/.test(message)||SENSITIVE.test(message))return GENERIC;
  if(error instanceof TypeError||error instanceof ReferenceError||error instanceof SyntaxError||error instanceof RangeError)return GENERIC;
  return PUBLIC_TEXT.test(message)?message:GENERIC;
}
