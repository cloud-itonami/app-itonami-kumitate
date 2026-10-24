# kumitate CircleCI 互換 dapp — aiueos 上の分散型設計

状態: 第 1 スライスとブラウザの画面の実装（2026-10-23）。正本はこの文書です。
追跡: Linear JUN-346（Kotoba Labs）。兄弟: app-itonami-mihari、app-itonami-dandori（JUN-286、JUN-295）。

## 目標

kumitate を「サーバに何も置かない dapp」として作ります。

- CircleCI と互換なのは、**config の意味と API の形**です。
  - `.circleci/config.yml`（2.1）の検証と展開。
  - API v2 の Pipeline／Workflow／Job の形と status の enum（`kotoba-lang/com-circleci` の manifest と同じ）。
  - 実行記録と JUnit XML の読み取りと集計。
- 計算はすべて利用者の環境で行います。app の origin はロジックを持ちません。
- 外部への操作（CircleCI・VCS・job の実行）は、共有の同意 broker が着地するまでしません。

## 層構成

| 層 | 実体 | 状態 |
|---|---|---|
| 判断コア（pure） | `kotoba/kumitate/10-text` … `70-mcp`。YAML／JSON／XML、regex、expression、検証、展開、API v2、集計、MCP の handler。`:effects #{}` | **実装済み・実測**（gate 19/19、selftest 75/75、aarch64-linux と x86_64-linux） |
| アプリ記述子 | `aiueos/kumitate.edn`（`:aiueos/kind :app`、imports なし、`:aiueos/wasm "kumitate.wasm"`） | **実装済み**。aiueos の session／grant への配線は未実装 |
| wasm の産物 | `aiueos/kumitate.wasm`（`MANIFEST` の unit、amu selfhost root の `wasm32-browser`）と provenance・publication の記録 | **実装済み・実測**（headless Chromium で gate 19、selftest 75/75。native と出力がバイト単位で同じ） |
| native command | `90-cli`。`validate` `plan` `process` `api` `local` `runs` `runs-export` `junit` `mcp` `serve` `stdio` `selftest` | **実装済み・実測** |
| agent 統合（MCP） | `80-http`。native TCP（wire 43–47）の上の Streamable HTTP（JSON 応答）。tool は 8 つ | **実装済み・実測**（curl、itonami-agent の HTTP client） |
| stdio MCP | `85-stdio`。stdin（wire 41）の 1 行 1 message、答えごとに flush と `arena-scope`。tool は 8 つ | **実装済み・実測**（期待出力との一致、1 つずつ届くこと、Claude Code の MCP client。itonami-agent の stdio client は未試験） |
| ブラウザの画面 | `web/`。config を貼る／開く、検証、計画、DAG、processed config、実行記録と JUnit の集計。Worker の中の `kumitate.wasm` が計算する。CSP `connect-src 'none'` | **実装済み・実測**（headless Chromium。公開は主経路 `ipfs://` のみ、下記） |
| ローカル実行 | `local` が job ごとの手順を出す。実行はしない | 手順だけ実装。実行は**未実装・ブロック**（下記） |
| 本家 API・VCS への接続 | circleci.com、GitHub 等 | **未実装・ブロック**（同意 broker が無い） |
| 分散状態 | ADR 0005 の `mon`／`ito`／`nuno` | **未実装**（設計のみ） |

## 判断の規則（kumitate のもの）

**読む YAML** は 1.2 の core schema です。

- 読めるもの: anchor、alias（flow の中も）、merge key `<<`（書かれた key が勝つ）、block scalar（`|` `>`、`-` `+`、字下げの数字）、複数行の flow と quoted。
- 名前付きで拒否するもの: tab の字下げ、tag、複数 document、重複 key、知らない alias、flow の中の anchor、複雑な key。

**検証**（`config/*`）は構造を見ます。

- 対象: version、top-level key、parameters の型と default、executor の数と種類、step の形、command の名前、logic statement、workflow job の key、requires の status、matrix、filters、`<< parameters.x >>` と `<< pipeline.parameters.x >>` の参照先。
- orbs と `functions:` は外部コードです。取得せず、`config/orb-unresolved`／`config/function-unresolved` で拒否します。
- 名前を知らない top-level key は warning です（anchor の置き場として使われるため）。

**展開**（`plan/*`）は、CircleCI の processing の手順に沿います。

- pipeline parameters を束縛します。
- `<< >>` を名前か expression として代入します。値が scalar なら型を保ちます。
- executor（parameters 付き）を job に重ねます。job の key が勝ち、environment は key ごとに合わせます。
- command を展開します（深さ 16 まで。それより深い入れ子は `plan/command-recursion`）。`- steps: << parameters.x >>` は差し込みます。
- `when`／`unless` の step と workflow を決めます。
- matrix を展開します。名前は `job-値-値` で、値はパラメータ名の順です（CircleCI の docs の例と同じ）。exclude、alias、`<< matrix.x >>` を扱います。
- requires を解決します。名前か alias を引き、alias は全組み合わせを指します。status 付きの requires も読みます。
- 循環は `plan/requires-cycle` です。段（level）は最長経路で数えます。

**filters**

- branch の pipeline では branches の only／ignore を見ます。
- tag の pipeline では、tags.only がある job だけが動きます。
- expression の filter は、その式だけで決まります。
- 前段が動かない job は `plan/upstream-not-run` です（`not_run` を許す requires を除く）。
- 渡されなかった pipeline 値は「不明」です。不明な値に依る filter や `when` は決めません。job や workflow は残し、warning を出します。

**expression**

- 演算子は `and` `or`（値を返す短絡）、`not`、`==` `!=`、`starts-with`、`matches /re/`、`>=` `>` `<=` `<`、括弧です。
- falsy なのは false、null、0、"" です。
- null は `starts-with` と `matches` で false になります。branch の pipeline の tag は null です。
- 型の誤りは、その値が要るときだけ `expr/type` になります。

**API v2 の形**（`api`）は、パイプラインを作った直後に CircleCI が見せる形です。

- Pipeline は `created` です。config が拒否されたときは `errored` で、`errors[].type` は `config` になります。
- Workflow は `running` です。
- Job は、前段のあるものが `blocked`、前段の無い approval が `on_hold`、それ以外が `not_running` です。
- id は project_slug・number・created_at からの決定的な UUID 形の値です。`kumitate.projection: "created"`、`executes: false` を付けます。

**実行記録**（`runs`）が受けるもの:

- kumitate.runs.v1。
- API v2 の items のページ（workflow のページか job のページか）。
- `{workflows, jobs}`。

集計は、status の数、失敗した job（failed・infrastructure_fail・timedout）、job ごとの成功率（千分率）と平均時間、不安定な job（成功と失敗の両方があるもの）です。status が enum に無いもの（`runs/unknown-status`）と、時刻が ISO-8601 でないもの（`runs/bad-time`）は拒否します。書き出したものを読み直すと、同じ record になります（fixture で確かめています）。

**JUnit**: testcase を classname#name で束ね、次を出します。

- 報告ごとの数。
- 失敗した test。
- 不安定な test（ある報告で通り、別の報告で落ちたもの）。
- 遅い test（上位 10）。

DOCTYPE は拒否します（`xml/doctype-unsupported`）。外部 entity は読みません。

## ブラウザの層（end-user app 契約）

workspace の「Kotoba end-user apps run in the user's environment」契約に沿います。

- **origin は静的な産物を配るだけ**です。`web/` の HTML・CSS・JS と、スクリプトにした module（`kumitate.wasm.js`）です。request 時の処理、API、利用者ごとの状態はありません。
- **ロジックはブラウザの Worker** で動きます。`web/kotoba-host.js`（amu の Worker host）が `kumitate.wasm` を動かし、native と同じ command（`validate` `plan` `process` `runs` `junit`）を呼びます。`web/app.js` は入出力を運んで描くだけです。判断を JS に写していないので、native とブラウザの答えは食い違いません。
- **外部操作はありません**。ページの CSP は `default-src 'none'`、`connect-src 'none'` です。module の読み込みも fetch を使いません。`kotoba:host/cap` はすべての capability を拒否します（JUN-353 Phase 2 まで）。そのため、この段階では `kotoba.app.client-runtime.v1` の記述子も同意 broker もまだ要りません。本家 API や VCS に接続するときに、記述子と操作ごとの同意を足します（下記）。
- **module に渡すのは、その実行の入出力だけ**です（amu の entry ABI）。ページは wire 37／39（stdout・stderr）、38（引数）、35（ページが渡したファイルの読み取りだけ）を許します。貼った config や開いたファイルは、ページのメモリから Worker へ渡るだけで、どこにも保存しません。
- **module は検証してから動かします**。`kumitate.wasm.js` に入れた sha256 と照合します。出所は `aiueos/kumitate.wasm.provenance.edn`（amu の commit、root の hash、unit の hash）にあります。

## 未実装の境界

- **stdio の MCP の残り**:
  - wire 41 を許していない image は、最初の read で runtime の SIGILL の trap で止まります。どの wire かは出ません（amu の runtime の課題）。
  - 1 つの process は、stdin から読んだ bytes を string pool（256 MiB）に持ち続けます。埋まると runtime の budget の trap で止まるので、client が起こし直します。
- **ローカル実行・本家接続**:
  - job の実行（利用者のマシン、または browser Worker）、circleci.com の API v2、VCS は、共有の `kotoba.app.client-runtime.v1` 記述子と、操作ごとの同意が要ります。
  - その broker（`kotoba-lang/wasm-webcomponent/src/kotoba-client-runtime.js`）は、2026-10-23 の時点で存在しません（GitHub API で 404）。
  - workspace 契約により、product 側で代わりを書くことはしません。
  - 着地したら、記述子に service・endpoint・data category・`each-operation` を宣言します。宣言する操作は、たとえば `GET /api/v2/pipeline/{id}/workflow` と `GET /api/v2/workflow/{id}/job` です。
- **公開**: 経路は owner が決めました（2026-10-22、kumitate には 2026-10-23 に確認）。root ADR-2609092600 と ADR-2609109200、Linear JUN-320 の形です。記録は [`aiueos/kumitate.web.publication.edn`](../aiueos/kumitate.web.publication.edn) にあります。
  - **主経路 `ipfs://{cid}`: 着地。** `web/` の UnixFS directory の CID を gad の Kubo に pin しました（network-awai/cloud-itonami の `ops/independent/publish_app_ipfs.py --no-ipns`）。別の ISP の使い捨て Kubo から取り直し、バイト列と CID が一致しました。gateway の path 形と subdomain 形のどちらでも、ページが module の sha256 を照合して動きました。
  - **naming `ipns://{k51}`: 保留**（owner 判断）。
  - **補助経路 `kumitate.itonami.app`（DNSLink）: JUN-324 待ち。** registrar と DNS がまだ Cloudflare にあり、DNS の変更には owner の承認が要ります。
  - network-awai/cloud-itonami の `sites.edn` の app org に `:entry "kumitate"` で載せます。この repo の build には Node を入れません（cloud-itonami の目録の生成器は、その repo の既存の仕組みです）。
- **aiueos への配線**と**分散状態**: kaikei・dandori と同じ段階で、設計だけです。
