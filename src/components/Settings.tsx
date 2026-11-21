import { memo, useCallback, useEffect, useRef, useState } from "react";
import { countRender } from "../lib/perf";
import type { AccountInfo, CalendarInfo, CalendarPrefs, IcsFeed, Settings, WindowMode } from "../lib/types";
import {
  addIcsFeed,
  connectApple,
  cancelGoogleLogin,
  connectGoogle,
  disconnectApple,
  disconnectGoogle,
  GOOGLE_LOGIN_CANCELLED,
  listIcsFeeds,
  removeIcsFeed,
  saveSettings,
  setWindowMode,
} from "../lib/api";
import { HOLIDAY_GREEN } from "./EventChip";

type Tab = "accounts" | "calendars" | "notify" | "display";

interface Props {
  settings: Settings;
  accounts: AccountInfo[];
  calendars: CalendarInfo[];
  onChange: (next: Settings) => void;
  onAccountsChanged: () => void;
  onClose: () => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "accounts", label: "账号" },
  { id: "calendars", label: "日历" },
  { id: "notify", label: "提醒" },
  { id: "display", label: "显示" },
];

export default function SettingsModal({ settings, accounts, calendars, onChange, onAccountsChanged, onClose }: Props) {
  countRender("Settings");
  const [tab, setTab] = useState<Tab>(() => {
    const q = new URLSearchParams(location.search).get("tab") as Tab | null;
    if (q && TABS.some((t) => t.id === q)) return q;
    return accounts.some((a) => a.connected) ? "calendars" : "accounts";
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Stable `patch` (reads the latest settings through a ref) so memoized rows below don't
  // re-render just because the modal re-rendered.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const patch = useCallback((p: Partial<Settings>) => onChangeRef.current({ ...settingsRef.current, ...p }), []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="设置">
        <div className="modal-head">
          <h2>设置</h2>
          <button type="button" className="btn btn-icon btn-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tab${tab === t.id ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="pane">
            {tab === "accounts" && (
              <AccountsPane settings={settings} accounts={accounts} patch={patch} onAccountsChanged={onAccountsChanged} />
            )}
            {tab === "calendars" && <CalendarsPane settings={settings} calendars={calendars} patch={patch} />}
            {tab === "notify" && <NotifyPane settings={settings} patch={patch} />}
            {tab === "display" && <DisplayPane settings={settings} patch={patch} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 账号 ─────────────────────────

function AccountsPane({
  settings,
  accounts,
  patch,
  onAccountsChanged,
}: {
  settings: Settings;
  accounts: AccountInfo[];
  patch: (p: Partial<Settings>) => void;
  onAccountsChanged: () => void;
}) {
  const googles = accounts.filter((a) => a.provider === "google");
  const apple = accounts.find((a) => a.provider === "apple");
  const [gBusy, setGBusy] = useState(false);
  /** id of the Google account row currently being unlinked */
  const [gRowBusy, setGRowBusy] = useState<string | null>(null);
  const [gErr, setGErr] = useState<string | null>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [aBusy, setABusy] = useState(false);
  const [aErr, setAErr] = useState<string | null>(null);
  const [appleId, setAppleId] = useState("");
  const [appPw, setAppPw] = useState("");

  const doGoogle = async () => {
    setGBusy(true);
    setGErr(null);
    try {
      // Flush any just-typed OAuth client id/secret before the backend reads them.
      await saveSettings(settings);
      await connectGoogle();
      onAccountsChanged();
    } catch (e) {
      // A user-initiated cancel is not an error worth showing.
      if (String(e) !== GOOGLE_LOGIN_CANCELLED) setGErr(String(e));
    } finally {
      setGBusy(false);
    }
  };
  const cancelGoogle = () => {
    void cancelGoogleLogin();
  };
  const undoGoogle = async (accountId: string) => {
    setGRowBusy(accountId);
    setGErr(null);
    try {
      await disconnectGoogle(accountId);
      onAccountsChanged();
    } catch (e) {
      setGErr(String(e));
    } finally {
      setGRowBusy(null);
    }
  };
  const doApple = async () => {
    if (!appleId.trim() || !appPw.trim()) {
      setAErr("请输入 Apple ID 和 App 专用密码。");
      return;
    }
    setABusy(true);
    setAErr(null);
    try {
      await connectApple(appleId.trim(), appPw.trim());
      setAppPw("");
      onAccountsChanged();
    } catch (e) {
      setAErr(String(e));
    } finally {
      setABusy(false);
    }
  };
  const undoApple = async () => {
    setABusy(true);
    try {
      await disconnectApple();
      onAccountsChanged();
    } catch (e) {
      setAErr(String(e));
    } finally {
      setABusy(false);
    }
  };

  return (
    <>
      <section className="sec">
        <h3>
          <GoogleLogo /> Google 日历
        </h3>
        {googles.length > 0 && (
          <ul className="acctlist">
            {googles.map((g) => (
              <li key={g.id} className="acctrow">
                <GoogleLogo />
                <span className="acct-label" title={g.label}>
                  {g.label || "Google 账号"}
                  {!g.connected && <span className="acct-warn"> · 需要重新登录</span>}
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => void undoGoogle(g.id)}
                  disabled={gBusy || gRowBusy !== null}
                >
                  {gRowBusy === g.id ? "正在断开连接…" : "断开连接"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" className={`btn ${googles.length ? "btn-outline" : "btn-primary"}`} onClick={doGoogle} disabled={gBusy}>
            {gBusy ? "正在浏览器中登录…" : googles.length ? "+ 添加 Google 账号" : "使用 Google 登录"}
          </button>
          {gBusy && (
            <button type="button" className="btn btn-outline" onClick={cancelGoogle}>
              取消
            </button>
          )}
        </div>
        {gBusy && <p className="help">在浏览器中完成登录后将自动返回。若已关闭浏览器窗口，请点击「取消」。</p>}
        {googles.length > 0 && <p className="help">可以同时连接多个 Google 账号。重新登录同一账号会更新授权。</p>}
        {gErr && <div className="err">{gErr}</div>}
        <button type="button" className="btn btn-link disclosure" onClick={() => setAdvOpen((v) => !v)}>
          {advOpen ? "▾" : "▸"} 高级设置（OAuth 客户端 ID 和密钥）
        </button>
        {advOpen && (
          <div className="adv">
            <p className="help">
              在 Google Cloud Console → API 和服务 → 凭据中创建<b>「桌面应用」</b>类型的 OAuth 客户端，启用 Google Calendar API 后填写以下信息。
            </p>
            <label className="field">
              <span>客户端 ID</span>
              <input
                type="text"
                value={settings.google.clientId}
                onChange={(e) => patch({ google: { ...settings.google, clientId: e.target.value } })}
                placeholder="xxxx.apps.googleusercontent.com"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>客户端密钥</span>
              <input
                type="password"
                value={settings.google.clientSecret}
                onChange={(e) => patch({ google: { ...settings.google, clientSecret: e.target.value } })}
                placeholder="GOCSPX-…"
                spellCheck={false}
              />
            </label>
          </div>
        )}
      </section>

      <section className="sec">
        <h3>
          <AppleLogo /> Apple（iCloud）日历
        </h3>
        <p className="help">
          连接 iCloud 日历需要 App 专用密码。请前往 <b>appleid.apple.com</b> → 登录与安全 → <b>App 专用密码</b>生成密码。
        </p>
        {apple?.connected ? (
          <div className="row">
            <span className="acct-label">{apple.label || "已连接"}</span>
            <button type="button" className="btn btn-outline" onClick={undoApple} disabled={aBusy}>
              断开连接
            </button>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Apple ID</span>
              <input
                type="email"
                value={appleId}
                onChange={(e) => setAppleId(e.target.value)}
                placeholder="you@icloud.com"
                autoComplete="username"
              />
            </label>
            <label className="field">
              <span>App 专用密码</span>
              <input
                type="password"
                value={appPw}
                onChange={(e) => setAppPw(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                autoComplete="current-password"
                onKeyDown={(e) => e.key === "Enter" && doApple()}
              />
            </label>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={doApple} disabled={aBusy}>
                {aBusy ? "正在连接…" : "连接 iCloud"}
              </button>
            </div>
          </>
        )}
        {aErr && <div className="err">{aErr}</div>}
      </section>

      <IcsPane onAccountsChanged={onAccountsChanged} />
    </>
  );
}

// ───────────────────────── iCal 订阅 ─────────────────────────

function IcsPane({ onAccountsChanged }: { onAccountsChanged: () => void }) {
  const [feeds, setFeeds] = useState<IcsFeed[] | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    try {
      setFeeds(await listIcsFeeds());
    } catch (e) {
      setErr(String(e));
      setFeeds([]);
    }
  };
  useEffect(() => {
    void reload();
  }, []);

  const add = async () => {
    const u = url.trim();
    if (!u) {
      setErr("请输入订阅地址。");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await addIcsFeed(name.trim(), u);
      setName("");
      setUrl("");
      await reload();
      onAccountsChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setBusy(true);
    setErr(null);
    try {
      await removeIcsFeed(id);
      await reload();
      onAccountsChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sec">
      <h3>
        <FeedIcon /> iCal 订阅（网址）
      </h3>
      <p className="help">
        无需登录即可订阅<b>只读</b>日历。对于 Google 日历，请前往「设置」，选择要订阅的日历，复制并粘贴<b>「iCal 格式的私密地址」</b>。也支持 <code>webcal://</code> 地址。
      </p>
      {feeds && feeds.length > 0 && (
        <ul className="feedlist">
          {feeds.map((f) => (
            <li key={f.id} className="feedrow">
              <span className="feed-dot" style={{ background: f.color }} />
              <span className="feed-name">{f.name}</span>
              <span className="feed-url" title={f.url}>
                {f.url}
              </span>
              <button type="button" className="btn btn-link btn-sm" onClick={() => void remove(f.id)} disabled={busy}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="feed-add">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="名称（例如法定节假日）" className="feed-name-input" />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          spellCheck={false}
          onKeyDown={(e) => e.key === "Enter" && void add()}
        />
        <button type="button" className="btn btn-primary" onClick={() => void add()} disabled={busy}>
          {busy ? "处理中…" : "添加"}
        </button>
      </div>
      {err && <div className="err">{err}</div>}
    </section>
  );
}

function FeedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ───────────────────────── 日历 ─────────────────────────

function CalendarsPane({
  settings,
  calendars,
  patch,
}: {
  settings: Settings;
  calendars: CalendarInfo[];
  patch: (p: Partial<Settings>) => void;
}) {
  countRender("CalendarsPane");
  // Stable per-row updater: reads the latest prefs via a ref so rows can be memoized.
  const prefsRef = useRef(settings.calendars);
  prefsRef.current = settings.calendars;
  const setPrefs = useCallback(
    (id: string, p: Partial<CalendarPrefs>) => {
      const cur = prefsRef.current[id] ?? { visible: true, notify: true };
      patch({ calendars: { ...prefsRef.current, [id]: { ...cur, ...p } } });
    },
    [patch],
  );

  if (calendars.length === 0) {
    return <p className="help">暂无已同步的日历。请在「账号」中登录后同步。</p>;
  }

  const mine = calendars.filter((c) => c.owned);
  const others = calendars.filter((c) => !c.owned);
  const multiAccount = new Set(calendars.map((c) => c.account || "")).size > 1;

  return (
    <>
      <CalendarGroup title="我的日历" list={mine} prefs={settings.calendars} multiAccount={multiAccount} setPrefs={setPrefs} />
      <CalendarGroup title="其他日历" list={others} prefs={settings.calendars} multiAccount={multiAccount} setPrefs={setPrefs} />
      <p className="help">勾选以显示日历，点击铃铛可开关该日历的提醒。</p>
    </>
  );
}

const DEFAULT_PREFS: CalendarPrefs = { visible: true, notify: true };

function accountLabel(c: CalendarInfo): string {
  return c.account || (c.provider === "apple" ? "iCloud" : c.provider === "ics" ? "iCal" : "Google");
}

// Module-level components (not re-created per render) so React keeps the row DOM between
// toggles instead of remounting the whole list; rows are memoized on their own prefs.
function CalendarGroup({
  title,
  list,
  prefs,
  multiAccount,
  setPrefs,
}: {
  title: string;
  list: CalendarInfo[];
  prefs: Settings["calendars"];
  multiAccount: boolean;
  setPrefs: (id: string, p: Partial<CalendarPrefs>) => void;
}) {
  if (list.length === 0) return null;
  const rows = (cals: CalendarInfo[]) => (
    <ul className="callist">
      {cals.map((c) => (
        <CalendarRow key={c.id} cal={c} prefs={prefs[c.id] ?? DEFAULT_PREFS} setPrefs={setPrefs} />
      ))}
    </ul>
  );
  if (!multiAccount) {
    return (
      <section className="sec">
        <h3>{title}</h3>
        {rows(list)}
      </section>
    );
  }
  const byAccount = new Map<string, CalendarInfo[]>();
  for (const c of list) {
    const k = accountLabel(c);
    byAccount.set(k, [...(byAccount.get(k) ?? []), c]);
  }
  return (
    <section className="sec">
      <h3>{title}</h3>
      {Array.from(byAccount.entries()).map(([acct, cals]) => (
        <div key={acct} className="calgroup">
          <div className="calgroup-head" title={acct}>
            {acct}
          </div>
          {rows(cals)}
        </div>
      ))}
    </section>
  );
}

const CalendarRow = memo(function CalendarRow({
  cal: c,
  prefs: p,
  setPrefs,
}: {
  cal: CalendarInfo;
  prefs: CalendarPrefs;
  setPrefs: (id: string, p: Partial<CalendarPrefs>) => void;
}) {
  countRender("CalendarRow");
  const color = c.isHoliday ? HOLIDAY_GREEN : (p.color ?? c.color);
  return (
    <li className="calrow">
      <label className="calcheck" title={p.visible ? "隐藏" : "显示"}>
        <input type="checkbox" checked={p.visible} onChange={(e) => setPrefs(c.id, { visible: e.target.checked })} />
        <span className="calbox" style={{ background: p.visible ? color : "transparent", borderColor: color }}>
          {p.visible && <CheckMark />}
        </span>
      </label>
      <span className="calname">
        {c.name}
        {!c.canEdit && (
          <span className="cal-ro" title="只读（无法创建日程）">
            🔒
          </span>
        )}
      </span>
      <label className="swatch" title="更改颜色" style={{ background: color }}>
        <input type="color" value={toHex6(color)} onChange={(e) => setPrefs(c.id, { color: e.target.value })} />
      </label>
      <button
        type="button"
        className={`btn btn-icon bell${p.notify ? " on" : ""}`}
        onClick={() => setPrefs(c.id, { notify: !p.notify })}
        title={p.notify ? "提醒已开启（点击关闭）" : "提醒已关闭（点击开启）"}
        aria-label="切换提醒"
      >
        <BellIcon off={!p.notify} />
      </button>
    </li>
  );
});

// ───────────────────────── 提醒 ─────────────────────────

const REMINDER_OPTIONS: { v: number; label: string }[] = [
  { v: -1, label: "不提醒" },
  { v: 0, label: "日程开始时" },
  { v: 5, label: "提前 5 分钟" },
  { v: 10, label: "提前 10 分钟" },
  { v: 15, label: "提前 15 分钟" },
  { v: 30, label: "提前 30 分钟" },
  { v: 60, label: "提前 1 小时" },
];

function NotifyPane({ settings, patch }: { settings: Settings; patch: (p: Partial<Settings>) => void }) {
  return (
    <section className="sec">
      <Toggle
        label="启用提醒"
        desc="在设定时间显示 Windows 通知。"
        checked={settings.notificationsEnabled}
        onChange={(v) => patch({ notificationsEnabled: v })}
      />
      <label className="field inline">
        <span>默认提醒时间</span>
        <select
          value={settings.defaultReminderMin}
          onChange={(e) => patch({ defaultReminderMin: Number(e.target.value) })}
          disabled={!settings.notificationsEnabled}
        >
          {REMINDER_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="help">日程未单独设置提醒时使用此选项。</p>
      <label className="field inline">
        <span>全天日程提醒时间</span>
        <input
          type="time"
          value={settings.allDayReminderTime}
          onChange={(e) => patch({ allDayReminderTime: e.target.value })}
          disabled={!settings.notificationsEnabled}
        />
      </label>
      <p className="help">在「日历」页中点击铃铛，可单独设置各日历的提醒。</p>
    </section>
  );
}

// ───────────────────────── 显示 ─────────────────────────

const MODES: { v: WindowMode; label: string; desc: string }[] = [
  { v: "floating", label: "普通窗口", desc: "通过系统托盘图标打开和隐藏，任务栏不显示窗口按钮。" },
  { v: "desktop", label: "桌面小组件", desc: "位于桌面图标上方、其他窗口下方，可交互。按 Win+D 后仍显示。" },
  { v: "wallpaper", label: "桌面背景", desc: "位于桌面图标下方，仅供查看。" },
];

function DisplayPane({ settings, patch }: { settings: Settings; patch: (p: Partial<Settings>) => void }) {
  countRender("DisplayPane");
  const changeMode = (m: WindowMode) => {
    patch({ windowMode: m });
    void setWindowMode(m);
  };
  return (
    <>
      <section className="sec">
        <h3>窗口模式</h3>
        <div className="radios">
          {MODES.map((m) => (
            <label key={m.v} className={`radio${settings.windowMode === m.v ? " active" : ""}`}>
              <input type="radio" name="mode" checked={settings.windowMode === m.v} onChange={() => changeMode(m.v)} />
              <span className="radio-label">{m.label}</span>
              <span className="radio-desc">{m.desc}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="sec">
        <label className="field inline">
          <span>背景不透明度</span>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.02}
            value={settings.opacity}
            onChange={(e) => patch({ opacity: Number(e.target.value) })}
          />
          <span className="val">{Math.round(settings.opacity * 100)}%</span>
        </label>
        <div className="field inline">
          <span>主题</span>
          <Segmented
            value={settings.theme}
            onChange={(v) => patch({ theme: v })}
            options={[
              { v: "system", label: "跟随 Windows", title: "跟随 Windows 的浅色或深色模式。" },
              { v: "light", label: "浅色" },
              { v: "dark", label: "深色" },
            ]}
          />
        </div>
        <div className="field inline">
          <span>样式</span>
          <Segmented
            value={settings.style ?? "glass"}
            onChange={(v) => patch({ style: v })}
            options={[
              { v: "glass", label: "液态玻璃", swatch: "glass", title: "半透明玻璃，带模糊和光泽效果" },
              { v: "flat", label: "纯色", swatch: "flat", title: "不透明的纯色背景" },
            ]}
          />
        </div>
        <label className="field inline">
          <span>每周起始日</span>
          <select value={settings.weekStart} onChange={(e) => patch({ weekStart: Number(e.target.value) as 0 | 1 })}>
            <option value={0}>星期日</option>
            <option value={1}>星期一</option>
          </select>
        </label>
        <label className="field inline">
          <span>同步间隔</span>
          <select value={settings.syncIntervalMin} onChange={(e) => patch({ syncIntervalMin: Number(e.target.value) })}>
            {[5, 10, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} 分钟
              </option>
            ))}
          </select>
        </label>
        <Toggle label="开机自启" desc="登录 Windows 后自动启动，并在系统托盘显示图标。" checked={settings.autostart} onChange={(v) => patch({ autostart: v })} />
        {settings.autostart && (
          <Toggle
            label="启动时显示窗口"
            desc="关闭后，启动时只显示系统托盘图标。"
            checked={settings.autostartVisible ?? true}
            onChange={(v) => patch({ autostartVisible: v })}
          />
        )}
      </section>
    </>
  );
}

// ───────────────────────── bits ─────────────────────────

/** Pill-shaped segmented control for theme and style selection. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string; title?: string; swatch?: "glass" | "flat" }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          title={o.title}
          className={`seg-btn${value === o.v ? " active" : ""}`}
          onClick={() => onChange(o.v)}
        >
          {o.swatch && <span className={`style-swatch ${o.swatch}`} aria-hidden="true" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {desc && <span className="toggle-desc">{desc}</span>}
      </span>
      <span className={`switch${checked ? " on" : ""}`}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="knob" />
      </span>
    </label>
  );
}

function toHex6(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("");
  return "#4285f4";
}

function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L19 7" />
    </svg>
  );
}

function BellIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.4 12.7c0-2.5 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.7.9-.8 0-2-.9-3.2-.9-1.7 0-3.2 1-4.1 2.5-1.8 3-.5 7.6 1.3 10.1.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.2-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-3.1-4.1zM14 5.5c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
    </svg>
  );
}
