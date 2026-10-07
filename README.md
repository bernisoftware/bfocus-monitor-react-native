# @bfocus/monitor-react-native

Monitoramento de erros do [bFocus](https://bfocus.com.br) para React Native (Hermes e JSC). Os
erros do seu app chegam ao bFocus, são agrupados pela causa entre todos os clientes e viram demanda
para a equipe — com a versão do app, o ambiente e o cliente afetado.

Zero dependências (só `react` como peer). Nunca derruba o app: o handler global que já existia
continua rodando (tela vermelha em dev, crash em produção — tudo igual), o envio é em segundo plano.

## Instalar

```sh
npm install @bfocus/monitor-react-native
```

## Ligar (uma linha)

```js
import * as monitor from '@bfocus/monitor-react-native'

monitor.init({ key: 'bf_mon_…', release: '1.4.2' }) // environment padrão: production
```

Isso já captura:

- erros não tratados (`ErrorUtils.setGlobalHandler`, encadeando o anterior; erro fatal vai com
  nível `fatal` e é enviado — com teto de 2 s — antes de o app cair);
- rejeições de promessa não tratadas (rastreador do Hermes; fora do Hermes, o
  `promise/setimmediate/rejection-tracking` quando disponível).

No `init` sai um sinal de vida, para o painel saber que o app está rodando mesmo sem erro.

Opções: `key` (obrigatória), `release`, `environment`, `baseUrl`, `sampleRate` (0..1), `ignore`
(textos ou RegExp), `beforeSend(event)` (devolva o evento alterado ou `null` para descartar),
`autoCapture` (padrão `true`).

## Tela quebrada

```jsx
<monitor.ErrorBoundary fallback={<Text>Algo deu errado</Text>}>
  <App />
</monitor.ErrorBoundary>
```

`fallback` também pode ser uma função `({ error, resetError }) => ...`.

## Quem foi afetado

O bFocus só liga o erro ao cliente e à pessoa com a identidade assinada — a MESMA assinatura v2 que
o seu servidor já entrega ao widget (`userHash`). O segredo nunca vai para o app.

```js
monitor.setUser({ externalId: 'u-123', userHash }, { externalId: 'cliente-9' }) // depois do login
monitor.setUser() // logout
```

## Manual

```js
monitor.captureException(err, { level: 'warning', tags: { tela: 'pedido' } })
monitor.captureMessage('estoque negativo', 'info')
monitor.setTag('tela', 'pedido')
monitor.addBreadcrumb('nav', 'abriu Pedido 42')
await monitor.flush(2000)
```

Lote a cada 1 s ou 20 eventos; 429/5xx/rede → uma nova tentativa depois de 2 s; 401/403 → para de
enviar até o próximo `init`. O mesmo erro sai no máximo uma vez a cada 30 s, e no máximo 100 por
minuto.

## Licença

MIT — Berni Software.
