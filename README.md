# pessoal: controle financeiro

Sisteminha pessoal para gerir gastos do mês, inspirado em uma planilha de planejamento financeiro.
Roda direto no navegador: abra o `index.html`. Não precisa instalar nada.

## O que tem

- **Planejamento mensal**: navegue entre os meses e copie a estrutura (categorias, orçamentos, cartões) do mês anterior.
- **Distribuição do orçamento**: percentuais editáveis por categoria (padrão 55% essenciais, 10% não essenciais, 20% economias, 15% dívidas). O valor "Alocar" de cada seção é calculado a partir da renda.
- **Indicadores**: entradas, gasto total, gasto à vista, gasto no cartão, economias e saldo.
- **Fluxo de caixa**: real x orçamento por categoria, com a diferença.
- **Seções** Renda, Essenciais, Não essenciais, Economias e Dívidas: itens com orçamento, valor real, % usado e checkbox de pago.
- **Controle das faturas**: por cartão, com parcelas de meses anteriores + compras do mês.
- **Transações**: cada lançamento (data, descrição, categoria, item, à vista ou cartão) alimenta automaticamente os valores "Real".
- **Gráficos**: detalhamento da renda, caixa real, real x orçamento e gastos não essenciais por item.
- **Backup**: exportar e importar todos os dados em JSON.

## Onde ficam os dados

No `localStorage` do navegador, só no seu aparelho. Exporte um backup de vez em quando:
limpar os dados do navegador apaga tudo.

## Publicar (opcional)

Em Settings → Pages do repositório, publique a branch `main` (pasta raiz) para acessar pelo celular.

## Deploy no cPanel

Todo push na `main` envia os arquivos por FTP para `/home2/leticiabento.com.br/public_html/pessoal`
(workflow em `.github/workflows/deploy.yml`). Também dá para rodar manualmente em Actions → "Deploy no cPanel" → Run workflow.

Configuração (uma vez só):

1. No cPanel, em **Contas de FTP**, crie uma conta cujo diretório seja `/home2/leticiabento.com.br/public_html/pessoal`.
2. No GitHub, em **Settings → Secrets and variables → Actions**, crie os secrets
   `FTP_SERVER` (ex.: `ftp.leticiabento.com.br`), `FTP_USERNAME` (usuário completo, com `@leticiabento.com.br`) e `FTP_PASSWORD`.
