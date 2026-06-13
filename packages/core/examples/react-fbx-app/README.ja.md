# FBX Chat

`@aituber-onair/core` を使った FBX アバターチャットアプリです。
VRM サンプルと同じ LLM、TTS、音声入力、YouTube、Twitch、Comment
Intelligence、Manneri の流れを保ったまま、Three.js で FBX キャラクターを
表示します。

ブラウザで起動し、その URL を OBS のブラウザソースに入れると、配信用の
AITuber 画面として使えます。

## できること

- `@aituber-onair/core` が提供する LLM プロバイダーで会話
- ローカル系や OpenAI 互換を含む TTS エンジンで音声生成
- `public/avatar/avatar.fbx` の表示
- 任意の `public/avatar/idle.fbx` と `public/avatar/talk.fbx` の合成
- 実際の音声出力ボリュームに合わせた口元アニメーション
  - mouth / jaw / viseme 系の名前を持つモーフターゲットを優先
  - 顎らしいボーンがあればフォールバックとして回転
  - 発話中は `talk.fbx` の重みを上げて合成
- `[happy]`、`[sad]`、`[angry]`、`[surprised]`、`[relaxed]` などの
  screenplay 感情タグに合わせた簡易表情モーフ合成
- 静止感を減らすための軽い呼吸・頭部モーション
- アバターカメラ操作:
  ドラッグで回転 / ホイールでズーム / ダブルクリックでリセット
- Settings から背景画像を設定
- YouTube Live / Twitch コメントを取得し、`@aituber-onair/comment-intelligence`
  で選別してから LLM に渡す
- `@aituber-onair/manneri` による会話の繰り返し検出

## セットアップ

```bash
cd packages/core/examples/react-fbx-app
npm install
npm run dev
```

起動後、**Settings** から API キーとプロバイダー設定を入力してください。
設定値は `localStorage`（`react-fbx-app-settings`）に保存されます。

## アバター素材（`public/avatar`）

次のファイルを `public/avatar/` に配置してください。

| ファイル | 必須 | 説明 |
|---|---:|---|
| `avatar.fbx` | 必須 | 表示するメイン FBX キャラクター |
| `idle.fbx` | 任意 | 待機モーション。未配置ならモデル内蔵の最初のアニメーションを使います |
| `talk.fbx` | 任意 | TTS 発話中に合成する会話モーション |

補足:

- `idle.fbx` と `talk.fbx` は `avatar.fbx` と同じスケルトン名・ボーン名を
  対象にしてください。同じキャラクターリグから出した Mixamo 系クリップは
  比較的扱いやすいです。
- 口パク精度を上げたい場合は、`mouth`、`jaw`、`viseme`、`aa`、`ah`、
  `open` などを含む名前のモーフターゲットを用意してください。
- Oshikoi 風の反応を強めたい場合は、`smile`、`happy`、`frown`、`sad`、
  `angry`、`surprise`、`shock`、`relaxed`、`calm` などの名前を持つ
  表情モーフターゲットを用意してください。LLM 応答の先頭に感情タグがあると、
  発話中に一致する表情を合成します。
- 口元モーフがない場合は顎ボーンを探して動かします。どちらもない場合は
  `talk.fbx` と軽い手続き的モーションだけが動きます。
- FBX キャラクターは同梱していません。配信や再配布の権利を持つ素材を
  使ってください。
- FBX は制作者が持つ既存素材との互換性のために扱います。公開配信や常設運用では、
  重い素材を GLB / glTF / VRM に変換し、テクスチャとメッシュを最適化してから
  配置することも検討してください。

`avatar.fbx` が未配置または不正な場合、アバターステージに読み込みエラーが
表示されます。

## 配信コメント（YouTube Live / Twitch）

YouTube Live または Twitch のコメントを取得し、LLM に渡す前に解析・選別
できます。**Settings -> Stream** から設定してください。同時に有効化できる
プラットフォームは一つだけです。

### YouTube Live

1. Google Cloud Console で **YouTube Data API v3** を有効にした API キーを
   作成します。
2. Settings -> Stream で `YouTube` を選び、API キーとライブ動画 ID
   （YouTube Live URL の `v=` の値）を入力します。
3. 必要に応じてポーリング間隔を調整し、トグルを有効にします。

### Twitch

このアプリは Twitch のブラウザ向け implicit OAuth
（`response_type=token`、scope `user:read:chat`）を使います。アクセストークンは
ブラウザの `localStorage` にのみ保存され、サーバーは使いません。

1. [Twitch Developer Console](https://dev.twitch.tv/console/apps) で
   アプリケーションを登録し、Client ID を取得します。
2. Settings -> Stream -> Twitch に表示される Redirect URL を登録します。
   Vite の既定では通常 `http://localhost:5173/` です。
3. Settings -> Stream で `Twitch` を選び、Client ID を入れて
   **Connect to Twitch** を押し、OAuth を承認します。
4. チャンネルの login name、デキュー間隔を設定し、トグルを有効にします。

## OBS / 配信

1. `npm run dev` を実行します。
2. OBS のブラウザソースに `http://localhost:5173/` を追加します。
3. 1920x1080 などの 16:9 キャンバスが扱いやすいです。
4. Settings で LLM、TTS、FBX素材、コメント取得元を設定します。

OBS には、ローカルブラウザで見えている WebGL アバター、チャット UI、背景画像、
生成音声の再生がそのまま取り込まれます。

## 認証情報の注意

これはサンプルアプリです。各種プロバイダー API キー、YouTube API キー、
Twitch Client ID、Twitch アクセストークンは **暗号化されず `localStorage` に
保存**されます。本番スコープの認証情報は使わず、共有環境や公開オリジンには
置かないでください。共有ブラウザで使った場合はキーのローテーションも検討して
ください。

## リップシンク調整

`src/hooks/useAudioLipsync.ts` の定数を調整できます。

| 定数 | 既定値 | 説明 |
|---|---:|---|
| `SMOOTH_FACTOR` | `0.5` | 平滑化係数。高いほどなめらかになります |
| `RMS_CEILING` | `0.12` | RMS 正規化の上限。低いほど口元が反応しやすくなります |
| `MOUTH_LEVELS` | `5` | FBX レンダラーへ渡す口開き段階数 |

FBX の構図や揺れ方は `src/components/AvatarPanel.tsx` の定数で調整できます。

## Web Speech API について

- **Chrome / Edge** で動作します（Chrome 推奨）
- Firefox と Safari は非対応です
- 非対応ブラウザではマイクボタンが無効になります
- HTTPS または localhost が必要です

## 技術構成

- Vite + React + TypeScript
- `@aituber-onair/core`（LLM + TTS）
- `@aituber-onair/comment-intelligence`
- `@aituber-onair/manneri`
- `three` + `FBXLoader`
- Web Speech API（音声入力）
- Web Audio API + `AnalyserNode`（リップシンク解析）
