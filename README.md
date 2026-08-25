# Aura Bae — aplicação integrada

Aplicação full-stack para mobilidade local em Barreirinha-AM. O mesmo Cloudflare
Worker serve o site e uma API privada, usando Cloudflare D1 para armazenar os dados
e Asaas para criar cobranças Pix dinâmicas.

## O que está implementado

- Cadastro e login com telefone, CPF e senha protegida por PBKDF2.
- Sessão em cookie `HttpOnly`, `Secure` e `SameSite=Strict`.
- A mesma conta pode usar os modos passageiro e motorista.
- Ativação automática do perfil de motorista com CPF, fotos e dados do veículo.
- Perfil completo, alteração de senha e tutoriais de primeiro acesso.
- Recuperação de senha assistida pelo administrador com link único de 15 minutos.
- Central administrativa com mapa de satélite, motoristas online e rotas ativas.
- Localização real dos motoristas online e prioridade por proximidade.
- Rotas viárias e cálculo de preço feito também no servidor.
- Mototáxi, motocarro e carro.
- Pagamento Pix criado somente quando o motorista confirma a chegada.
- QR Code dinâmico e Pix Copia e Cola retornados pelo Asaas.
- Confirmação somente pelo evento `PAYMENT_RECEIVED` do webhook.
- Pagamento em dinheiro e registro do valor devido pela comissão.
- Comissão de 10% sobre a corrida e taxa fixa de R$ 1,50.
- Cancelamento automático de chamadas sem atualização por 5 minutos.
- Livro-caixa interno para o saldo do motorista.
- Rotina de repasse diário preparada, mas desligada por segurança até a homologação.

## Estrutura

- `public/`: site e PWA.
- `src/worker.js`: API, autenticação, corridas, Asaas e tarefas agendadas.
- `migrations/`: banco de dados D1.
- `wrangler.jsonc`: configuração do Cloudflare Worker.
- `GUIA_PUBLICAR.md`: instruções de publicação sem expor credenciais.

## Segurança

Nunca coloque a chave do Asaas no código, em arquivos do projeto, no GitHub ou em
mensagens. Cadastre-a como **Secret** no Cloudflare.

O ambiente inicial é `sandbox`. Só mude para `production` depois de testar todos os
fluxos. Os repasses automáticos também começam desligados.

## Comandos

```bash
npm install
npm run check
npm run dev
npm run deploy
```

O comando `npm run deploy` aplica primeiro as migrações do D1 e depois publica o Worker.
