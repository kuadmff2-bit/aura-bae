# Publicação do Aura Bae no Cloudflare

## Antes de começar

Você precisará de:

1. Conta Cloudflare.
2. Repositório GitHub contendo todos os arquivos deste projeto.
3. Chave de API do Asaas guardada em segurança.
4. Uma chave de API Sandbox para os primeiros testes, recomendada pelo Asaas.

Não envie as chaves para outra pessoa e não coloque nenhuma delas no GitHub.

## 1. Envie o projeto para o GitHub

Crie um repositório privado chamado `aura-bae` e envie o conteúdo desta pasta. O
arquivo `wrangler.jsonc` precisa ficar na raiz do repositório.

## 2. Importe o GitHub no Cloudflare

1. Abra **Workers & Pages**.
2. Clique em **Create application**.
3. Em **Import a repository**, clique em **Get started**.
4. Conecte o GitHub e selecione o repositório `aura-bae`.
5. Deixe o comando de build vazio.
6. Em **Deploy command**, use `npm run deploy`.
7. Salve e aguarde a implantação.

O Wrangler provisionará o banco D1 chamado `aura-bae-db` e aplicará a migração.

## 3. Cadastre os segredos no Cloudflare

Abra o Worker criado e acesse:

**Settings > Variables and Secrets > Add**

Cadastre como tipo **Secret**:

| Nome | Valor |
|---|---|
| `ASAAS_API_KEY` | Chave do ambiente Asaas utilizado |
| `ASAAS_WEBHOOK_TOKEN` | Token aleatório com pelo menos 32 caracteres |
| `ADMIN_SETUP_TOKEN` | Outro token aleatório com pelo menos 32 caracteres |

Os dois tokens precisam ser diferentes. Você pode criá-los localmente com:

```bash
node scripts/generate-secrets.mjs
```

Nunca use a chave de API do Asaas como token do webhook.

## 4. Teste primeiro no Sandbox

O projeto começa com:

```text
ASAAS_ENVIRONMENT=sandbox
AUTOMATIC_PAYOUTS_ENABLED=false
```

Coloque em `ASAAS_API_KEY` uma chave iniciada por `$aact_hmlg_`. Faça cadastros e
simule uma corrida completa antes de ativar dinheiro real.

## 5. Crie o administrador

Abra o endereço `workers.dev` gerado. No primeiro acesso aparecerá a tela
**Configurar administrador**.

Preencha:

- o mesmo valor salvo em `ADMIN_SETUP_TOKEN`;
- nome, telefone e CPF do administrador;
- uma senha forte com no mínimo 8 caracteres.

A tela de configuração desaparece depois que o primeiro administrador é criado.

## 6. Configure o webhook no Asaas

Depois que o Worker estiver publicado, acesse no Asaas:

**Integrações > Webhooks > Adicionar webhook**

Use:

- Nome: `Aura Bae - Pagamentos`;
- URL: `https://SEU-WORKER.workers.dev/webhooks/asaas`;
- E-mail: `kuadmff2@gmail.com`;
- Token: exatamente o valor salvo em `ASAAS_WEBHOOK_TOKEN`;
- Tipo de envio: sequencial;
- Ativado: sim;
- Interrompido: não.

Eventos necessários:

- `PAYMENT_RECEIVED`;
- `PAYMENT_REFUNDED`;
- `PAYMENT_PARTIALLY_REFUNDED`.

O sistema só considera o Pix pago quando recebe `PAYMENT_RECEIVED`.

## 7. Teste com passageiro e motorista

1. Cadastre um motorista com CPF, veículo e chave Pix.
2. Entre como administrador e aprove o cadastro.
3. No celular do motorista, permita a localização e fique disponível.
4. Em outro aparelho, cadastre um passageiro e solicite a corrida.
5. O motorista aceita, inicia e confirma a chegada.
6. Nesse momento o QR Code Pix é criado.
7. Após o webhook confirmar o recebimento, o passageiro avalia a corrida.

## 8. Mude para produção

Somente depois da homologação:

1. Troque `ASAAS_ENVIRONMENT` no `wrangler.jsonc` de `sandbox` para `production`.
2. No Cloudflare, substitua `ASAAS_API_KEY` pela chave de produção iniciada por
   `$aact_prod_`.
3. Publique novamente.
4. Faça uma corrida real de valor mínimo e confirme todo o extrato.

## 9. Repasse diário

A rotina está agendada para 00:15 no horário de Manaus, mas começa desligada. Antes
de ativá-la, teste uma transferência Pix manual pela API e confira as exigências de
autorização de operações críticas do Asaas.

Depois da validação, mude:

```text
AUTOMATIC_PAYOUTS_ENABLED=true
```

Se o pagamento for Pix, o motorista recebe um crédito de 90% da corrida no saldo
interno. Se for dinheiro, a comissão de 10% e a taxa de R$ 1,50 ficam como débito e
são compensadas nos próximos repasses.

## Importante antes de abrir ao público

- Adicionar armazenamento R2 para as fotos do motorista e do veículo.
- Contratar um serviço de mapas/rotas com garantia para produção; o roteador público
  usado no projeto não oferece SLA comercial.
- Publicar Termos de Uso e Política de Privacidade compatíveis com a LGPD.
- Testar cancelamentos, reembolsos e indisponibilidade do Asaas.
- Confirmar com contador a parte fiscal e a forma de registrar as comissões.
