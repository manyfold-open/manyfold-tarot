# 解讀結尾區的 CTA 重新排版（C3）

> 狀態（2026-09-29）：設計已選定，待實作。Mockup 在 brainstorm 伴隨頁面中比較過 A/B/C 與 C1/C2/C3，使用者選定 C3。

## 問題

解讀結束後（`phase === 'outro'`，`src/app/tarot/TarotApp.tsx` 的 `.taro-outro`）同時擺了六個份量相近的動作：追問 chips、分享（選項框永遠展開：3 個 radio + 1 個 checkbox）、抽籤、再問一件事、存進日誌、日誌頁連結（外加一個框）。兩個主要按鈕並排互搶，框線、底線、置中三種排法混用，看起來很雜亂。

## 目標

- **抽籤是唯一的主角**：這是結尾最想被採取的下一步，也符合 `2026-09-24-stick-tarot-bridge.md` 的導流方向。
- **日誌是第二主角**：要明顯，但不搶抽籤。
- 分享、日誌頁、再問一件事退為次要或出口。
- 手機（375px）和桌機都成立。

## 版面（由上而下）

1. **解讀本身與追問 chips**（`Reading` 元件）：不動。chips 屬於解讀，不屬於結尾 CTA。
2. **追問對話串**（`.taro-thread`）：不動。
3. **抽籤卡**（新樣式，取代 `.taro-stick-action` 的並排版）
   - 橫向卡片：左邊是標題「抽一支今天的签」加籤筒圖示（`StickIcon`）和一行說明；右邊是實心紅色膠囊按鈕（`#d9573f`，也就是現在 `.taro-to-stick` 底線的顏色）。
   - 卡片是淡紅色漸層底，外框用半透明紅。
   - **說明文字保留現有的條件判斷**：只有在「今天的免費已用、額外次數也沒用、沒有籤詩獎勵、也沒有邀請額度」時，才顯示 `bridge.outroOffer`（抽完籤還能再問一次）；其他情況顯示 `bridge.outroContinue`。不能無條件承諾「再問一次」。
   - 連結、`target="_blank"`、`stickLink(fortuneStickUrl, 'outro')`、`track('stick_opened', { from: 'outro' })` 都不變。
   - 窄螢幕上按鈕不換到下一行；文字太長時由左側縮排換行。
4. **日誌卡**（新樣式，取代 `JournalPanel` 的框）
   - 用網站既有的星光藍（`--star`，`#9ab4ed`）當第二主角色：淡藍漸層底加藍框，一冷一暖，不跟抽籤打架。
   - **尚未存的狀態**：✦ 圖示、標題「存進日誌，之後回來看」、副標「什麼時候提醒你回顧？」，下方一排回顧時間 chips 加「存下」按鈕。
     - chips 沿用現有的 `REVIEW_DAYS = [7, 14, 30]` 和 `journal.reviewOptions`（1 周 / 2 周 / 1 个月），預設 7 天。Mockup 上的「3/7/14 天」只是示意，**不改天數**。
     - 按「存下」時呼叫現有的 `saveJournal`，把選好的 `reviewDueAt` 和空的筆記一起存進去。
   - **已存的狀態**：標題換成 `journal.saved`（已存入日志）加上勾勾，chips 顯示已選的日期，仍然可以改。改了日期，或打開筆記之後，會出現現有的 `journal.saveNote` 按鈕，一次存下日期和筆記。下方出現收合的「加一句筆記（選填）」連結，點開後才顯示現有的筆記 textarea 和 `journal.saveNote` 按鈕。
   - 開頁時的 `fetchJournal` 還原邏輯不變（已存過的閱讀直接進入已存狀態）。
   - analytics 事件不變：第一次存時送 `reading_saved`，之後送 `journal_note_saved`。
5. **次要圖示列**：日誌卡正下方置中一排小圖示加文字，比卡片低調。
   - `↗ 分享`：點了以後在圖示列下方展開現有的分享選項（一張牌 / 摘要 / 完整、選牌 chips、顯示原問題 checkbox）和「建立並複製連結」按鈕。**預設收起**。展開後的 `ShareBox` 行為（每輪最多建立一個連結、改選項就重設連結、複製失敗時顯示連結）全部不變。
   - `☰ 我的日誌`：連到 `appUrl('/journal')`，就是原本 `JournalPanel` 左上角那個連結。
6. **再問一件事**：最低調的灰字出口，文案和 `access?.canRead === false` 時改成 `outro.backHome` 的邏輯不變。
7. Footer：不動。

## 元件切分

- `StickCard`（新，`src/app/tarot/StickCard.tsx`）：抽籤卡。props 有 `href`、`offer: boolean`、`locale`。
- `JournalPanel`（改寫版面）：保留檔名與既有的狀態邏輯，改成卡片樣式，存下時一併處理回顧日期，筆記改成收合。
- `ShareBox`：新增 `open` prop。`open` 為 false 時什麼都不渲染；為 true 時渲染現有的全部內容。元件的 state 在收起後仍保留，所以已建立的連結不會消失。`TarotApp` 持有 `shareOpen` 狀態，次要圖示列裡的「↗ 分享」按鈕負責切換它（帶 `aria-expanded`），`<ShareBox open={shareOpen}>` 放在圖示列正下方。
- `TarotApp.tsx` 的 `.taro-outro` 只負責依序擺放這些元件。
- 樣式寫在 `features.css`，沿用 `--ink`、`--ink-2`、`--line`、`--line-strong`、`--star` 等 token。新增的顏色只有抽籤紅，它已經存在於 `.taro-to-stick`。

## 不做的事

- 不改 API、資料庫與計費。
- 不改追問 chips、解讀內容、footer。
- 不處理 `followOpen` 自由追問表單。它目前沒有任何地方會設成 `true`，是沒在用的程式碼，另外處理。
- 不新增 icon 字型或圖片。圖示用 Unicode 字元（↗ ✦ ☰）加 CSS，籤筒沿用 `StickIcon`。
- 不改其他頁面（首頁、日誌頁、分享頁）。
- 文案一律用 `i18n.ts` 的簡體中文和英文。Mockup 上的繁體只是示意。新增的字串（例如「什麼時候提醒你回顧？」「加一句筆記（選填）」）要兩種語言都補。

## 測試與驗證

- 單元與 UI 測試（`tests/ui/`）：
  - 分享預設收起，點了才出現選項，建立連結的流程和現有的 `share.test.tsx` 一樣通過。
  - 日誌卡：選 2 周再按存下，`saveJournal` 收到的 `reviewDueAt` 是 14 天後；已存的閱讀開頁就進入已存狀態；筆記預設收合。
  - 抽籤卡：只在符合條件時顯示 `outroOffer`。
- 推送前跑 `npm test` 和 `npm run check`。
- 視覺驗證：本機的 dev server 在 375px 和桌機寬度下截圖（中文與英文各一），再與 mockup 對照。
- 合併部署後，在正式站用內建瀏覽器的測試通行證跑一輪到結尾頁截圖確認，事後列出留下的資料。
