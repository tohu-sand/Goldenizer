# Goldenizer

画像に黄金螺旋を自動で配置するWebアプリです。

画像の内容をもとにいくつかの配置候補を作り、選んだ結果をPNGで保存できます。処理はすべてブラウザ内で行うため、画像が外部に送信されることはありません。

## 使い方

1. 画像をドラッグ＆ドロップするか、クリックして選択します。クリップボードからの貼り付けにも対応しています。
2. 表示された候補から好みの配置を選びます。
3. 「PNGをダウンロード」を押して保存します。

PNG、JPEG、WebP、GIF、AVIF、BMP、SVGに対応しています。

## ローカルで動かす

Node.js 22以降とpnpmが必要です。

```bash
pnpm install
pnpm dev
```

開発サーバーは `http://localhost:5173` で起動します。

```bash
pnpm test       # テスト
pnpm typecheck  # 型チェック
pnpm build      # 本番用ビルド
pnpm preview    # ビルド結果の確認
```

## CLI

開発時の確認用に、PNGまたはJPEGを直接処理するCLIもあります。

```bash
pnpm cli input.jpg output.png
```

## デプロイ

`pnpm build` で生成される `dist/` を静的サイトとして配信してください。Vercel向けの設定は `vercel.json` に含まれています。

`main` ブランチへpushすると、GitHub ActionsがGitHub Pages向けにビルドして公開します。初回のみ、リポジトリの「Settings → Pages → Source」で「GitHub Actions」を選択してください。

## ライセンス

本プロジェクトは MIT ライセンスのもとで公開されています。詳細は [LICENSE](./LICENSE) をご確認ください。

使用している第三者ソフトウェアとそのライセンスについては、[THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) をご確認ください。
