# Claude Decisions

OpenAI Decisions形式のAPIを、固定モデル `claude-haiku-5-5` で実行するTypeScriptサーバーです。ローカル実行・依存管理・テストにはBunを使います。モデルの指定は不要で、送信された `model` は無視します。レスポンスには実際のClaudeモデルIDを返します。

## ローカル起動

Bun 1.3.12以上を使用します。

```sh
bun install --frozen-lockfile
cp .env.example .env
```

`.env` に `ANTHROPIC_API_KEY` と `DECISIONS_API_TOKEN` を設定してから起動します。認証情報はコミットしません。

```sh
bun start
```

既定のURLは `http://127.0.0.1:3000/v1/decisions`。`PORT` で変更できます。開発時の自動再起動は `bun dev` です。

```ts
const response = await fetch("http://127.0.0.1:3000/v1/decisions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.DECISIONS_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    input: "Payment was charged twice.",
    questions: [
      {
        type: "predicate",
        name: "duplicate_payment",
        instructions: "Is this about a duplicate payment?",
      },
    ],
  }),
});
console.log(await response.json());
```

公式 `openai` SDKも `baseURL: "http://127.0.0.1:3000/v1"` で接続できます。SDKの型では `model` が必須なので、`model: "claude-haiku-5-5"` を渡してください。サーバーはその値を切り替えには使いません。

## 対応範囲

- predicate、文字列・booleanのchoice、2〜10段階のscore、質問単位のrefusal。
- 最大400質問。20質問または選択肢600個を目安に分割し、最大3チャンクを並列実行。結果はIDで照合し入力順に統合。
- user・developer・system・assistantの会話履歴、function/custom toolの呼び出しと出力、JSON、質問内画像・JSON。
- BunではHTTP(S)画像URLとBase64画像。PNG/JPEG/GIF/WebP、1画像5 MiBまで。
- Bearer認証、起動時設定検証、JSON・スキーマエラー、上流認証・制限・障害・タイムアウトの区別。
- 接続先IPを検証して固定し、リダイレクトごとに再検証。TLSのホスト名検証を有効にしたまま、内部IP・メタデータ・ローカル宛てを拒否。

入力履歴は引用された証拠として扱い、ロール名やJSONキーをClaudeのシステム命令に昇格させません。Structured OutputsはAnthropic公式SDKの変換ヘルパーを使い、出力を改めて検証します。確率はサーバーで正規化し、choiceは最初の最大値を選択、scoreは0始まりの期待値を計算します。confidenceはモデルが独立に推定した値で、最大確率に置き換えません。

## 構成

`contract` → 公開スキーマ、`application` → 分割・集計・回答変換、`ports` → 推論・資格情報・認証・画像取得の境界、`adapters` → Anthropicと画像通信、`http` → Hono、`entrypoints` → Bun/Workersの依存組み立てです。CoreはBun・環境変数・Hono・Anthropic SDKに依存しません。

CredentialStoreはリクエスト実行時にキーを取得します。D1等への変更はこのインターフェースを実装します。APIキー発行・課金・D1保存は含みません。

## Cloudflare Workers / AI Gateway

```sh
bun run worker:check
```

デプロイしないビルド検証です。Workers実行環境の統合テストも `bun test` に含めます。Workersには `ANTHROPIC_API_KEY` と `DECISIONS_API_TOKEN` をSecretsとして設定します。デプロイはこのリポジトリでは実行していません。

Gatewayを使う場合は `TRANSPORT=gateway`、`CF_ACCOUNT_ID`、`CF_GATEWAY_ID` を設定します。認証付きGatewayには `CF_AIG_TOKEN` も設定します。provider keyは実行ごとにCredentialStoreから取得し `x-api-key` で送信します。Gatewayの本文ログ収集は送信ヘッダーで無効化します。

**Workersの現時点の制限：リモートURL画像は拒否し、Base64画像のみを受け付けます。** WorkersのHTTP APIはDNSのlookup指定に対応しないため、Bun用の接続先固定をそのまま流用しません。安全な画像取得アダプターを追加すれば、Coreの変更なしでURL画像を有効にできます。

## 検証

```sh
bun test
bun run typecheck
bun run format:check
bun run contract:generate
bun run worker:check
```

通常のテストは外部のモデルAPIを呼びません。公式OpenAI SDKからの実HTTP通信、Workersの実行環境、DNS固定接続、リダイレクト検証、400質問、SDK型に照合した入力を検証します。

APIキーを設定した環境でのみ次を実行します。実APIの料金が発生します。

```sh
RUN_LIVE_TESTS=1 bun test tests/live.test.ts
```

2026-10-28に、画像・JSON・predicate/choice/scoreを含むHaiku 5.5実APIのE2Eが成功しました。通常テスト100件も成功しています。OpenAI実APIによる適合性比較は未実施です。

## 互換性と運用上の差異

- OpenAI SDK 7.45.1の `DecisionCreateParams` / `Decision` と型を照合しています。`model` の省略可能化・無視は意図した変更です。推論精度や確率の校正がOpenAIと一致する保証はありません。
- `usage` はAnthropicの計測値です。入力は通常入力・キャッシュ読込・書込の合計、出力は上流の包括的な出力数。reasoningは上流の `thinking_tokens` が得られた場合に使用し、未提供なら0です。チャンクごとに入力が再送されるため、使用量にも重複が含まれます。
- キャッシュキーは証拠の前に置く区分情報として使用します。明示breakpointは最新4箇所まで、implicitでは入力末尾にも境界を置きます。OpenAIの30分TTLはAnthropicの1時間TTLに対応させています。キャッシュの保持期間、最小トークン数、課金、命中率は同一ではありません。
- `safety_identifier` は検証して受理しますが、認証主体やAnthropic上の利用者IDとして使用しません。
- HTTP本文は32 MiBまで、同時処理はプロセス当たり8リクエストまで（超過は429）。分散レート制限ではありません。全体120秒、上流60秒、画像取得10秒、上流リトライは最大1回です。
- JSONの深さ32・値数10,000・compact UTF-8で256 KiBの制約や、ツール出力と先行呼び出しの一致は実行時に検証します。OpenAPIだけではこれらの相関制約を表現しきれません。
- provider全体のrefusal、途中終了、不正形式、障害は質問単位refusalに偽装せずエラーにします。

## 一次資料

2026-10-28に以下とインストール済み公式SDKの公開型を確認しました。

- [OpenAI Decisions create](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create)
- [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
- [Anthropic Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Claude models](https://platform.claude.com/docs/en/models/overview)
- [Cloudflare Anthropic Gateway](https://developers.cloudflare.com/ai-gateway/usage/providers/anthropic/)
- [Workers HTTP APIの制約](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
