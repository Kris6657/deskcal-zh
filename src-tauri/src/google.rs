//! Google: OAuth 2.0 (PKCE + loopback redirect) and Calendar API v3 (read/write).
use crate::model::{CalEvent, CalendarInfo, EventAttendee, EventOrganizer, Provider, ResponseStatus};
use base64::Engine;
use chrono::{DateTime, NaiveDate, Utc};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SCOPES: &str = "openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events";

#[cfg(test)]
mod tests;

const PAGE_OK: &str = "<html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>DeskCal 中文版</title></head><body style=\"font-family:'Microsoft YaHei UI',system-ui,sans-serif;text-align:center;padding-top:80px\"><h2>登录成功</h2><p>请关闭此窗口并返回 DeskCal。</p></body></html>";
const PAGE_FAIL: &str = "<html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>DeskCal 中文版</title></head><body style=\"font-family:'Microsoft YaHei UI',system-ui,sans-serif;text-align:center;padding-top:80px\"><h2>登录失败</h2><p>请返回 DeskCal 重试。</p></body></html>";

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub struct LoginResult {
    pub email: String,
    pub refresh_token: String,
    pub access_token: String,
    pub expires_in: i64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    id_token: Option<String>,
}

pub const CANCELLED_MSG: &str = "登录已取消。";

/// Waits for the OAuth redirect on the given listener and returns (code, state).
/// `cancel` is checked after every accepted connection; `cancel_login` wakes the listener by
/// connecting to it so a cancel takes effect immediately.
fn wait_for_code(
    listener: TcpListener,
    timeout: Duration,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<(String, String), String> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if std::time::Instant::now() > deadline {
            return Err("登录超时。".into());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(v) => v,
            Err(e) => return Err(format!("等待登录回调失败：{e}")),
        };
        if cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CANCELLED_MSG.into());
        }
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let first = req.lines().next().unwrap_or("");
        // "GET /?code=...&state=... HTTP/1.1"
        let path = first.split_whitespace().nth(1).unwrap_or("/");
        if path.starts_with("/favicon") {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        }
        let url = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| format!("无法解析登录回调地址：{e}"))?;
        let mut code = None;
        let mut state = None;
        let mut error = None;
        for (k, v) in url.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.to_string()),
                "state" => state = Some(v.to_string()),
                "error" => error = Some(v.to_string()),
                _ => {}
            }
        }
        let (status, body) = if code.is_some() { ("200 OK", PAGE_OK) } else { ("400 Bad Request", PAGE_FAIL) };
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        );
        let _ = stream.flush();
        if let Some(err) = error {
            return Err(format!("Google 拒绝登录请求：{err}"));
        }
        if let (Some(c), Some(s)) = (code, state) {
            return Ok((c, s));
        }
    }
}

/// Wakes a pending `login` so it notices `cancel` right away.
pub fn cancel_login(port: u16) {
    let _ = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(500),
    );
}

/// Full interactive login. `open` is called with the URL to open in the browser; `on_port`
/// receives the loopback port so the caller can cancel via `cancel_login`.
pub async fn login(
    http: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    on_port: impl FnOnce(u16),
    open: impl FnOnce(String) -> Result<(), String>,
) -> Result<LoginResult, String> {
    if client_id.trim().is_empty() {
        return Err(
            "尚未配置 Google OAuth 客户端 ID。请在「设置」→「账号」→「高级设置」中填写。".into(),
        );
    }
    let mut verifier_bytes = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    let verifier = b64url(&verifier_bytes);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let mut state_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut state_bytes);
    let state = b64url(&state_bytes);

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("无法打开本地端口：{e}"))?;
    let port = listener.local_addr().map_err(|e| format!("无法获取本地端口：{e}"))?.port();
    on_port(port);
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let mut auth = url::Url::parse(AUTH_URL).unwrap();
    auth.query_pairs_mut()
        .append_pair("client_id", client_id.trim())
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &state);

    open(auth.to_string())?;

    let expected_state = state.clone();
    let cancel_flag = cancel.clone();
    let (code, got_state) =
        tokio::task::spawn_blocking(move || wait_for_code(listener, Duration::from_secs(300), &cancel_flag))
            .await
            .map_err(|e| format!("登录回调处理失败：{e}"))??;
    if got_state != expected_state {
        return Err("OAuth 状态参数（state）不匹配。".into());
    }

    let mut form = vec![
        ("code", code),
        ("client_id", client_id.trim().to_string()),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code".to_string()),
        ("code_verifier", verifier),
    ];
    if !client_secret.trim().is_empty() {
        form.push(("client_secret", client_secret.trim().to_string()));
    }
    let resp = http.post(TOKEN_URL).form(&form).send().await.map_err(|e| format!("请求 Google 登录令牌失败：{e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("无法读取 Google 登录响应：{e}"))?;
    if !status.is_success() {
        return Err(format!("Google 登录令牌交换失败（{status}）：{text}"));
    }
    let tok: TokenResponse = serde_json::from_str(&text).map_err(|e| format!("无法解析 Google 登录响应：{e}"))?;
    let refresh_token = tok
        .refresh_token
        .ok_or("未收到刷新令牌（refresh_token）。请重试。")?;

    let email = match fetch_email(http, &tok.access_token).await {
        Some(e) => e,
        None => tok
            .id_token
            .as_deref()
            .and_then(email_from_id_token)
            .unwrap_or_else(|| "Google 账号".into()),
    };

    Ok(LoginResult {
        email,
        refresh_token,
        access_token: tok.access_token,
        expires_in: tok.expires_in.unwrap_or(3600),
    })
}

async fn fetch_email(http: &reqwest::Client, access_token: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct UserInfo {
        email: Option<String>,
    }
    let r = http
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;
    r.json::<UserInfo>().await.ok()?.email
}

fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v.get("email")?.as_str().map(|s| s.to_string())
}

#[derive(Clone)]
pub struct AccessToken {
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

pub async fn refresh_access_token(
    http: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<AccessToken, String> {
    let mut form = vec![
        ("client_id", client_id.trim().to_string()),
        ("refresh_token", refresh_token.to_string()),
        ("grant_type", "refresh_token".to_string()),
    ];
    if !client_secret.trim().is_empty() {
        form.push(("client_secret", client_secret.trim().to_string()));
    }
    let resp = http.post(TOKEN_URL).form(&form).send().await.map_err(|e| format!("请求刷新 Google 令牌失败：{e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("无法读取 Google 令牌刷新响应：{e}"))?;
    if !status.is_success() {
        log::warn!("google refresh failed: {text}");
        return Err(format!("Google 令牌刷新失败（{status}）。请在设置中重新登录。"));
    }
    let tok: TokenResponse = serde_json::from_str(&text).map_err(|e| format!("无法解析 Google 令牌刷新响应：{e}"))?;
    Ok(AccessToken {
        token: tok.access_token,
        expires_at: Utc::now() + chrono::Duration::seconds(tok.expires_in.unwrap_or(3600) - 60),
    })
}

// ── Calendar API ──

#[derive(Deserialize)]
struct CalendarListResponse {
    #[serde(default)]
    items: Vec<CalendarListEntry>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct CalendarListEntry {
    id: String,
    #[serde(default)]
    summary: String,
    #[serde(rename = "summaryOverride")]
    summary_override: Option<String>,
    #[serde(rename = "backgroundColor")]
    background_color: Option<String>,
    #[serde(rename = "accessRole", default)]
    access_role: String,
    #[serde(default)]
    primary: bool,
    #[serde(rename = "defaultReminders", default)]
    default_reminders: Vec<Reminder>,
    #[serde(default)]
    deleted: bool,
}

#[derive(Deserialize, Clone)]
struct Reminder {
    #[serde(default)]
    method: String,
    #[serde(default)]
    minutes: i64,
}

/// Calendar ids are namespaced per linked account: `google:<accountId>:<calendarId>`.
pub fn calendar_id(account_id: &str, remote_id: &str) -> String {
    format!("google:{account_id}:{remote_id}")
}

pub async fn list_calendars(
    http: &reqwest::Client,
    token: &str,
    account: &crate::model::GoogleAccount,
) -> Result<Vec<CalendarInfo>, String> {
    let mut out = Vec::new();
    let mut page: Option<String> = None;
    loop {
        let mut req = http
            .get("https://www.googleapis.com/calendar/v3/users/me/calendarList")
            .bearer_auth(token)
            .query(&[("maxResults", "250"), ("showHidden", "false")]);
        if let Some(p) = &page {
            req = req.query(&[("pageToken", p)]);
        }
        let resp = req.send().await.map_err(|e| format!("获取 Google 日历列表失败：{e}"))?;
        if !resp.status().is_success() {
            return Err(format!("获取 Google 日历列表失败（{}）", resp.status()));
        }
        let body: CalendarListResponse = resp.json().await.map_err(|e| format!("无法解析 Google 日历列表：{e}"))?;
        for c in body.items {
            if c.deleted {
                continue;
            }
            let name = c.summary_override.clone().unwrap_or(c.summary.clone());
            let lower = c.id.to_lowercase();
            let is_holiday = lower.contains("holiday@group.v.calendar.google.com")
                || name.contains("휴일")
                || name.to_lowercase().contains("holiday");
            let owned = c.primary || c.access_role == "owner";
            let can_edit = c.access_role == "owner" || c.access_role == "writer";
            out.push(CalendarInfo {
                id: calendar_id(&account.id, &c.id),
                provider: Provider::Google,
                remote_id: c.id.clone(),
                name,
                color: c.background_color.unwrap_or_else(|| "#4285f4".into()),
                owned,
                is_holiday,
                can_edit,
                account: account.email.clone(),
                default_reminders: c
                    .default_reminders
                    .iter()
                    .filter(|r| r.method == "popup")
                    .map(|r| r.minutes)
                    .collect(),
            });
        }
        match body.next_page_token {
            Some(p) => page = Some(p),
            None => break,
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
struct EventsResponse {
    #[serde(default)]
    items: Vec<GEvent>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct GEvent {
    id: String,
    #[serde(default)]
    status: String,
    summary: Option<String>,
    location: Option<String>,
    description: Option<String>,
    #[serde(rename = "htmlLink")]
    html_link: Option<String>,
    start: Option<GTime>,
    end: Option<GTime>,
    reminders: Option<GReminders>,
    #[serde(rename = "eventType")]
    event_type: Option<String>,
    #[serde(default)]
    attendees: Vec<EventAttendee>,
    organizer: Option<EventOrganizer>,
    #[serde(rename = "attendeesOmitted", default)]
    attendees_omitted: bool,
    #[serde(rename = "guestsCanModify", default)]
    guests_can_modify: bool,
    #[serde(rename = "recurringEventId")]
    recurring_event_id: Option<String>,
}

#[derive(Deserialize)]
struct GTime {
    date: Option<String>,
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
}

#[derive(Deserialize)]
struct GReminders {
    #[serde(rename = "useDefault", default)]
    use_default: bool,
    #[serde(default)]
    overrides: Vec<Reminder>,
}

pub async fn list_events(
    http: &reqwest::Client,
    token: &str,
    cal: &CalendarInfo,
    range_start: NaiveDate,
    range_end: NaiveDate,
) -> Result<Vec<CalEvent>, String> {
    list_events_at(http, token, cal, range_start, range_end, &format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events",
        urlencode(&cal.remote_id)
    )).await
}

async fn list_events_at(
    http: &reqwest::Client,
    token: &str,
    cal: &CalendarInfo,
    range_start: NaiveDate,
    range_end: NaiveDate,
    endpoint: &str,
) -> Result<Vec<CalEvent>, String> {
    let time_min = format!("{}T00:00:00Z", range_start - chrono::Duration::days(1));
    let time_max = format!("{}T00:00:00Z", range_end + chrono::Duration::days(1));
    let mut out = Vec::new();
    let mut page: Option<String> = None;
    loop {
        let mut req = http
            .get(endpoint)
            .bearer_auth(token)
            .query(&[
                ("singleEvents", "true"),
                ("showHiddenInvitations", "true"),
                ("orderBy", "startTime"),
                ("maxResults", "2500"),
                ("timeMin", time_min.as_str()),
                ("timeMax", time_max.as_str()),
            ]);
        if let Some(p) = &page {
            req = req.query(&[("pageToken", p)]);
        }
        let resp = req.send().await.map_err(|e| format!("获取「{}」的日程失败：{e}", cal.name))?;
        if !resp.status().is_success() {
            return Err(format!("获取「{}」的日程失败（{}）", cal.name, resp.status()));
        }
        let body: EventsResponse = resp.json().await.map_err(|e| format!("无法解析 Google 日程：{e}"))?;
        out.extend(body.items.into_iter().filter_map(|e| to_event(e, cal)));
        match body.next_page_token {
            Some(p) => page = Some(p),
            None => break,
        }
    }
    Ok(out)
}

fn to_event(e: GEvent, cal: &CalendarInfo) -> Option<CalEvent> {
    if e.status == "cancelled" || e.event_type.as_deref() == Some("workingLocation") {
        return None;
    }
    let own_attendee = e.attendees.iter().find(|a| a.is_self);
    let is_organizer = e.organizer.as_ref().is_some_and(|o| o.is_self)
        || own_attendee.is_some_and(|a| a.organizer);
    let response_status = own_attendee.map(|a| a.response_status);
    let can_respond = cal.can_edit && !is_organizer
        && own_attendee.is_some_and(|a| a.email.as_ref().is_some_and(|email| !email.is_empty()));
    let editable = cal.can_edit && (is_organizer || e.guests_can_modify || e.organizer.is_none());
    let (s, en) = (e.start?, e.end?);
    let (start, end, all_day) = match (s.date, s.date_time, en.date, en.date_time) {
        (Some(sd), _, Some(ed), _) => (sd, ed, true),
        (_, Some(sdt), _, Some(edt)) => (sdt, edt, false),
        (_, Some(sdt), _, None) => (sdt.clone(), sdt, false),
        _ => return None,
    };
    let reminders = match e.reminders {
        Some(r) if !r.use_default => r.overrides.iter()
            .filter(|x| x.method == "popup").map(|x| x.minutes).collect(),
        _ => cal.default_reminders.clone(),
    };
    Some(CalEvent {
        id: format!("{}:{}:{}", cal.id, e.id, start),
        calendar_id: cal.id.clone(),
        remote_id: e.id,
        editable,
        title: e.summary.unwrap_or_else(|| "（无标题）".into()),
        start,
        end,
        all_day,
        location: e.location.filter(|s| !s.is_empty()),
        description: e.description.filter(|s| !s.is_empty()),
        reminders,
        html_link: e.html_link,
        attendees: e.attendees,
        organizer: e.organizer,
        attendees_omitted: e.attendees_omitted,
        response_status,
        can_respond,
        recurring: e.recurring_event_id.is_some(),
    })
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

// ── writes (scope: calendar.events) ──

fn event_body(input: &crate::model::EventInput) -> serde_json::Value {
    use serde_json::json;
    let when = |s: &str| {
        if input.all_day {
            json!({ "date": s })
        } else {
            json!({ "dateTime": s })
        }
    };
    let reminders = if input.reminders.is_empty() {
        json!({ "useDefault": true })
    } else {
        json!({
            "useDefault": false,
            "overrides": input.reminders.iter().map(|m| json!({ "method": "popup", "minutes": m })).collect::<Vec<_>>()
        })
    };
    json!({
        "summary": input.title.trim(),
        "location": input.location.as_deref().map(str::trim).unwrap_or(""),
        "description": input.description.as_deref().map(str::trim).unwrap_or(""),
        "start": when(&input.start),
        "end": when(&input.end),
        "reminders": reminders,
    })
}

async fn check_write(resp: reqwest::Response, what: &str) -> Result<(), String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let text = resp.text().await.unwrap_or_default();
    log::warn!("google {what} failed ({status}): {text}");
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(format!("没有{what}的权限。请在设置中重新登录 Google 账号，应用会重新请求写入权限。"));
    }
    Err(format!("Google {what}失败（{status}）"))
}

pub async fn respond_event(
    http: &reqwest::Client,
    token: &str,
    cal: &CalendarInfo,
    event_id: &str,
    response_status: ResponseStatus,
) -> Result<CalEvent, String> {
    respond_event_at(http, token, cal, response_status, &format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}",
        urlencode(&cal.remote_id), urlencode(event_id)
    )).await
}

async fn respond_event_at(
    http: &reqwest::Client,
    token: &str,
    cal: &CalendarInfo,
    response_status: ResponseStatus,
    endpoint: &str,
) -> Result<CalEvent, String> {
    if response_status == ResponseStatus::NeedsAction {
        return Err("请选择「接受」「拒绝」或「待定」。".into());
    }
    // Read Google's current copy: never trust a caller-supplied attendee email.
    let resp = http.get(endpoint).bearer_auth(token).send().await.map_err(|e| format!("获取受邀日程失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("获取受邀日程失败（{}）", resp.status()));
    }
    let raw: GEvent = resp.json().await.map_err(|e| format!("无法解析受邀日程：{e}"))?;
    let mut event = to_event(raw, cal).ok_or("此日程已取消或无法回复。")?;
    if !event.can_respond {
        return Err("无法通过此日历回复邀请。".into());
    }
    let attendee = event.attendees.iter_mut().find(|a| a.is_self).unwrap();
    // attendeesOmitted preserves everyone else, including guests hidden by the organizer.
    let body = serde_json::json!({
        "attendeesOmitted": true,
        "attendees": [{ "email": attendee.email, "responseStatus": response_status }]
    });
    let resp = http.patch(endpoint).bearer_auth(token)
        .query(&[("sendUpdates", "all")]).json(&body)
        .send().await.map_err(|e| format!("回复邀请失败：{e}"))?;
    check_write(resp, "回复邀请").await?;
    attendee.response_status = response_status;
    event.response_status = Some(response_status);
    Ok(event)
}

pub async fn create_event(
    http: &reqwest::Client,
    token: &str,
    cal_remote_id: &str,
    input: &crate::model::EventInput,
) -> Result<(), String> {
    let resp = http
        .post(format!(
            "https://www.googleapis.com/calendar/v3/calendars/{}/events",
            urlencode(cal_remote_id)
        ))
        .bearer_auth(token)
        .json(&event_body(input))
        .send()
        .await
        .map_err(|e| format!("新建 Google 日程失败：{e}"))?;
    check_write(resp, "新建日程").await
}

pub async fn update_event(
    http: &reqwest::Client,
    token: &str,
    cal_remote_id: &str,
    event_id: &str,
    input: &crate::model::EventInput,
) -> Result<(), String> {
    let resp = http
        .patch(format!(
            "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}",
            urlencode(cal_remote_id),
            urlencode(event_id)
        ))
        .bearer_auth(token)
        .json(&event_body(input))
        .send()
        .await
        .map_err(|e| format!("修改 Google 日程失败：{e}"))?;
    check_write(resp, "修改日程").await
}

pub async fn delete_event(
    http: &reqwest::Client,
    token: &str,
    cal_remote_id: &str,
    event_id: &str,
) -> Result<(), String> {
    let resp = http
        .delete(format!(
            "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}",
            urlencode(cal_remote_id),
            urlencode(event_id)
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("删除 Google 日程失败：{e}"))?;
    if resp.status() == reqwest::StatusCode::GONE {
        return Ok(());
    }
    check_write(resp, "删除日程").await
}
