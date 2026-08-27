# Aura Bae para Android

Aplicativo Android conectado ao Worker publicado em
`https://aura-bae.kuadmff2.workers.dev`.

## Funções nativas

- tela de abertura, ícone e execução em tela cheia;
- localização concedida ao site pelo WebView;
- seleção de imagens e câmera para fotos de perfil e veículo;
- links externos, incluindo WhatsApp;
- serviço visível de localização enquanto o motorista estiver disponível;
- verificação periódica de novas corridas e aviso no Android;
- sessão compartilhada com o site e botão Voltar integrado.

O motorista ativa o serviço apenas ao tocar em **Ficar disponível**. O Android mantém
uma notificação permanente enquanto a localização estiver sendo enviada.

## Compilar

O workflow `gerar-apk-aura-bae.yml` compila automaticamente o APK de teste e o publica
na release `aplicativo-aura-bae` do GitHub.

Para a Play Store, crie uma chave de upload privada, configure a assinatura de release
e envie um Android App Bundle (`.aab`) pela Play Console. Nunca coloque a chave de
assinatura dentro deste repositório público.
