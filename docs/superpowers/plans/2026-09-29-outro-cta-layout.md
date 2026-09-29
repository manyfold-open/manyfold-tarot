# 解讀結尾 CTA 重新排版（C3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 把解讀結尾區改成：抽籤卡為唯一主角、日誌卡為第二主角（在卡上選回顧時間後一鍵存下）、分享與日誌頁收在次要圖示列、「再問一件事」為最低調的出口。

**Architecture：** 新增 `StickCard` 元件；`JournalPanel` 保留檔名與狀態邏輯，改成卡片版面；`ShareBox` 新增 `open` prop（預設 `true`），由 `TarotApp` 的圖示列切換；`TarotApp.tsx` 的 `.taro-outro` 只負責排列。樣式寫在 `features.css`，並刪除 `tarot.css` 裡已經沒用的 `.taro-outro-actions` 與 `.taro-stick-action`。

**Tech Stack：** React 18 + TypeScript、Vite、Vitest + @testing-library/react（jsdom）、純 CSS。

**Spec：** `docs/superpowers/specs/2026-09-29-outro-cta-design.md`

## Global Constraints

- 分支：`feat/outro-cta-layout`（已從 `origin/main` 分出），不直接改 main。
- 文案一律放在 `src/shared/tarot/i18n.ts`，`zh`（簡體）和 `en` 兩份都要補，`Copy` 型別同步更新。
- 回顧天數沿用 `REVIEW_DAYS = [7, 14, 30]` 與 `journal.reviewOptions`，預設 7 天。
- 抽籤說明只有在 `access?.freeUsed && !access.dailyExtraUsed && !access.stickBonusAvailable && access.credits === 0` 時才顯示 `bridge.outroOffer`，否則顯示 `bridge.outroContinue`。
- 抽籤紅色 `#d9573f`、日誌星光藍 `rgb(154 180 237)`（即 `--star` `#9ab4ed`），其他顏色只用現有 token（`--ink`、`--ink-2`、`--ink-3`、`--line`、`--line-strong`）。
- 圖示只用 Unicode（`↗` `✦` `✓` `☰`）與既有的 `StickIcon`，不引入新套件。
- 所有 app 內網址都要經過 `appUrl()`（`src/app/base.ts`），網站才能掛在 `/tarot` 底下（AGENTS.md invariant 9）。
- 不改 API、資料庫、analytics 事件名稱與參數。
- 每個任務結束都要跑 `npx vitest run tests/ui`；最後推送前跑 `npm test` 與 `npm run check`。

---

### Task 1: StickCard 抽籤卡

**Files:**
- Create: `src/app/tarot/StickCard.tsx`
- Modify: `src/shared/tarot/i18n.ts`（`Copy.bridge` 型別、`zh.bridge`、`en.bridge`）
- Test: `tests/ui/stick-card.test.tsx`

**Interfaces:**
- Produces: `export default function StickCard(props: { href: string; offer: boolean; locale: Locale; onOpen?: () => void }): JSX.Element`，根元素 class 為 `taro-stick-card`，連結 class 為 `taro-stick-go`。
- Produces: i18n `bridge.stickGo`（zh：`去抽签`，en：`Draw`）。

- [ ] **Step 1: 寫失敗的測試** `tests/ui/stick-card.test.tsx`

```tsx
/**
 * @vitest-environment jsdom
 *
 * The one filled button at the end of a reading. It only promises another
 * Tarot question when a stick would actually unlock one.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StickCard from '../../src/app/tarot/StickCard';

afterEach(() => cleanup());

const link = () => document.querySelector('.taro-stick-card a.taro-stick-go') as HTMLAnchorElement;

describe('StickCard', () => {
  it('promises another reading only when a stick would unlock one', () => {
    const { rerender } = render(<StickCard href="https://stick.test/?from=outro" offer locale="zh" />);
    expect(document.querySelector('.taro-stick-card')?.textContent).toContain('抽完一支签，今天还可以再问一次塔罗。');

    rerender(<StickCard href="https://stick.test/?from=outro" offer={false} locale="zh" />);
    const text = document.querySelector('.taro-stick-card')?.textContent ?? '';
    expect(text).toContain('也可以来求一支签，看看今天的提示。');
    expect(text).not.toContain('再问一次塔罗');
  });

  it('opens the Stick in a new tab and reports the click', () => {
    const onOpen = vi.fn();
    render(<StickCard href="https://stick.test/?from=outro" offer locale="en" onOpen={onOpen} />);
    expect(link().getAttribute('href')).toBe('https://stick.test/?from=outro');
    expect(link().getAttribute('target')).toBe('_blank');
    expect(link().getAttribute('aria-label')).toBe('Draw a stick for today');
    expect(link().textContent).toBe('Draw');
    fireEvent.click(link());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/ui/stick-card.test.tsx`
Expected: FAIL，錯誤為找不到 `../../src/app/tarot/StickCard`。

- [ ] **Step 3: 補 i18n**

在 `src/shared/tarot/i18n.ts` 的 `Copy` 型別 `bridge` 區塊中，`stickCta: string;` 下一行加入：

```ts
    /** The button on the Stick card; the card's title already says what it is. */
    stickGo: string;
```

在 `zh.bridge` 的 `stickCta: '抽一支今天的签',` 下一行加入：

```ts
    stickGo: '去抽签',
```

在 `en.bridge` 的 `stickCta: 'Draw a stick for today',` 下一行加入：

```ts
    stickGo: 'Draw',
```

- [ ] **Step 4: 實作** `src/app/tarot/StickCard.tsx`

```tsx
/**
 * The Fortune Stick at the end of a reading: the one next step this page most
 * wants taken, so it is a card of its own and holds the only filled button.
 *
 * It promises another Tarot question only when drawing a stick would actually
 * unlock one (`offer`); otherwise it just invites a stick for today. The link
 * opens in a new tab so this reading stays where it is.
 */

import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import StickIcon from './StickIcon';

export default function StickCard({
  href,
  offer,
  locale,
  onOpen,
}: {
  href: string;
  offer: boolean;
  locale: Locale;
  onOpen?: () => void;
}) {
  const copy = copyFor(locale);
  return (
    <div className="taro-stick-card">
      <div className="taro-stick-card-text">
        <p className="taro-stick-card-title">
          {copy.bridge.stickCta}
          <StickIcon />
        </p>
        <p className="taro-stick-card-line">{offer ? copy.bridge.outroOffer : copy.bridge.outroContinue}</p>
      </div>
      <a
        className="taro-stick-go"
        href={href}
        target="_blank"
        rel="noopener"
        aria-label={copy.bridge.stickCta}
        onClick={onOpen}
      >
        {copy.bridge.stickGo}
      </a>
    </div>
  );
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run tests/ui/stick-card.test.tsx`
Expected: PASS（2 tests）

- [ ] **Step 6: Commit**

```bash
git add src/app/tarot/StickCard.tsx src/shared/tarot/i18n.ts tests/ui/stick-card.test.tsx
git commit -m "Add the Stick card for the end of a reading"
```

---

### Task 2: JournalPanel 改成日誌卡

**Files:**
- Modify: `src/app/tarot/JournalPanel.tsx`（整個檔案改寫）
- Modify: `src/shared/tarot/i18n.ts`（`Copy.journal` 型別、`zh.journal`、`en.journal`）
- Test: `tests/ui/journal-card.test.tsx`

**Interfaces:**
- Consumes: `fetchJournal(): Promise<{ entries: JournalEntry[] }>`、`saveJournal(readingId: string, body: { note: string; reviewDueAt: string }): Promise<unknown>`、`errorText(error, fallback)`，全部來自 `src/app/tarot/api.ts`（現有）。
- Produces: 元件簽名不變 `JournalPanel({ reading, locale })`；根元素 class 改為 `taro-journal-card`（已存時加 `is-saved`）。日誌頁連結**不再**放在這個元件裡，改到 Task 4 的圖示列。
- Produces: i18n `journal.cardTitle`、`journal.cardPrompt`、`journal.saveNow`、`journal.saving`、`journal.addNote`。

- [ ] **Step 1: 寫失敗的測試** `tests/ui/journal-card.test.tsx`

```tsx
/**
 * @vitest-environment jsdom
 *
 * The journal card at the end of a reading: pick when to look back, save in
 * one press. The note is optional and stays folded until asked for.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingView } from '../../src/shared/tarot/types';

const reading = {
  readingId: 'r1',
  status: 'interpreted',
  locale: 'zh',
  question: '这周该专注什么？',
  greeting: '',
  cards: [],
  pending: 0,
  interpretation: null,
  followUps: [],
  demo: false,
  createdAt: '2026-09-29T00:00:00.000Z',
} as unknown as ReadingView;

let entries: Array<{ readingId: string; note: string; reviewDueAt: string | null }> = [];
const saveJournal = vi.fn(async () => ({ entry: {} }));

vi.mock('../../src/app/tarot/api', () => ({
  errorText: (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback),
  fetchJournal: async () => ({ entries }),
  saveJournal: (...args: unknown[]) => saveJournal(...(args as [])),
}));

const { default: JournalPanel } = await import('../../src/app/tarot/JournalPanel');

const localDateAfter = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const dueIn = (days: number) => new Date(`${localDateAfter(days)}T12:00:00`).toISOString();
const chip = (label: string) => screen.getByRole('radio', { name: label });

beforeEach(() => {
  entries = [];
  saveJournal.mockClear();
});
afterEach(() => cleanup());

describe('the journal card', () => {
  it('saves with the review date chosen on the card, in one press', async () => {
    render(<JournalPanel reading={reading} locale="zh" />);

    expect(screen.getByText('存进日志，之后回来看')).toBeTruthy();
    expect(chip('1 周').getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('textarea')).toBeNull();

    fireEvent.click(chip('2 周'));
    fireEvent.click(screen.getByRole('button', { name: '存下' }));

    await waitFor(() => expect(saveJournal).toHaveBeenCalledTimes(1));
    expect(saveJournal).toHaveBeenCalledWith('r1', { note: '', reviewDueAt: dueIn(14) });
    await screen.findByText('已存入日志');
    expect(document.querySelector('.taro-journal-card.is-saved')).toBeTruthy();
  });

  it('keeps the note folded until asked, and saves it when written', async () => {
    render(<JournalPanel reading={reading} locale="zh" />);
    fireEvent.click(screen.getByRole('button', { name: '存下' }));
    await screen.findByText('已存入日志');

    // Nothing changed yet: no second save button waiting.
    expect(screen.queryByRole('button', { name: '保存笔记' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '加一句笔记（选填）' }));
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '先把两件事做完' } });
    fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));

    await waitFor(() => expect(saveJournal).toHaveBeenCalledTimes(2));
    expect(saveJournal).toHaveBeenLastCalledWith('r1', { note: '先把两件事做完', reviewDueAt: dueIn(7) });
  });

  it('opens already saved, with its date and note, for a reading in the journal', async () => {
    entries = [{ readingId: 'r1', note: '旧笔记', reviewDueAt: dueIn(30) }];
    render(<JournalPanel reading={reading} locale="zh" />);

    await screen.findByText('已存入日志');
    expect(chip('1 个月').getAttribute('aria-checked')).toBe('true');
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('旧笔记');
    expect(screen.queryByRole('button', { name: '存下' })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/ui/journal-card.test.tsx`
Expected: FAIL（找不到文字「存进日志，之后回来看」）。

- [ ] **Step 3: 補 i18n**

在 `Copy` 型別的 `journal` 區塊中，`saveNote: string;` 下一行加入：

```ts
    /** The journal card at the end of a reading. */
    cardTitle: string;
    cardPrompt: string;
    saveNow: string;
    saving: string;
    addNote: string;
```

在 `zh.journal` 的 `saveNote: '保存笔记',` 下一行加入：

```ts
    cardTitle: '存进日志，之后回来看',
    cardPrompt: '什么时候回来回顾？',
    saveNow: '存下',
    saving: '正在保存…',
    addNote: '加一句笔记（选填）',
```

在 `en.journal` 的 `saveNote: 'Save note',` 下一行加入：

```ts
    cardTitle: 'Keep it, and come back to it',
    cardPrompt: 'When do you want to look back?',
    saveNow: 'Save',
    saving: 'Saving…',
    addNote: 'Add a note (optional)',
```

- [ ] **Step 4: 改寫** `src/app/tarot/JournalPanel.tsx`

```tsx
/**
 * The journal card at the end of a reading: the second thing this page wants
 * done, after the Stick. Choosing when to look back is what saving means here,
 * so the review date sits on the card and one press keeps both. The private
 * note is optional and stays folded until someone asks for it.
 */

import { useEffect, useState } from 'react';
import type { Locale } from '../../shared/tarot/deck';
import { copyFor } from '../../shared/tarot/i18n';
import type { ReadingView } from '../../shared/tarot/types';
import { track } from './analytics';
import { errorText, fetchJournal, saveJournal } from './api';

const toLocalDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const localDateAfter = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDate(date);
};

const REVIEW_DAYS = [7, 14, 30] as const;

export default function JournalPanel({ reading, locale }: { reading: ReadingView; locale: Locale }) {
  const copy = copyFor(locale);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [reviewDate, setReviewDate] = useState(localDateAfter(7));
  const [savedDate, setSavedDate] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchJournal().then(({ entries }) => {
      const entry = entries.find((item) => item.readingId === reading.readingId);
      if (cancelled || !entry) return;
      const date = entry.reviewDueAt ? toLocalDate(new Date(entry.reviewDueAt)) : localDateAfter(7);
      setSaved(true);
      setNote(entry.note);
      setSavedNote(entry.note);
      setReviewDate(date);
      setSavedDate(date);
      if (entry.note) setNoteOpen(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [reading.readingId]);

  const persist = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await saveJournal(reading.readingId, {
        note,
        reviewDueAt: new Date(`${reviewDate}T12:00:00`).toISOString(),
      });
      track(saved ? 'journal_note_saved' : 'reading_saved', { locale });
      setSaved(true);
      setSavedNote(note);
      setSavedDate(reviewDate);
    } catch (caught) {
      setError(errorText(caught, copy.errors.generic));
    } finally {
      setSaving(false);
    }
  };

  const changed = saved && (note !== savedNote || reviewDate !== savedDate);

  return (
    <section className={`taro-journal-card${saved ? ' is-saved' : ''}`}>
      <div className="taro-journal-card-head">
        <span className="taro-journal-card-mark" aria-hidden>{saved ? '✓' : '✦'}</span>
        <div>
          <p className="taro-journal-card-title" role={saved ? 'status' : undefined}>
            {saved ? copy.journal.saved : copy.journal.cardTitle}
          </p>
          <p className="taro-journal-card-prompt">{copy.journal.cardPrompt}</p>
        </div>
      </div>

      <div className="taro-journal-card-row">
        <div className="taro-chips" role="radiogroup" aria-label={copy.journal.reviewWhen}>
          {REVIEW_DAYS.map((days, index) => (
            <button key={days} type="button" role="radio" aria-checked={reviewDate === localDateAfter(days)}
              className={`taro-chip${reviewDate === localDateAfter(days) ? ' is-on' : ''}`}
              onClick={() => setReviewDate(localDateAfter(days))}>{copy.journal.reviewOptions[index]}</button>
          ))}
        </div>
        {!saved && (
          <button type="button" className="taro-journal-save" disabled={saving} onClick={() => void persist()}>
            {saving ? copy.journal.saving : copy.journal.saveNow}
          </button>
        )}
      </div>

      {saved && !noteOpen && (
        <button type="button" className="taro-link taro-journal-add-note" onClick={() => setNoteOpen(true)}>
          {copy.journal.addNote}
        </button>
      )}
      {saved && noteOpen && (
        <>
          <label className="taro-journal-label" htmlFor="taro-private-note">{copy.journal.note}</label>
          <textarea id="taro-private-note" className="taro-note-input" value={note} maxLength={4000}
            placeholder={copy.journal.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
        </>
      )}
      {changed && (
        <button type="button" className="taro-journal-save" disabled={saving} onClick={() => void persist()}>
          {saving ? copy.journal.saving : copy.journal.saveNote}
        </button>
      )}
      {error && <p className="taro-error" role="alert">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run tests/ui/journal-card.test.tsx`
Expected: PASS（3 tests）

- [ ] **Step 6: Commit**

```bash
git add src/app/tarot/JournalPanel.tsx src/shared/tarot/i18n.ts tests/ui/journal-card.test.tsx
git commit -m "Turn the journal panel into a card that saves with its review date"
```

---

### Task 3: ShareBox 的 `open` prop

**Files:**
- Modify: `src/app/tarot/ShareBox.tsx`（函式簽名、hooks 之後提早 return、檔頭註解）
- Test: `tests/ui/share.test.tsx`（加一個 describe）

**Interfaces:**
- Produces: `ShareBox({ reading, locale, open = true }: { reading: ReadingView; locale: Locale; open?: boolean })`。`open === false` 時回傳 `null`，但 state 仍保留，所以已建立的連結在收起再展開後還在。

- [ ] **Step 1: 寫失敗的測試**：在 `tests/ui/share.test.tsx` 檔尾加入

```tsx
describe('the share panel at the end of a reading', () => {
  it('renders nothing while folded, and keeps its link across fold and unfold', async () => {
    const { rerender } = render(<ShareBox reading={reading} locale="zh" open={false} />);
    expect(document.querySelector('.taro-share')).toBeNull();

    rerender(<ShareBox reading={reading} locale="zh" open />);
    fireEvent.click(button());
    await waitFor(() => expect(urlField()?.value).toBe('https://example.test/s/tok1'));

    rerender(<ShareBox reading={reading} locale="zh" open={false} />);
    expect(document.querySelector('.taro-share')).toBeNull();
    rerender(<ShareBox reading={reading} locale="zh" open />);
    expect(urlField()?.value).toBe('https://example.test/s/tok1');
    expect(createShare).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/ui/share.test.tsx`
Expected: FAIL（TypeScript/JSX 不認得 `open` 不會讓 vitest 失敗，但第一個 `toBeNull` 會失敗，因為目前永遠會渲染）。

- [ ] **Step 3: 實作**：在 `src/app/tarot/ShareBox.tsx`

簽名改為：

```tsx
export default function ShareBox({
  reading,
  locale,
  open = true,
}: {
  reading: ReadingView;
  locale: Locale;
  /** Folded behind the share icon at the end of a reading. State survives folding. */
  open?: boolean;
}) {
```

在 `const label = ...` 那段之後、`return (` 之前加入：

```tsx
  if (!open) return null;
```

檔頭註解第一段（從 `One press. It mints the link` 開始的那段）換成：

```tsx
 * One press, once it is open. At the end of a reading the panel is folded
 * behind the share icon (TarotApp owns `open`); unfolded, the choices are all
 * on the page and one press mints the link, puts it on the clipboard, and says
 * so. The question stays out unless the box is ticked.
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/ui/share.test.tsx`
Expected: PASS（原本 6 個加新的 1 個）

- [ ] **Step 5: Commit**

```bash
git add src/app/tarot/ShareBox.tsx tests/ui/share.test.tsx
git commit -m "Let the share panel fold behind the share icon"
```

---

### Task 4: 在 TarotApp 排列元件，加圖示列與樣式

**Files:**
- Modify: `src/app/tarot/TarotApp.tsx`（import、`shareOpen` state、`.taro-outro` 區塊）
- Modify: `src/shared/tarot/i18n.ts`（`Copy.outro.shareShort`）
- Modify: `src/app/tarot/features.css`（新增樣式）
- Modify: `src/app/tarot/tarot.css`（刪除 `.taro-outro-actions*`、`.taro-stick-action*`，以及 `@media (max-width: 560px)` 裡的 `.taro-outro-actions`）

**Interfaces:**
- Consumes: Task 1 `StickCard`、Task 2 `JournalPanel`、Task 3 `ShareBox open`。
- Produces: i18n `outro.shareShort`（zh：`分享`，en：`Share`）。

- [ ] **Step 1: 補 i18n**

在 `Copy` 型別 `outro` 區塊的 `share: string;` 下一行加入 `shareShort: string;`；在 `zh.outro` 的 `share: '分享这次解读',` 下一行加入 `shareShort: '分享',`；在 `en.outro` 的 `share: 'Share this reading',` 下一行加入 `shareShort: 'Share',`。

- [ ] **Step 2: TarotApp import 與 state**

在 `import ShareBox from './ShareBox';` 下一行加入：

```tsx
import StickCard from './StickCard';
```

在 `const [followOpen, setFollowOpen] = useState(false);` 下一行加入：

```tsx
  /** The share panel at the end of a reading, folded behind its icon. */
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => setShareOpen(false), [reading?.readingId]);
```

- [ ] **Step 3: 換掉 `.taro-outro` 的開頭**：從 `<section className="taro-outro">` 到 `taro-new-reading` 那顆按鈕的結尾 `</button>` 為止，換成：

```tsx
            <section className="taro-outro">
              {/* One lead, in order of what we most want taken: the Stick (the
                  only filled button), then the journal, then the quiet tools.
                  Asking something else is the way out, and looks like one. */}
              <StickCard
                href={stickLink(fortuneStickUrl, 'outro')}
                locale={locale}
                offer={Boolean(
                  access?.freeUsed &&
                    !access.dailyExtraUsed &&
                    !access.stickBonusAvailable &&
                    access.credits === 0,
                )}
                onOpen={() => track('stick_opened', { from: 'outro' })}
              />

              <JournalPanel reading={reading} locale={locale} />

              <div className="taro-outro-tools">
                <button
                  type="button"
                  className="taro-tool"
                  aria-expanded={shareOpen}
                  onClick={() => setShareOpen((open) => !open)}
                >
                  <span aria-hidden>↗</span>
                  {copy.outro.shareShort}
                </button>
                <a className="taro-tool" href={appUrl('/journal')}>
                  <span aria-hidden>☰</span>
                  {copy.navigation.journal}
                </a>
              </div>
              <ShareBox reading={reading} locale={locale} open={shareOpen} />

              <button type="button" className="taro-secondary taro-new-reading" onClick={newRound}>
                {/* Always the way home. It only promises another question when
                    there is one to ask; otherwise home is where the invite is. */}
                {access?.canRead === false ? copy.outro.backHome : copy.outro.newReading}
              </button>
```

並刪除 `.taro-outro` 結尾處原本那行 `<JournalPanel reading={reading} locale={locale} />`（在 `followOpen` 表單之後、`</section>` 之前）。

- [ ] **Step 4: 樣式**：在 `src/app/tarot/features.css` 檔尾加入

```css
/* ── the end of a reading: Stick, journal, tools, the way out ── */
.taro-stick-card { width:100%; box-sizing:border-box; display:flex; align-items:center; gap:14px; padding:16px; border:1px solid rgb(217 87 63 / 45%); border-radius:16px; background:linear-gradient(160deg, rgb(217 87 63 / 14%), rgb(217 87 63 / 3%)); text-align:left; }
.taro-stick-card-text { flex:1; min-width:0; }
.taro-stick-card-title { margin:0 0 2px; display:flex; align-items:center; gap:8px; color:var(--ink); font-size:15px; font-weight:600; }
.taro-stick-card-title .taro-app-icon { width:18px; height:18px; }
.taro-stick-card-line { margin:0; color:var(--ink-2); font-size:12.5px; line-height:1.6; }
.taro-stick-go { flex:none; padding:10px 16px; border-radius:999px; background:#d9573f; color:#fff; font-family:var(--sans); font-size:13px; font-weight:600; letter-spacing:.12em; text-decoration:none; white-space:nowrap; transition:background 160ms ease; }
.taro-stick-go:hover,.taro-stick-go:focus-visible { background:#e5654c; }

.taro-journal-card { width:100%; box-sizing:border-box; padding:16px; border:1px solid rgb(154 180 237 / 40%); border-radius:16px; background:linear-gradient(160deg, rgb(154 180 237 / 13%), rgb(154 180 237 / 2%)); display:flex; flex-direction:column; align-items:stretch; gap:12px; text-align:left; }
.taro-journal-card-head { display:flex; align-items:center; gap:12px; }
.taro-journal-card-mark { flex:none; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; background:rgb(154 180 237 / 18%); color:#dce6ff; font-size:16px; }
.taro-journal-card-title { margin:0; color:var(--ink); font-size:14.5px; font-weight:600; }
.taro-journal-card-prompt { margin:0; color:var(--ink-2); font-size:12px; }
.taro-journal-card-row { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.taro-journal-save { flex:none; padding:8px 16px; border:1px solid rgb(154 180 237 / 60%); border-radius:999px; background:transparent; color:#dce6ff; font-family:var(--sans); font-size:12.5px; letter-spacing:.08em; cursor:pointer; align-self:flex-end; }
.taro-journal-save:hover,.taro-journal-save:focus-visible { background:rgb(154 180 237 / 12%); }
.taro-journal-save:disabled { opacity:.6; cursor:default; }
.taro-journal-add-note { align-self:flex-start; }

.taro-outro-tools { display:flex; justify-content:center; gap:28px; }
.taro-tool { display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:0 4px; background:none; border:0; color:var(--ink-2); font-family:var(--sans); font-size:12.5px; letter-spacing:.12em; text-decoration:none; cursor:pointer; }
.taro-tool span { color:var(--ink); font-size:15px; }
.taro-tool:hover,.taro-tool:focus-visible,.taro-tool[aria-expanded="true"] { color:var(--ink); }
.taro-outro > .taro-share { width:100%; }
.taro-outro > .taro-new-reading { color:var(--ink-3); }
```

- [ ] **Step 5: 刪除舊樣式**：在 `src/app/tarot/tarot.css` 刪除 `.taro-outro-actions {…}`、`.taro-outro-actions > .taro-share {…}`、`.taro-outro-actions > .taro-secondary {…}`、`.taro-outro-actions .taro-share {…}`、`.taro-stick-action`（連同它上方的註解）、`.taro-stick-action p {…}` 這幾條規則，以及 `@media (max-width: 560px) { .taro-outro-actions {…} }` 整段（如果該 media query 裡只有這一條）。`.taro-to-stick` 相關規則保留，首頁還會用到。

用 `grep -n "taro-outro-actions\|taro-stick-action" src/app` 確認沒有殘留。

- [ ] **Step 6: 跑 UI 測試、型別檢查**

Run: `npx vitest run tests/ui && npx tsc -b`
Expected: 全部 PASS，tsc 沒有輸出。

- [ ] **Step 7: 視覺驗證**：用 `preview_start {name: "starter-dev"}` 開本機 dev server（沒接 agent 時會用 demo diviner），跑一輪到結尾頁，在 375×812 與桌機寬度各截一張圖，中文與英文都看。檢查：抽籤卡按鈕沒有被擠到下一行、日誌卡 chips 與「存下」在 375px 可以換行、分享展開後選項在圖示列正下方、沒有 console 錯誤。

- [ ] **Step 8: Commit**

```bash
git add src/app/tarot/TarotApp.tsx src/app/tarot/features.css src/app/tarot/tarot.css src/shared/tarot/i18n.ts
git commit -m "Lay out the end of a reading: Stick, journal, tools, the way out"
```

---

### 收尾

- [ ] `npm test` 與 `npm run check` 全部通過。
- [ ] 推送 `feat/outro-cta-layout`、開 PR（附 375px 截圖說明），等 Workers Builds 綠燈，等使用者說「合併」。
