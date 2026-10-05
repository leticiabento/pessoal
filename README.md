# pessoal: controle financeiro

Sisteminha pessoal para gerir gastos do mês, inspirado em uma planilha de planejamento financeiro.
Front-end em HTML/CSS/JS puro e uma API pequena em PHP que guarda os dados no MySQL, com acesso por senha.

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

No MySQL do cPanel, numa tabela `app_state` (um documento JSON com todos os meses), criada
automaticamente no primeiro acesso. Assim os dados sincronizam entre computador e celular.

- **Login:** senha única, definida no secret `APP_PASSWORD`. A sessão dura 30 dias por aparelho.
  Após 5 senhas erradas, o acesso fica bloqueado por 15 minutos para aquele IP.
- **Conflitos:** se o mesmo dado for alterado em dois aparelhos ao mesmo tempo, o segundo recebe um aviso
  e recarrega a versão mais recente em vez de sobrescrever.
- **Dados antigos:** se o navegador tiver dados da versão anterior (salvos só no navegador),
  o app oferece enviá-los ao servidor no primeiro acesso.
- O "Exportar backup" continua disponível.

API (`api/index.php`): `?action=session` (GET), `login` (POST), `logout` (POST), `state` (GET/PUT).

## Deploy no cPanel

Todo push na `main` envia os arquivos por FTP para `/home2/leticiabento.com.br/public_html/pessoal`
(workflow em `.github/workflows/deploy.yml`). Também dá para rodar manualmente em Actions → "Deploy no cPanel" → Run workflow.

Configuração (uma vez só):

1. No cPanel, em **Contas de FTP**, crie uma conta cujo diretório seja `/home2/leticiabento.com.br/public_html/pessoal`.
2. No cPanel, em **Bancos de dados MySQL**, crie um banco e um usuário, e adicione o usuário ao banco com **todos os privilégios**.
3. No GitHub, em **Settings → Secrets and variables → Actions**, crie os secrets:
   - `FTP_SERVER` (ex.: `ftp.leticiabento.com.br`), `FTP_USERNAME` (usuário completo, com `@leticiabento.com.br`) e `FTP_PASSWORD`
   - `DB_NAME` e `DB_USER` (com o prefixo do cPanel, ex.: `usuario_financas`), `DB_PASS`
   - `DB_HOST` (opcional, padrão `localhost`)
   - `APP_PASSWORD`: a senha que você vai digitar para entrar no app

O deploy gera `api/config.php` a partir desses secrets; ele nunca vai para o repositório.
