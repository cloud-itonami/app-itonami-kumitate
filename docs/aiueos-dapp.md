# kumitate CircleCI 互換 dapp — aiueos 上の分散型設計

状態: 第 1 スライスの実装（2026-10-23）。正本はこの文書です。
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
| 判断コア（pure） | `kotoba/kumitate/10-text` … `70-mcp`。YAML／JSON／XML、regex、expression、検証、展開、API v2、集計、MCP の handler。`:effects #{}` | **実装済み・実測**（gate 18/18、selftest 75/75、aarch64-linux と x86_64-linux） |
| アプリ記述子 | `aiueos/kumitate.edn`（`:aiueos/kind :app`、imports なし、`:aiueos/wasm nil`） | **実装済み**。aiueos の session／grant への配線は未実装 |
| native command | `90-cli`。`validate` `plan` `process` `api` `local` `runs` `runs-export` `junit` `mcp` `selftest` | **実装済み・実測** |
| agent 統合（MCP） | `80-http`。native TCP（wire 43–47）の上の Streamable HTTP（JSON 応答）。tool は 8 つ | **実装済み・実測**（curl、itonami-agent の HTTP client） |
| stdio MCP | static runtime に stdin（wire 41）が無い | **ブロック**（kotoba-lang/amu#1516） |
| ブラウザの画面 | config を貼る／開く、検証、計画、DAG、実行記録の集計。外部通信ゼロ | **ブロック**（kotoba-lang/amu#1515: selfhost に wasm32-browser が無い） |
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

## 未実装の境界

- **ブラウザの画面**: Kotoba だけで作る画面には、selfhost の wasm32-browser target が要ります（kotoba-lang/amu#1515。実測で `E1`）。hosted の `bin/amu`（Node/nbb）や scittle で作り直すことは、selfhost の契約でも JUN-295 の方針でもしません。画面は、#1515 が着地してから、判断コアをそのまま wasm にして作ります。
- **stdio の MCP**: static runtime に wire 41 が無いため作れません（kotoba-lang/amu#1516）。今は HTTP で代わりをしています。
- **ローカル実行・本家接続**:
  - job の実行（利用者のマシン、または browser Worker）、circleci.com の API v2、VCS は、共有の `kotoba.app.client-runtime.v1` 記述子と、操作ごとの同意が要ります。
  - その broker（`kotoba-lang/wasm-webcomponent/src/kotoba-client-runtime.js`）は、2026-10-23 の時点で存在しません（GitHub API で 404）。
  - workspace 契約により、product 側で代わりを書くことはしません。
  - 着地したら、記述子に service・endpoint・data category・`each-operation` を宣言します。宣言する操作は、たとえば `GET /api/v2/pipeline/{id}/workflow` と `GET /api/v2/workflow/{id}/job` です。
- **公開**（sites.edn、`itonami deploy app/kumitate`、IPNS）: ブラウザで動く産物が無いので、公開するものがまだありません。
- **aiueos への配線**と**分散状態**: kaikei・dandori と同じ段階で、設計だけです。
