// In-browser mock of the Tauri backend, used when running `vite` outside Tauri.
import type {
  AccountInfo,
  CalEvent,
  CalendarInfo,
  EventInput,
  IcsFeed,
  InvitationResponse,
  Settings,
  SyncResult,
  WindowMode,
} from "./types";

const iso = (y: number, m: number, d: number, h = 0, min = 0) => {
  const dt = new Date(y, m - 1, d, h, min);
  const off = -dt.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  return (
    `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:00` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
};
const day = (y: number, m: number, d: number) => {
  const dt = new Date(y, m - 1, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

const ACCT_A = { id: "a1", email: "me@example.com" };
const ACCT_B = { id: "b2", email: "work@example.com" };

const gcal = (
  acct: { id: string; email: string },
  remoteId: string,
  name: string,
  color: string,
  owned: boolean,
  canEdit: boolean,
  isHoliday = false,
): CalendarInfo => ({
  id: `google:${acct.id}:${remoteId}`,
  provider: "google",
  remoteId,
  name,
  color,
  owned,
  isHoliday,
  canEdit,
  account: acct.email,
});

const calendarsA: CalendarInfo[] = [
  gcal(ACCT_A, "me", "我的日历", "#4285f4", true, true),
  gcal(ACCT_A, "tasks", "待办事项", "#4285f4", true, true),
  gcal(ACCT_A, "bday", "生日", "#0b8043", true, false),
  gcal(ACCT_A, "michelo", "Michelo Robotics", "#e67c73", false, true),
  gcal(ACCT_A, "ko.south_korea#holiday", "韩国节假日", "#0b8043", false, false, true),
];
const calendarsB: CalendarInfo[] = [
  gcal(ACCT_B, "work", "工作", "#8e24aa", true, true),
  gcal(ACCT_B, "team", "团队共享", "#f6bf26", false, true),
];
let calendars: CalendarInfo[] = [...calendarsA, ...calendarsB];

const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth() + 1;

let idc = 0;
const mk = (calendarId: string, title: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => {
  const remoteId = String(++idc);
  return {
    id: `${calendarId}:${remoteId}:${start}`,
    calendarId,
    remoteId,
    editable: calendars.find((c) => c.id === calendarId)?.canEdit ?? false,
    title,
    start,
    end,
    allDay: start.length === 10,
    reminders: [],
    ...extra,
  };
};

let events: CalEvent[] = [
  mk("google:a1:me", "【邀请】合作伙伴会议", iso(Y, M, 22, 10), iso(Y, M, 22, 11, 30), {
    editable: false,
    canRespond: true,
    responseStatus: "needsAction",
    organizer: { email: "host@example.com", displayName: "组织者", isSelf: false },
    attendees: [
      { email: "host@example.com", displayName: "组织者", isSelf: false, organizer: true, optional: false, responseStatus: "accepted" },
      { email: "colleague@example.com", displayName: "同事", isSelf: false, organizer: false, optional: false, responseStatus: "accepted" },
      { email: "me@example.com", displayName: "我", isSelf: true, organizer: false, optional: false, responseStatus: "needsAction" },
    ],
    description: "请查看会议议程。\n\n1. 分享当前进展\n2. 讨论后续安排",
  }),
  mk("google:a1:michelo", "🌴 崔成元休假", day(Y, M, 1), day(Y, M, 2)),
  mk("google:a1:michelo", "【Michelo】核对上月公司卡账单", day(Y, M, 1), day(Y, M, 2)),
  mk("google:a1:michelo", "【AI 业务融合】协调会议", day(Y, M, 2), day(Y, M, 3)),
  mk("google:a1:michelo", "🌴 尹汝尚休假", day(Y, M, 2), day(Y, M, 5)),
  mk("google:a1:michelo", "🌴 李建宇休假", day(Y, M, 3), day(Y, M, 4)),
  mk("google:a1:michelo", "🌴 洪吉童休假", day(Y, M, 3), day(Y, M, 4)),
  mk("google:a1:bday", "🎂 郑泰俊的生日", day(Y, M, 3), day(Y, M, 4)),
  mk("google:a1:michelo", "上午 8:30 安荣士出差", day(Y, M, 4), day(Y, M, 6)),
  mk("google:a1:michelo", "【首尔 TIPS】录入研究成果", iso(Y, M, 4, 9, 0), iso(Y, M, 4, 10, 0), { location: "会议室 A" }),
  mk("google:a1:michelo", "参观 Withus 21 维修仓库", iso(Y, M, 4, 10, 0), iso(Y, M, 4, 11, 30)),
  mk("google:a1:michelo", "【研究组】例会", iso(Y, M, 4, 16, 0), iso(Y, M, 4, 17, 0)),
  mk("google:a1:michelo", "【UR 与成元】会见河宗元", iso(Y, M, 4, 18, 0), iso(Y, M, 4, 19, 0)),
  mk("google:a1:me", "与 Finger 公司负责人洪承杓会面", iso(Y, M, 1, 11, 30), iso(Y, M, 1, 12, 30)),
  mk("google:a1:me", "前端团队会议", iso(Y, M, 1, 13, 0), iso(Y, M, 1, 14, 0), { description: "分享本周进展", htmlLink: "https://calendar.google.com" }),
  mk("google:a1:me", "前端团队会议", iso(Y, M, 8, 13, 0), iso(Y, M, 8, 14, 0)),
  mk("google:a1:me", "前端团队会议", iso(Y, M, 15, 13, 0), iso(Y, M, 15, 14, 0)),
  mk("google:a1:me", "【门窗项目】现场走访", iso(Y, M, 8, 10, 30), iso(Y, M, 8, 12, 0)),
  mk("google:a1:tasks", "体检预约", iso(Y, M, 8, 9, 0), iso(Y, M, 8, 9, 30)),
  mk("google:a1:me", "【新东海】问答会", iso(Y, M, 9, 14, 45), iso(Y, M, 9, 15, 30)),
  mk("google:a1:me", "【施密特】与金贤俊会面", iso(Y, M, 9, 18, 30), iso(Y, M, 9, 19, 30)),
  mk("google:a1:michelo", "JCore 出差", day(Y, M, 11), day(Y, M, 12)),
  mk("google:a1:michelo", "🌴 文希珍休假", day(Y, M, 11), day(Y, M, 13)),
  mk("google:a1:michelo", "🌴 南宫旻浩休假", day(Y, M, 10), day(Y, M, 12)),
  mk("google:a1:michelo", "【国防创业项目】第一阶段结算", day(Y, M, 14), day(Y, M, 15)),
  mk("google:a1:michelo", "朴相勇体检", day(Y, M, 14), day(Y, M, 15)),
  mk("google:a1:michelo", "🌴 朴相勇休假", day(Y, M, 14), day(Y, M, 15)),
  mk("google:a1:michelo", "🌴 张明根休假", day(Y, M, 14), day(Y, M, 15)),
  mk("google:a1:michelo", "【AI 虚拟融合】双周会议", iso(Y, M, 15, 10, 0), iso(Y, M, 15, 11, 0)),
  mk("google:a1:michelo", "【运营支持】第一轮面试", iso(Y, M, 15, 10, 0), iso(Y, M, 15, 12, 0)),
  mk("google:a1:michelo", "【Stonebridge】会见赵贤宇", iso(Y, M, 15, 18, 0), iso(Y, M, 15, 19, 0)),
  mk("google:a1:michelo", "【研究组】例会", iso(Y, M, 17, 16, 0), iso(Y, M, 17, 17, 0)),
  mk("google:a1:michelo", "【首尔 TIPS】提交结项报告", day(Y, M, 18), day(Y, M, 19)),
  mk("google:a1:ko.south_korea#holiday", "秋夕假期", day(Y, M, 24), day(Y, M, 27)),
  mk("google:a1:ko.south_korea#holiday", "秋夕", day(Y, M, 25), day(Y, M, 26)),
  mk("google:a1:michelo", "【Michelo】每周例会", iso(Y, M, 25, 17, 0), iso(Y, M, 25, 18, 0)),
  mk("google:a1:michelo", "【Michelo】每周例会", iso(Y, M, 26, 17, 0), iso(Y, M, 26, 18, 0)),
  mk("google:a1:ko.south_korea#holiday", "开天节", day(Y, M + 1, 3), day(Y, M + 1, 4)),
  mk("google:a1:ko.south_korea#holiday", "国军日", day(Y, M + 1, 1), day(Y, M + 1, 2)),
  mk("google:b2:work", "每周工作汇报", iso(Y, M, 2, 9, 30), iso(Y, M, 2, 10, 0)),
  mk("google:b2:work", "季度复盘", iso(Y, M, 16, 14, 0), iso(Y, M, 16, 15, 30), { location: "总部 12 楼" }),
  mk("google:b2:team", "团队工作坊", day(Y, M, 19), day(Y, M, 20)),
];

let settings: Settings = {
  windowMode: "floating",
  opacity: 0.96,
  theme: "system",
  style: "glass",
  weekStart: 0,
  syncIntervalMin: 15,
  autostart: false,
  autostartVisible: true,
  defaultReminderMin: 10,
  notificationsEnabled: true,
  allDayReminderTime: "09:00",
  google: { clientId: "", clientSecret: "" },
  calendars: {},
};

let accounts: AccountInfo[] = [
  { provider: "google", id: ACCT_A.id, label: ACCT_A.email, connected: true },
  { provider: "google", id: ACCT_B.id, label: ACCT_B.email, connected: true },
  { provider: "apple", id: "apple", label: "", connected: false },
  { provider: "ics", id: "ics", label: "", connected: false },
];

let feeds: IcsFeed[] = [];
const feedCalendars = (): CalendarInfo[] =>
  feeds.map((f) => ({
    id: `ics:${f.id}`,
    provider: "ics",
    remoteId: f.id,
    name: f.name,
    color: f.color,
    owned: false,
    isHoliday: false,
    canEdit: false,
    account: "iCal",
  }));
const syncIcsAccount = () => {
  accounts = accounts.map((a) =>
    a.provider === "ics" ? { ...a, connected: feeds.length > 0, label: feeds.length ? `${feeds.length} 个订阅` : "" } : a,
  );
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const loggedIn = () => accounts.some((a) => a.provider !== "ics" && a.connected);
const result = (): SyncResult => ({
  calendars: [...(loggedIn() ? calendars : []), ...feedCalendars()],
  events: loggedIn() ? events : [],
  syncedAt: new Date().toISOString(),
  errors: [],
  rangeStart: day(Y, M - 1, 1),
  rangeEnd: day(Y, M + 2, 1),
});

export const mock = {
  getSettings: async () => settings,
  saveSettings: async (s: Settings) => {
    settings = s;
  },
  getAccounts: async () => accounts,
  connectGoogle: async () => {
    await delay(800);
    // Link whichever mock account is missing (A first, then B); re-linking refreshes.
    const missing = [ACCT_A, ACCT_B].find((a) => !accounts.some((x) => x.provider === "google" && x.id === a.id));
    const acct = missing ?? ACCT_A;
    const info: AccountInfo = { provider: "google", id: acct.id, label: acct.email, connected: true };
    if (missing) {
      accounts = [...accounts.filter((a) => a.provider !== "google"), ...accounts.filter((a) => a.provider === "google"), info]
        .sort((a, b) => (a.provider === b.provider ? 0 : a.provider === "google" ? -1 : b.provider === "google" ? 1 : 0));
      calendars = [...calendars, ...(acct.id === ACCT_A.id ? calendarsA : calendarsB)];
    } else {
      accounts = accounts.map((a) => (a.id === acct.id ? info : a));
    }
    return info;
  },
  disconnectGoogle: async (accountId: string) => {
    accounts = accounts.filter((a) => !(a.provider === "google" && a.id === accountId));
    const prefix = `google:${accountId}:`;
    calendars = calendars.filter((c) => !c.id.startsWith(prefix));
    events = events.filter((e) => !e.calendarId.startsWith(prefix));
  },
  connectApple: async (appleId: string, _pw: string) => {
    await delay(800);
    accounts = accounts.map((a) => (a.provider === "apple" ? { ...a, connected: true, label: appleId } : a));
    return accounts.find((a) => a.provider === "apple")!;
  },
  disconnectApple: async () => {
    accounts = accounts.map((a) => (a.provider === "apple" ? { ...a, connected: false, label: "" } : a));
  },
  getCached: async () => result(),
  syncNow: async (_s: string, _e: string) => {
    await delay(600);
    return result();
  },
  setWindowMode: async (_m: WindowMode) => {},
  hideWindow: async () => {},
  openUrl: async (url: string) => {
    window.open(url, "_blank");
  },
  noopListen: async () => () => {},

  // ── write ops ──
  respondEvent: async (calendarId: string, remoteId: string, responseStatus: InvitationResponse) => {
    await delay(300);
    const event = events.find((e) => e.calendarId === calendarId && e.remoteId === remoteId);
    if (!event?.canRespond) throw new Error("无法回复此日程的邀请。");
    const updated: CalEvent = {
      ...event,
      responseStatus,
      attendees: event.attendees?.map((a) => a.isSelf ? { ...a, responseStatus } : a),
    };
    events = events.map((e) => e === event ? updated : e);
    return updated;
  },
  createEvent: async (input: EventInput) => {
    await delay(300);
    if (!input.title.trim()) throw new Error("请输入标题。");
    events = [
      ...events,
      mk(input.calendarId, input.title, input.start, input.end, {
        location: input.location,
        description: input.description,
        reminders: input.reminders,
      }),
    ];
    return result();
  },
  updateEvent: async (calendarId: string, remoteId: string, input: EventInput) => {
    await delay(300);
    events = events.map((e) =>
      e.calendarId === calendarId && e.remoteId === remoteId
        ? {
            ...e,
            id: `${calendarId}:${remoteId}:${input.start}`,
            title: input.title,
            start: input.start,
            end: input.end,
            allDay: input.allDay,
            location: input.location,
            description: input.description,
            reminders: input.reminders,
          }
        : e,
    );
    return result();
  },
  deleteEvent: async (calendarId: string, remoteId: string) => {
    await delay(300);
    events = events.filter((e) => !(e.calendarId === calendarId && e.remoteId === remoteId));
    return result();
  },

  // ── ics feeds ──
  listIcsFeeds: async () => feeds,
  addIcsFeed: async (name: string, url: string) => {
    await delay(500);
    if (!/^(https?|webcal):\/\//i.test(url)) throw new Error("订阅地址无效（须以 http://、https:// 或 webcal:// 开头）。");
    const f: IcsFeed = { id: String(Date.now()), name: name || "iCal 订阅", url, color: "#7986cb" };
    feeds = [...feeds, f];
    syncIcsAccount();
    return f;
  },
  removeIcsFeed: async (id: string) => {
    feeds = feeds.filter((f) => f.id !== id);
    syncIcsAccount();
  },
};
