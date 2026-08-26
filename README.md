# Aura Bae — aplicação integrada

Aplicação full-stack para mobilidade local em Barreirinha-AM. O mesmo Cloudflare
Worker serve o site e uma API privada, usando Cloudflare D1 para armazenar os dados
e Asaas para criar cobranças Pix dinâmicas.

## O que está implementado

- Cadastro e login com telefone, CPF e senha protegida por PBKDF2.
- Sessão em cookie `HttpOnly`, `Secure` e `SameSite=Strict`.
- Entrada separada para passageiro e motorista, com menus e áreas diferentes.
- A mesma conta pode ter perfil de passageiro e também ativar um perfil de motorista.
- Ativação automática do perfil de motorista com CPF, fotos e dados do veículo.
- Perfil completo, alteração de senha e tutoriais de primeiro acesso.
- Recuperação de senha assistida pelo administrador com link único de 15 minutos.
- Visual escuro simplificado em grafite e verde, com cartões de alto contraste e navegação confortável no celular.
- Central administrativa com mapa urbano escuro, motoristas online e rotas ativas.
- Localização real dos motoristas online e prioridade por proximidade.
- Acompanhamento do motorista no mapa, rota até o passageiro e fotos do cadastro.
- Mapa compacto na tela principal e modo ampliado para marcação manual.
- Pesquisa de saída e destino somente ao tocar em `Buscar`, com resultados limitados a Barreirinha.
- Mapa urbano noturno mais claro, com ruas, comércios e pontos de interesse cadastrados no OpenStreetMap.
- Rotas viárias e cálculo de preço feito também no servidor.
- Mototáxi, motocarro e carro, com mototáxi selecionado inicialmente.
- Pagamento Pix criado somente quando o motorista confirma a chegada.
- QR Code dinâmico e Pix Copia e Cola retornados pelo Asaas.
- Confirmação somente pelo evento `PAYMENT_RECEIVED` do webhook.
- Carteira pré-paga do motorista para corridas recebidas em dinheiro.
- Recarga da carteira por Pix, com QR Code e código Copia e Cola do Asaas.
- Em dinheiro, o sistema desconta da carteira somente a comissão e a taxa fixa.
- Comissão de 10% sobre a corrida e taxa fixa de R$ 1,00.
- Cancelamento automático de chamadas sem atualização por 5 minutos.
- Cancelamento manual do passageiro sem cobrança, com aviso de uso responsável antes da confirmação.
- Limpeza automática dos pontos e da rota assim que a corrida do passageiro termina.
- Livro-caixa interno para o saldo do motorista.
- Rotina de repasse diário preparada, mas desligada por segurança até a homologação.
- Duas contas de demonstração, criadas pelo administrador somente no Sandbox.

## Estrutura

- `public/`: site e PWA.
- `src/worker.js`: API, autenticação, corridas, Asaas e tarefas agendadas.
- `migrations/`: banco de dados D1.
- `wrangler.jsonc`: configuração do Cloudflare Worker.
- `GUIA_PUBLICAR.md`: instruções de publicação sem expor credenciais.

O nome do Worker no `wrangler.jsonc` é `aura-bae`, igual ao projeto já publicado.

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

## Observação sobre o mapa

A pesquisa pública do Nominatim é acionada somente pelo botão `Buscar`, passa pelo
Worker e usa cache. Não transforme essa pesquisa em autocomplete. Os pontos comerciais
mostrados dependem dos dados que estiverem cadastrados no OpenStreetMap. Para operação
comercial em maior escala, contrate geocodificação e rotas com suporte e SLA próprios.
