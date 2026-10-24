# app-itonami-kumitate

**kumitate（組み立て）は CircleCI 互換の itonami dapp です。** `.circleci/config.yml` を読み、パイプラインがどう組み立てられるかを計算します。何も実行しません。

- config.yml（version 2.1）を検証します。拒否するときは名前付きの理由を返します。
- 展開後の計画を出します。CircleCI の `config process` とパイプライン作成にあたる計算です。
  - パラメータの代入、executor と command の展開、`when`／`unless`、matrix の展開、branch／tag の filter と expression の filter、`requires` の DAG、段（level）ごとの並列度を扱います。
- CircleCI API v2 の Pipeline／Workflow／Job の形で書き出します。
- 利用者が持っている実行記録（API v2 の items、kumitate.runs.v1）と JUnit XML を読み、失敗・不安定・遅いものを集計します。
- ブラウザの画面（`web/`）でも同じ計算をします。同じ Kotoba の command を amu selfhost が wasm にしたものを、ブラウザの Worker で動かします。外部通信はゼロです。

書き方は **Kotoba だけ**です。ビルドとテストには amu selfhost の root compiler だけを使います。scittle・CLJS・kbb・nbb・Node・JVM・C は使いません。orbs と CircleCI functions は取得しません。CircleCI と VCS には接続しません。

追跡: Linear JUN-346（Kotoba Labs）。兄弟: [mihari](https://github.com/cloud-itonami/app-itonami-mihari)（Sentry 互換）、[dandori](https://github.com/cloud-itonami/app-itonami-dandori)（Linear 互換）。

この README は、**今この repo に何が在って何が動くか**を書きます。未実装の境界とブロッカーは [`docs/aiueos-dapp.md`](docs/aiueos-dapp.md) にあります。

## 互換の範囲

| 互換である | 互換ではない |
|---|---|
| config.yml 2.1 の jobs／workflows／executors／commands／parameters（pipeline・job・command・executor）／matrix（exclude・alias）／`when`・`unless`（logic statement と expression）／`requires`（status 付きを含む）／filters（branches・tags・正規表現・expression） | orbs・inline orb・`functions:`・`job-groups`（名前付きで拒否する） |
| expression: `filters: pipeline.git.branch == "main"`、`<< pipeline.git.branch == "main" and 10 or 1 >>`、`starts-with`・`matches`・`not`・比較・括弧 | version 2／2.0 の config（`config/version-unsupported`／`config/version-missing`） |
| `circleci config process` の形の YAML（version 2、matrix の job 名は `job-値-値`、値はパラメータ名順） | setup workflow の continuation、scheduled triggers の評価（warning で知らせる） |
| API v2 の status enum（`kotoba-lang/com-circleci` の manifest と同じ） | ジョブの実行、circleci.com・GitHub 等への接続 |

- YAML は 1.2 の core schema で読みます。`yes`／`no`／`on`／`off` は文字列のままです（CircleCI 自身の 1.1 系 reader は真偽値として読むことがあります）。
- tag の pipeline では、tags filter の無い job は動きません（CircleCI の規則）。expression の filter はその式だけで決まります。
- 渡されなかった pipeline 値（`pipeline.git.branch` など）は決めません。その値に依る filter・`when`・`<< >>` は、書いてある形のまま残し、warning を出します。
- CircleCI はその権利者の商標です。kumitate は互換を名乗るだけで、提携も同一性も主張しません。

## 何が在るか

| パス | 中身 |
|---|---|
| `kotoba/kumitate/00-ns.kotoba` … `99-main.kotoba` | 本体。1 ファイル 1 module で、prefix で名前を分けます（下表）。 |
| `kotoba/kumitate/MANIFEST` | native command `kumitate` の unit（ファイルをこの順に連結する）。 |
| `kotoba/kumitate/GATE-MANIFEST` | test gate の unit（`99-main` を除く全 module と `tests/`）。 |
| `kotoba/kumitate/tests/` | unit test（`test-*` 19 個）と gate の `main`。 |
| `test/fixtures/` | fixture と期待出力。`MANIFEST` を `kumitate selftest` が読みます。`stdio/session.jsonl` は stdio の 1 session です。 |
| `test/fixtures/config/SOURCES.edn` | 実在 config の出所（repo・commit・license・sha256）。 |
| `aiueos/kumitate.edn` | aiueos アプリ記述子（`:effects #{}` の pure 判断コア）。 |
| `aiueos/kumitate.wasm` | `MANIFEST` の unit を amu selfhost root が `wasm32-browser` にした module。`.provenance.edn`（root・unit・出力の hash）と `.publication.edn`（`:kotoba.output-set/v1` の印）が並びます。 |
| `web/` | ブラウザの画面。静的な HTML・CSS・JS だけで、計算はしません（下の「ブラウザ」）。 |
| `aiueos/kumitate.web.publication.edn` | `web/` の公開の記録。UnixFS directory の CID、5 ファイルの sha256、pin した node、取り直しの確かめ（下の「未実装」の「公開」）。 |
| `scripts/browser-build.sh` | `aiueos/kumitate.wasm` とその記録、`web/kumitate.wasm.js`、`web/kotoba-host.js` を作る POSIX sh。 |
| `docs/aiueos-dapp.md` | 設計、未実装の境界、ブロッカー。 |
| `docs/evidence/` | 実測の記録（compiler・入力・出力の hash、結果、負の対照）。 |

| module | prefix | 中身 |
|---|---|---|
| 10-text | `tx-` `y-` `d-` | 文字列・数・リスト、文書ノード Y と診断 D |
| 20-yaml / 26-emit | `ym-` / `ye-` | YAML の読み（anchor・merge・block scalar・flow）と書き |
| 25-json / 27-xml | `js-` / `xm-` | JSON の読み書き、JUnit の XML（DTD は拒否） |
| 30-regex | `rx-` | filter と `matches` の正規表現（Pike VM、全体一致） |
| 35-expr | `ex-` | CircleCI の expression |
| 40-config | `cf-` | config の検証（名前付きの拒否） |
| 50-plan / 55-out | `pl-` / `po-` | 展開後の計画、processed config、ローカル実行の手順 |
| 60-api | `ap-` | API v2 の形、実行記録、JUnit 集計 |
| 70-mcp / 80-http / 85-stdio | `mc-` / `ht-` / `sd-` | MCP（pure な handler）、native TCP 上の Streamable HTTP、stdin／stdout の stdio |
| 90-cli / 99-main | `cli-` | native command |

## 使い方

`kumitate` は amu selfhost が作る loaderless な static ELF です（aarch64-linux／x86_64-linux）。ファイルは `KEXE_CAP_RESOURCES_35` で許したディレクトリの中から、絶対パスで読みます。

```sh
kumitate validate /abs/.circleci/config.yml
kumitate plan    /abs/config.yml --branch main --param deploy=true
kumitate process /abs/config.yml --tag v1.2.3          # config process の形の YAML
kumitate api     /abs/config.yml --branch main --slug gh/org/repo --number 42 --created-at 2026-10-23T07:00:00.000Z
kumitate local   /abs/config.yml --branch main          # job ごとの手順。実行はしない
kumitate runs    /abs/runs.json                         # API v2 items か kumitate.runs.v1
kumitate runs-export /abs/runs.json circleci-items      # または kumitate
kumitate junit   /abs/run1.xml /abs/run2.xml
kumitate selftest /abs/test/fixtures/MANIFEST           # SCANNED n PASS p FAIL f
```

戻り値は、受理が 0、拒否が 1、使い方の誤りが 2 です。selftest は失敗の数を返し、1 件も走らなければ 3 を返します。

### MCP

agent からは MCP で使います。transport は stdio と Streamable HTTP（JSON 応答、SSE なし）の 2 つです。

- tool は 8 つです: `kumitate_validate`、`kumitate_plan`、`kumitate_process`、`kumitate_api_shapes`、`kumitate_local_plan`、`kumitate_runs`、`kumitate_runs_export`、`kumitate_junit`。どれも渡されたデータだけを読む pure な関数です。
- どちらの transport でも、答えは同じ handler（`70-mcp` の `mc-handle`）が出します。

#### stdio

```sh
KEXE_ALLOW=37,38,39,41 kumitate stdio
```

- 1 行が 1 つの JSON-RPC message です。答えは stdout に 1 行ずつ書き、通知には答えません。行末の CR は落とし、空行は読み飛ばします。end of file の前の、改行の無い最後の message にも答えます。stdout には答えしか書きません。
- stdin は wire 41（`:io/read`）で読むので、`KEXE_ALLOW` に 41 が要ります。無いと最初の read で runtime が止めます。今の止まり方は `KEXE_TRAP {:kind :signal :signal :SIGILL}` で、どの wire かは出ません（amu の runtime の課題）。UTF-8 でない stdin も runtime が止めます。
- 5 MiB を超える message には `-32600` を返し、その message の改行までを捨てて続けます。
- 答えは 1 つずつ client に届きます。runtime は stdout を exit まで貯めますが、stderr に書く前には stdout を出します。それで答えを書くたびに、wire 39 に空の書き込みをします。
- 1 つの答えの計算は `arena-scope` の中で動き、使ったものは答えの後に返ります。process に残るのは stdin から読んだ bytes だけです。string pool（256 MiB）が埋まると、runtime が `KEXE_TRAP {:kind :budget :reason :budget/bytes :arena :string-pool}` で止めます。
  - 実測（1 process、aarch64-linux）では、`ping` 200,000 件、`tools/list` 20,000 件、16.5 KB の config の `kumitate_plan` 3,001 件に、すべて答えました。
  - 1 MiB の message は、127 件に答えたところで止まりました。いくつもの read にまたがる message は、読んだ bytes とつないだ写しの 2 つが残るためです。
- client が process を起こします。macOS では podman の arm64 VM の中で動かします。

```json
{"mcpServers": {"kumitate": {"command": "podman",
  "args": ["run", "--rm", "-i", "--platform", "linux/arm64", "--network", "none", "-e", "KEXE_ALLOW=37,38,39,41",
           "-v", "/abs/g:/abs/g:ro", "docker.io/library/python:3.12-alpine", "/abs/g/kumitate-aarch64-linux.elf", "stdio"]}}}
```

- 確かめた client は Claude Code の MCP client（2.1.309）です。上の設定で接続し、8 つの tool を一覧し、`kumitate_plan` を呼んで、答えの段（levels）を読みました（[記録](docs/evidence/kotoba-stdio-mcp-20261023.edn)）。itonami-agent の stdio client では、まだ試していません。

#### Streamable HTTP

```sh
KEXE_ALLOW=37,38,39,43,44,46,47 KEXE_CAP_RESOURCES_43=127.0.0.1:8787 kumitate serve 127.0.0.1:8787
```

- 開けるのは `KEXE_CAP_RESOURCES_43` で許した 1 つの address だけです。
- `POST /mcp` に答えます。GET／DELETE には 405、他の path には 404、localhost 以外の `Origin` には 403、5 MiB を超える body には 413 を返します。
- 接続ごとの `arena-scope` はまだありません。答えるたびに使ったものが process に残るので、1 つの process が答えられる数には上限があります（数は測っていません）。
- itonami-agent の profile では `mcp_servers: {kumitate: {url: "http://127.0.0.1:8787/mcp"}}` と書きます。

## Kotoba gate（amu selfhost だけ）

Node.js・nbb・JVM・babashka・C を使いません。各 MANIFEST のファイルを順に連結して 1 つの unit にし、pin した amu selfhost root で static image にして動かします。arm64 Linux の上ではそのまま動きます。macOS では podman の arm64 VM の中で動かします。

```sh
AMU=../../kotoba-lang/amu; G=$(mktemp -d)     # G は podman が mount できる場所に置く
git -C $AMU show 7239484e2cd1b3bbd9bc3095edb03fd986f8f6e5:seed/bootstrap/aarch64-linux-static-root.elf > $G/root.elf
chmod +x $G/root.elf                          # sha256 bd0254759e442533ead3e190f361257725667ea252a83b3575a3fb0d65becb66
for m in MANIFEST GATE-MANIFEST; do
  grep -v '^#' kotoba/kumitate/$m | while read p; do cat "$p"; echo; done > $G/$m.kotoba
done
podman run --rm --platform linux/arm64 --network none -e KEXE_CAP_RESOURCES_35=$G -v $G:$G -w $G \
  docker.io/library/python:3.12-alpine sh -c '
  for t in aarch64-linux x86_64-linux; do
    ./root.elf compile MANIFEST.kotoba      --target $t --output kumitate-$t.elf --format static
    ./root.elf compile GATE-MANIFEST.kotoba --target $t --output gate-$t.elf     --format static
  done; chmod +x *.elf'
# arm64 で: gate は 19 の PASS と :result 19、selftest は SCANNED 75 PASS 75 FAIL 0
podman run --rm --platform linux/arm64 --network none -e KEXE_CAP_RESOURCES_35=$PWD -v $G:$G -v $PWD:$PWD -w $PWD \
  docker.io/library/python:3.12-alpine sh -c "KEXE_STRUCTURED_REPORT=1 $G/gate-aarch64-linux.elf; $G/kumitate-aarch64-linux.elf selftest $PWD/test/fixtures/MANIFEST"
# x86_64 で（ここでは qemu-user なので seccomp は KEXE_SECCOMP=if-available で外れる）
podman run --rm --platform linux/amd64 --network none -e KEXE_SECCOMP=if-available -e KEXE_CAP_RESOURCES_35=$PWD -v $G:$G -v $PWD:$PWD -w $PWD \
  docker.io/library/alpine:3 sh -c "KEXE_STRUCTURED_REPORT=1 $G/gate-x86_64-linux.elf; $G/kumitate-x86_64-linux.elf selftest $PWD/test/fixtures/MANIFEST"
# stdio（arm64 で。x86_64 は image と platform を上の x86_64 の行と同じにする）:
# 1 session の答えが期待出力と同じこと、答えが 1 つずつ届くこと
podman run --rm -i --platform linux/arm64 --network none -v $G:$G -v $PWD:$PWD -w $PWD \
  docker.io/library/python:3.12-alpine sh -s $G/kumitate-aarch64-linux.elf <<'EOF'
KEXE_ALLOW=37,38,39,41 $1 stdio < test/fixtures/stdio/session.jsonl | cmp - test/fixtures/expected/stdio/session.jsonl && echo "session: same"
d=$(mktemp -d); mkfifo $d/in $d/out
KEXE_ALLOW=37,38,39,41 $1 stdio < $d/in > $d/out & exec 3> $d/in 4< $d/out
for m in '{"jsonrpc":"2.0","id":1,"method":"ping"}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; do
  printf '%s\n' "$m" >&3; case $m in *'"id"'*) if read -t 5 -r a <&4; then echo "answer ${#a} bytes"; else echo "no answer in 5 s"; fi;; esac
done
exec 3>&-; wait $!; echo "exit $?"
EOF
```

- 期待値: どちらの target でも gate は 19／19、selftest は SCANNED 75 PASS 75 FAIL 0。stdio は `session: same`、`answer 36 bytes`、`answer 6428 bytes`、`exit 0`。
- 負の対照:
  - matrix の exclude を無視させた写しでは、gate が 17、selftest が FAIL 4 になります。
  - orbs の拒否を外した写しでは、selftest が FAIL 6 になります。
  - stdio で答えごとの wire 39 の書き込みを外した写しでは、5 秒待っても答えが届きません。答えは end of file の後にまとめて出ます。
  - stdio の `arena-scope` を外した写しは、`ping` 66,565 件、`tools/list` 1,273 件、16.5 KB の `kumitate_plan` 219 件で、runtime の budget／arena の trap で止まります。
- 実測の記録は [`docs/evidence/kotoba-stdio-mcp-20261023.edn`](docs/evidence/kotoba-stdio-mcp-20261023.edn)（今の root と stdio）と [`docs/evidence/kotoba-selfhost-gate-20261023.edn`](docs/evidence/kotoba-selfhost-gate-20261023.edn)（最初の slice、root 1739f52f…）にあります。
- CI には入れていません。workspace の CDCI は停止中で、再開は owner が決めます。

## ブラウザ（wasm32-browser）

`web/index.html` を開くと、config.yml を貼るかファイルで開いて、検証の結果（名前付きの拒否）、展開後の計画、workflow の DAG、`config process` の形の YAML を見られます。実行記録（JSON）と JUnit XML を開くと、その集計を出します。

- **計算は kumitate.wasm だけ**がします。中身は native の `kumitate` command と同じ unit（`MANIFEST`）で、`validate` `plan` `process` `runs` `junit` をそのまま呼びます。`web/app.js` は入出力を運んで描くだけです。
- **実行はブラウザの Worker** です（`web/kotoba-host.js`、amu の `runtime/wasm32-browser-static-host.js` の写し）。app の origin は静的なファイルを配るだけで、ロジックも API も持ちません。
- **外部通信はゼロ**です。ページの CSP は `connect-src 'none'` で、module もスクリプトとして読みます（`web/kumitate.wasm.js`、読み込み時に sha256 を照合します）。貼ったものや開いたファイルは、このページのメモリにしかありません。保存もしません。
- **module に渡すのは、その実行の入出力だけ**です（amu の entry ABI、`seed/README.md`）。ページが許すのは wire 37／39（stdout・stderr）、38（引数）、35（ページが渡したファイルの読み取りだけ）です。`kotoba:host/cap` は、他のすべての capability を名前付きで拒否します。CircleCI や VCS への接続は、共有の同意 broker（JUN-353 Phase 2）が着地するまで、作りもしません。
- 1 回の実行は 1 つの Worker です。30 秒で止めます。arena は start で約 288 MiB（4615 page）を確保します。

### ブラウザの build

Node・Python・JVM・C を使いません。root と Worker host は、amu の 1 つの commit から `git show` で取ります。

```sh
AMU=../../kotoba-lang/amu; C=<amu の commit>; G=$(mktemp -d)   # G は podman が mount できる場所に置く
git -C $AMU show $C:seed/bootstrap/aarch64-linux-static-root.elf > $G/root.elf   # 7239484e では sha256 bd025475…
git -C $AMU show $C:runtime/wasm32-browser-static-host.js > $G/host.js
podman run --rm --platform linux/arm64 --network none -v $G:$G -v $PWD:$PWD -w $PWD \
  docker.io/library/python:3.12-alpine sh scripts/browser-build.sh $G/root.elf $G/host.js $C
```

同じ root と同じ source からは、同じ `kumitate.wasm` が出ます。

### ブラウザの gate（headless Chromium）

wasm の gate と fixture selftest を headless Chromium で動かし、native の結果とバイト単位で比べます。browser は amu の `scripts/seed/check-wasm32-browser.py` が動かします。これは DevTools protocol を pipe で話すだけで、Node・npm・Playwright を使いません。Python は browser を起こして結果を読むだけで、この repo に Python のコードはありません。

```sh
# G に root.elf がある（上の build）。chromium の入った arm64 Linux の image を使う
#（例: python:3.12-alpine に apk add chromium をして commit したもの。apk にだけ network が要る）
AMU=$(cd $AMU && pwd)                         # podman の -v は絶対 path だけを受ける
grep -v '^#' kotoba/kumitate/GATE-MANIFEST | while read p; do cat "$p"; echo; done > $G/GATE-MANIFEST.kotoba
podman run --rm --platform linux/arm64 --network none -e KEXE_CAP_RESOURCES_35=$G -v $G:$G -v $PWD:$PWD -v $AMU:$AMU -w $PWD IMAGE sh -c "
  $G/root.elf compile $G/GATE-MANIFEST.kotoba --target wasm32-browser --output $G/gate.wasm
  python3 $AMU/scripts/seed/check-wasm32-browser.py --app $G/gate.wasm --allow 37 --output $G/b-gate
  python3 $AMU/scripts/seed/check-wasm32-browser.py --app aiueos/kumitate.wasm --allow 35,37,38,39 \
    --file /fixtures=$PWD/test/fixtures --output $G/b-self -- selftest /fixtures/MANIFEST
  tail -1 $G/b-self/output"
```

- 期待値: gate は `:result 19`、selftest は `SCANNED 75 PASS 75 FAIL 0`。
- 出力（`$G/b-gate/output`、`$G/b-self/output`）は、native の aarch64-linux static image の stdout とバイト単位で同じです（上の「Kotoba gate」）。残り fuel も同じです。
- 画面そのものの確かめ（例を読んで計画と DAG、拒否される config、実行記録と JUnit、`fetch` が CSP で拒否されること）の記録は [`docs/evidence/kotoba-wasm32-browser-20261023.edn`](docs/evidence/kotoba-wasm32-browser-20261023.edn) にあります。
- CI には入れていません（上の「Kotoba gate」と同じ理由）。

## 未実装（要点）

- **本物の実行と外部接続**（circleci.com、VCS、ローカルでの job 実行）: 未実装でブロッカーがあります。共有の同意 broker `kotoba-lang/wasm-webcomponent/src/kotoba-client-runtime.js` がまだ存在しません。workspace 契約により、product 側で代わりを書くこともしません。
- **公開**: 主経路だけが着地しています（[`aiueos/kumitate.web.publication.edn`](aiueos/kumitate.web.publication.edn)）。
  - 主経路 `ipfs://bafybeidivinjsmoavctigysyjuxtnz7asqhp5s74wd32zrkbpxmqai7aqu` は `web/` の 5 ファイルの UnixFS directory です。gad の Kubo に pin してあり、別の ISP の使い捨て Kubo から取り直して CID が一致しました。
  - CID は node も network も使わずに出せます: `ipfs add -r -Q --only-hash --cid-version=1 --raw-leaves --chunker=size-262144 web`（Kubo 0.41.0）。
  - naming の `ipns://{k51}` は owner 判断で保留です。鍵も作っていません。
  - 補助経路 `https://kumitate.itonami.app/`（DNSLink）は Linear JUN-324（registrar・DNS/DNSSEC・ingress/TLS）待ちです。DNS の record は作っていません。

## ライセンス

AGPL-3.0-or-later（[LICENSE](LICENSE)）。`test/fixtures/config/` の実在 config は、それぞれの原 license のままです（[NOTICE](NOTICE)、`SOURCES.edn`）。
