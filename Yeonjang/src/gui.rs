use std::env;
use std::fs;
use std::path::Path;
use std::sync::mpsc::Receiver;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Result, anyhow};
use eframe::egui::{
    self, Align, Align2, CentralPanel, Color32, CornerRadius, FontData, FontDefinitions,
    FontFamily, FontId, Frame, Layout, Margin, RichText, ScrollArea, Sense, Stroke, TextEdit,
    TextStyle, TopBottomPanel, Ui,
};

use crate::mqtt::{MqttRuntimeHandle, RuntimeEvent, probe_connection, start_runtime};
use crate::settings::{UiLanguage, YeonjangSettings, load_settings, save_settings};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveTab {
    Connection,
    ExtensionInfo,
    Permissions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConnectionState {
    Disconnected,
    Connected,
    AuthFailed,
}

fn t(lang: UiLanguage, ko: &'static str, en: &'static str) -> &'static str {
    match lang {
        UiLanguage::Ko => ko,
        UiLanguage::En => en,
    }
}

pub fn run_gui() -> Result<()> {
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Yeonjang")
            .with_inner_size([680.0, 800.0])
            .with_min_inner_size([680.0, 800.0])
            .with_max_inner_size([680.0, 800.0])
            .with_resizable(false),
        ..Default::default()
    };

    eframe::run_native(
        "Yeonjang",
        native_options,
        Box::new(|cc| {
            install_platform_fonts(&cc.egui_ctx);
            apply_theme(&cc.egui_ctx);
            Ok(Box::new(YeonjangGuiApp::new()))
        }),
    )
    .map_err(|error| anyhow!(error.to_string()))?;

    Ok(())
}

fn install_platform_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();

    if let Some((font_name, font_bytes)) = load_ui_font() {
        fonts
            .font_data
            .insert(font_name.clone(), FontData::from_owned(font_bytes).into());
        if let Some(proportional) = fonts.families.get_mut(&FontFamily::Proportional) {
            proportional.insert(0, font_name.clone());
        }
        if let Some(monospace) = fonts.families.get_mut(&FontFamily::Monospace) {
            monospace.push(font_name);
        }
        ctx.set_fonts(fonts);
    }
}

fn load_ui_font() -> Option<(String, Vec<u8>)> {
    let candidates = if cfg!(target_os = "macos") {
        vec![
            "/System/Library/Fonts/AppleSDGothicNeo.ttc",
            "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            "C:\\Windows\\Fonts\\malgun.ttf",
            "C:\\Windows\\Fonts\\malgunsl.ttf",
            "C:\\Windows\\Fonts\\arialuni.ttf",
        ]
    } else {
        vec![
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        ]
    };

    for candidate in candidates {
        if let Some(bytes) = read_font_file(candidate) {
            let font_name = Path::new(candidate)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("YeonjangUIFont")
                .to_string();
            return Some((font_name, bytes));
        }
    }

    None
}

fn read_font_file(path: &str) -> Option<Vec<u8>> {
    fs::read(path).ok()
}

fn apply_theme(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::light();
    visuals.panel_fill = color_panel();
    visuals.window_fill = color_panel();
    visuals.extreme_bg_color = color_bg();
    visuals.window_corner_radius = CornerRadius::same(22);
    visuals.menu_corner_radius = CornerRadius::same(16);
    visuals.widgets.noninteractive.bg_fill = color_panel();
    visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0, color_line());
    visuals.widgets.noninteractive.corner_radius = CornerRadius::same(14);
    visuals.widgets.inactive.bg_fill = Color32::WHITE;
    visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, color_line());
    visuals.widgets.inactive.corner_radius = CornerRadius::same(12);
    visuals.widgets.hovered.bg_fill = color_brand_soft();
    visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, color_brand());
    visuals.widgets.hovered.corner_radius = CornerRadius::same(12);
    visuals.widgets.active.bg_fill = color_brand_soft();
    visuals.widgets.active.bg_stroke = Stroke::new(1.0, color_brand());
    visuals.widgets.active.corner_radius = CornerRadius::same(12);
    visuals.widgets.open.corner_radius = CornerRadius::same(12);
    visuals.selection.bg_fill = color_brand();
    visuals.selection.stroke = Stroke::new(1.0, Color32::WHITE);
    visuals.override_text_color = Some(color_text());
    ctx.set_visuals(visuals);

    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = egui::vec2(12.0, 12.0);
    style.spacing.button_padding = egui::vec2(13.0, 9.0);
    style.spacing.interact_size = egui::vec2(42.0, 42.0);
    style.spacing.window_margin = Margin::symmetric(18, 18);
    style
        .text_styles
        .insert(TextStyle::Heading, FontId::proportional(22.0));
    style
        .text_styles
        .insert(TextStyle::Body, FontId::proportional(13.0));
    style
        .text_styles
        .insert(TextStyle::Button, FontId::proportional(13.0));
    style
        .text_styles
        .insert(TextStyle::Small, FontId::proportional(12.0));
    style
        .text_styles
        .insert(TextStyle::Monospace, FontId::monospace(13.0));
    ctx.set_style(style);
}

struct YeonjangGuiApp {
    settings: YeonjangSettings,
    saved_settings: YeonjangSettings,
    port_input: String,
    status_message: String,
    status_color: Color32,
    active_tab: ActiveTab,
    connection_state: ConnectionState,
    connection_attempted: bool,
    last_error: String,
    mqtt_runtime: Option<MqttRuntimeHandle>,
    mqtt_runtime_events: Option<Receiver<RuntimeEvent>>,
}

impl YeonjangGuiApp {
    fn new() -> Self {
        let (settings, status_message, status_color) = match load_settings() {
            Ok(settings) => {
                let lang = settings.ui_language;
                (
                    settings,
                    t(lang, "설정을 불러왔습니다.", "Settings loaded.").to_string(),
                    color_success_text(),
                )
            }
            Err(error) => {
                let settings = YeonjangSettings::default();
                let lang = settings.ui_language;
                (
                    settings,
                    format!(
                        "{}: {error}",
                        t(
                            lang,
                            "설정을 읽지 못해 기본값으로 시작했습니다",
                            "Failed to read settings. Started with defaults"
                        )
                    ),
                    color_warn_text(),
                )
            }
        };
        let ui_language = settings.ui_language;

        let mut app = Self {
            saved_settings: settings.clone(),
            port_input: settings.connection.port.to_string(),
            settings,
            status_message,
            status_color,
            active_tab: ActiveTab::Connection,
            connection_state: ConnectionState::Disconnected,
            connection_attempted: false,
            last_error: t(
                ui_language,
                "아직 연결하지 않았습니다.",
                "Not connected yet.",
            )
            .to_string(),
            mqtt_runtime: None,
            mqtt_runtime_events: None,
        };

        if app.settings.connection.auto_connect {
            app.connect_now();
        }

        app
    }

    fn lang(&self) -> UiLanguage {
        self.settings.ui_language
    }

    fn is_dirty(&self) -> bool {
        self.settings != self.saved_settings
    }

    fn set_status(&mut self, message: impl Into<String>, color: Color32) {
        self.status_message = message.into();
        self.status_color = color;
    }

    fn save(&mut self) {
        match parse_port_input(&self.port_input, self.lang()) {
            Ok(port) => {
                self.settings.connection.port = port;
            }
            Err(message) => {
                self.set_status(message, color_danger_text());
                return;
            }
        }

        match save_settings(&self.settings) {
            Ok(_) => {
                self.saved_settings = self.settings.clone();
                self.port_input = self.settings.connection.port.to_string();
                self.set_status(
                    t(self.lang(), "현재 설정을 저장했습니다.", "Settings saved."),
                    color_success_text(),
                );
            }
            Err(error) => {
                self.set_status(
                    format!(
                        "{}: {error}",
                        t(self.lang(), "설정 저장 실패", "Failed to save settings")
                    ),
                    color_danger_text(),
                );
            }
        }
    }

    fn reload(&mut self) {
        match load_settings() {
            Ok(settings) => {
                self.saved_settings = settings.clone();
                self.port_input = settings.connection.port.to_string();
                self.settings = settings;
                self.set_status(
                    t(
                        self.lang(),
                        "디스크의 설정을 다시 불러왔습니다.",
                        "Reloaded settings from disk.",
                    ),
                    color_success_text(),
                );
            }
            Err(error) => {
                self.set_status(
                    format!(
                        "{}: {error}",
                        t(self.lang(), "설정 다시 불러오기 실패", "Failed to reload settings")
                    ),
                    color_danger_text(),
                );
            }
        }
    }

    fn cancel_changes(&mut self) {
        self.settings = self.saved_settings.clone();
        self.port_input = self.settings.connection.port.to_string();
        self.set_status(
            t(
                self.lang(),
                "저장된 상태로 되돌렸습니다.",
                "Reverted to the saved state.",
            ),
            color_warn_text(),
        );
    }

    fn restore_defaults(&mut self) {
        self.settings = YeonjangSettings::default();
        self.port_input = self.settings.connection.port.to_string();
        self.set_status(
            t(
                self.lang(),
                "기본값으로 되돌렸습니다. 저장 후 적용됩니다.",
                "Restored defaults. Save to apply them.",
            ),
            color_warn_text(),
        );
    }

    fn check_connection(&mut self) {
        match parse_port_input(&self.port_input, self.lang()) {
            Ok(port) => {
                self.settings.connection.port = port;
            }
            Err(message) => {
                self.connection_state = ConnectionState::Disconnected;
                self.last_error = message.to_string();
                self.set_status(message, color_danger_text());
                return;
            }
        }

        if self.settings.connection.host.trim().is_empty() {
            self.connection_state = ConnectionState::Disconnected;
            self.last_error = t(
                self.lang(),
                "연결 주소를 입력해야 합니다.",
                "Connection host is required.",
            )
            .to_string();
            self.set_status(self.last_error.clone(), color_danger_text());
            return;
        }

        if self.settings.connection.username.trim().is_empty() {
            self.connection_state = ConnectionState::AuthFailed;
            self.last_error = t(
                self.lang(),
                "아이디를 입력해야 합니다.",
                "Username is required.",
            )
            .to_string();
            self.set_status(
                t(
                    self.lang(),
                    "인증 실패: 아이디를 확인하세요.",
                    "Authentication failed: check the username.",
                ),
                color_danger_text(),
            );
            return;
        }

        if self.settings.connection.password.trim().is_empty() {
            self.connection_state = ConnectionState::AuthFailed;
            self.last_error = t(
                self.lang(),
                "비밀번호를 입력해야 합니다.",
                "Password is required.",
            )
            .to_string();
            self.set_status(
                t(
                    self.lang(),
                    "인증 실패: 비밀번호를 확인하세요.",
                    "Authentication failed: check the password.",
                ),
                color_danger_text(),
            );
            return;
        }

        match probe_connection(&self.settings) {
            Ok(()) => {
                self.connection_state = ConnectionState::Disconnected;
                self.last_error = t(self.lang(), "없음", "None").to_string();
                self.set_status(
                    t(
                        self.lang(),
                        "브로커 주소에 접근할 수 있습니다.",
                        "The broker address is reachable.",
                    ),
                    color_success_text(),
                );
            }
            Err(error) => {
                self.connection_state = ConnectionState::Disconnected;
                self.last_error = error.to_string();
                self.set_status(
                    format!(
                        "{}: {error}",
                        t(self.lang(), "연결 확인 실패", "Connection check failed")
                    ),
                    color_danger_text(),
                );
            }
        }
    }

    fn connect_now(&mut self) {
        self.connection_attempted = true;
        match parse_port_input(&self.port_input, self.lang()) {
            Ok(port) => self.settings.connection.port = port,
            Err(message) => {
                self.connection_state = ConnectionState::Disconnected;
                self.last_error = message.to_string();
                self.set_status(message, color_danger_text());
                return;
            }
        }

        if self.settings.connection.host.trim().is_empty() {
            self.connection_state = ConnectionState::Disconnected;
            self.last_error = t(self.lang(), "연결 주소를 입력해야 합니다.", "Connection host is required.").to_string();
            self.set_status(self.last_error.clone(), color_danger_text());
            return;
        }

        if self.settings.connection.username.trim().is_empty() || self.settings.connection.password.trim().is_empty() {
            self.connection_state = ConnectionState::AuthFailed;
            self.last_error = t(
                self.lang(),
                "아이디와 비밀번호를 모두 입력해야 합니다.",
                "Both username and password are required.",
            )
            .to_string();
            self.set_status(self.last_error.clone(), color_danger_text());
            return;
        }

        self.stop_runtime();
        match start_runtime(self.settings.clone()) {
            Ok((runtime, events)) => {
                self.mqtt_runtime = Some(runtime);
                self.mqtt_runtime_events = Some(events);
                self.connection_state = ConnectionState::Disconnected;
                self.set_status(
                    t(
                        self.lang(),
                        "Nobie 브로커에 연결하는 중입니다.",
                        "Connecting to the Nobie broker.",
                    ),
                    color_warn_text(),
                );
            }
            Err(error) => {
                self.connection_state = ConnectionState::Disconnected;
                self.last_error = error.to_string();
                self.set_status(
                    format!(
                        "{}: {error}",
                        t(self.lang(), "연결 시작 실패", "Failed to start the connection")
                    ),
                    color_danger_text(),
                );
            }
        }
    }

    fn disconnect(&mut self) {
        self.stop_runtime();
        self.connection_state = ConnectionState::Disconnected;
        self.last_error = t(self.lang(), "연결이 끊어졌습니다.", "Disconnected.")
            .to_string();
        self.set_status(
            t(
                self.lang(),
                "브로커 연결을 종료했습니다.",
                "Broker connection closed.",
            ),
            color_warn_text(),
        );
    }

    fn stop_runtime(&mut self) {
        self.mqtt_runtime_events = None;
        if let Some(runtime) = self.mqtt_runtime.take() {
            let _ = runtime.stop();
        }
    }

    fn process_runtime_events(&mut self) {
        let mut pending = Vec::new();
        if let Some(receiver) = &self.mqtt_runtime_events {
            while let Ok(event) = receiver.try_recv() {
                pending.push(event);
            }
        }

        for event in pending {
            match event {
                RuntimeEvent::Connected => {
                    self.connection_attempted = true;
                    self.connection_state = ConnectionState::Connected;
                    self.last_error = t(self.lang(), "없음", "None").to_string();
                    self.set_status(
                        t(
                            self.lang(),
                            "Nobie 브로커에 연결되었습니다.",
                            "Connected to the Nobie broker.",
                        ),
                        color_success_text(),
                    );
                }
                RuntimeEvent::Disconnected(message) => {
                    self.stop_runtime();
                    self.connection_state = ConnectionState::Disconnected;
                    self.last_error = message.clone();
                    self.set_status(
                        format!(
                            "{}: {message}",
                            t(self.lang(), "브로커 연결이 종료되었습니다", "Broker connection closed")
                        ),
                        color_warn_text(),
                    );
                }
                RuntimeEvent::AuthFailed(message) => {
                    self.stop_runtime();
                    self.connection_state = ConnectionState::AuthFailed;
                    self.last_error = message.clone();
                    self.set_status(
                        format!(
                            "{}: {message}",
                            t(self.lang(), "인증 실패", "Authentication failed")
                        ),
                        color_danger_text(),
                    );
                }
                RuntimeEvent::ResponsePublishFailed { method, message } => {
                    self.last_error = message.clone();
                    self.set_status(
                        format!(
                            "{}: {method} ({message})",
                            t(
                                self.lang(),
                                "응답 전송 실패",
                                "Response publish failed",
                            )
                        ),
                        color_danger_text(),
                    );
                }
                RuntimeEvent::RequestHandled { method, ok } => {
                    let message = if ok {
                        format!(
                            "{}: {method}",
                            t(self.lang(), "명령 처리 완료", "Command handled")
                        )
                    } else {
                        format!(
                            "{}: {method}",
                            t(self.lang(), "명령 처리 실패", "Command failed")
                        )
                    };
                    self.set_status(
                        message,
                        if ok { color_success_text() } else { color_danger_text() },
                    );
                }
            }
        }
    }

    fn regenerate_extension_id(&mut self) {
        let host = detected_host_name();
        let slug = sanitize_token(&host);
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs() % 100_000)
            .unwrap_or(0);
        self.settings.node_id = format!("yeonjang-{slug}-{suffix}");
        self.settings.reset_topics_from_node_id();
        self.set_status(
            t(
                self.lang(),
                "연장 ID를 다시 만들었습니다.",
                "Regenerated the extension ID.",
            ),
            color_success_text(),
        );
    }

    fn global_badge(&self) -> (&'static str, Color32, Color32) {
        match self.connection_state {
            ConnectionState::Disconnected => (
                t(self.lang(), "연결 안 됨", "Offline"),
                color_warn_bg(),
                color_warn_text(),
            ),
            ConnectionState::Connected => (
                t(self.lang(), "연결됨", "Connected"),
                color_success_bg(),
                color_success_text(),
            ),
            ConnectionState::AuthFailed => (
                t(self.lang(), "인증 실패", "Auth Failed"),
                color_danger_bg(),
                color_danger_text(),
            ),
        }
    }

    fn footer_text(&self) -> String {
        if self.is_dirty() {
            return t(
                self.lang(),
                "저장 전 변경 사항이 있습니다.",
                "There are unsaved changes.",
            )
            .to_string();
        }

        match self.active_tab {
            ActiveTab::Connection => match self.connection_state {
                ConnectionState::Connected => t(
                    self.lang(),
                    "Nobie 브로커에 연결되어 있습니다.",
                    "Connected to the Nobie broker.",
                )
                .to_string(),
                ConnectionState::AuthFailed => t(
                    self.lang(),
                    "인증 정보를 다시 확인해 주세요.",
                    "Check the authentication details.",
                )
                .to_string(),
                ConnectionState::Disconnected => t(
                    self.lang(),
                    "브로커 연결을 아직 확인하지 않았습니다.",
                    "Broker connection has not been checked yet.",
                )
                .to_string(),
            },
            ActiveTab::ExtensionInfo => t(
                self.lang(),
                "연장 정보가 준비되었습니다.",
                "Extension information is ready.",
            )
            .to_string(),
            ActiveTab::Permissions => t(
                self.lang(),
                "권한 변경 후 운영체제 확인이 필요할 수 있습니다.",
                "OS approval may be required after changing permissions.",
            )
            .to_string(),
        }
    }

    fn display_last_error(&self) -> String {
        if self.connection_state == ConnectionState::Connected {
            return t(self.lang(), "없음", "None").to_string();
        }

        if self.last_error == "아직 연결하지 않았습니다." || self.last_error == "Not connected yet." {
            return t(self.lang(), "아직 연결하지 않았습니다.", "Not connected yet.").to_string();
        }

        if self.last_error == "연결이 끊어졌습니다." || self.last_error == "Disconnected." {
            return t(self.lang(), "연결이 끊어졌습니다.", "Disconnected.").to_string();
        }

        if self.last_error == "아이디는 있지만 비밀번호가 비어 있습니다."
            || self.last_error == "Username is set but password is empty."
        {
            return t(
                self.lang(),
                "아이디는 있지만 비밀번호가 비어 있습니다.",
                "Username is set but password is empty.",
            )
            .to_string();
        }

        if self.last_error == "아이디와 비밀번호를 모두 입력해야 합니다."
            || self.last_error == "Both username and password are required."
        {
            return t(
                self.lang(),
                "아이디와 비밀번호를 모두 입력해야 합니다.",
                "Both username and password are required.",
            )
            .to_string();
        }

        if self.last_error == "아이디를 입력해야 합니다." || self.last_error == "Username is required." {
            return t(
                self.lang(),
                "아이디를 입력해야 합니다.",
                "Username is required.",
            )
            .to_string();
        }

        if self.last_error == "비밀번호를 입력해야 합니다." || self.last_error == "Password is required." {
            return t(
                self.lang(),
                "비밀번호를 입력해야 합니다.",
                "Password is required.",
            )
            .to_string();
        }

        if self.last_error == "연결 주소를 입력해야 합니다."
            || self.last_error == "Connection host is required."
        {
            return t(
                self.lang(),
                "연결 주소를 입력해야 합니다.",
                "Connection host is required.",
            )
            .to_string();
        }

        self.last_error.clone()
    }

    fn reconnect_button_label(&self) -> &'static str {
        if self.connection_attempted && self.connection_state != ConnectionState::Connected {
            t(self.lang(), "다시 연결", "Reconnect")
        } else {
            t(self.lang(), "지금 연결", "Connect")
        }
    }

    fn permission_counts(&self) -> (usize, usize, usize) {
        let items = [
            self.settings.permissions.allow_system_control,
            self.settings.permissions.allow_shell_exec,
            self.settings.permissions.allow_screen_capture,
            self.settings.permissions.allow_keyboard_control,
            self.settings.permissions.allow_mouse_control,
        ];
        let enabled = items.into_iter().filter(|value| *value).count();
        let disabled = items.len() - enabled;
        let os_required = usize::from(self.settings.permissions.allow_screen_capture)
            + usize::from(self.settings.permissions.allow_keyboard_control);
        (enabled, disabled, os_required)
    }
}

impl eframe::App for YeonjangGuiApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.process_runtime_events();
        apply_theme(ctx);
        let lang = self.lang();

        TopBottomPanel::top("yeonjang_header")
            .frame(
                Frame::new()
                    .fill(Color32::from_rgba_unmultiplied(255, 255, 255, 230))
                    .stroke(Stroke::new(1.0, color_line()))
                    .inner_margin(Margin::symmetric(20, 10)),
            )
            .show(ctx, |ui| {
            ui.horizontal_top(|ui| {
                ui.vertical(|ui| {
                    ui.label(RichText::new("Yeonjang").size(18.0).strong());
                    ui.label(
                        RichText::new(t(lang, "노비 연장", "Nobie Extension"))
                            .size(11.0)
                            .color(color_muted()),
                    );
                });
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    language_switcher(ui, &mut self.settings.ui_language);
                    ui.add_space(8.0);
                    let (label, bg, text) = self.global_badge();
                    badge(ui, label, bg, text);
                });
            });
        });

        TopBottomPanel::top("yeonjang_tabs")
            .frame(
                Frame::new()
                    .fill(Color32::from_rgb(247, 241, 232))
                    .stroke(Stroke::new(1.0, color_line()))
                    .inner_margin(Margin::symmetric(20, 12)),
            )
            .show(ctx, |ui| {
            ui.horizontal(|ui| {
                tab_button(
                    ui,
                    &mut self.active_tab,
                    ActiveTab::Connection,
                    t(lang, "노비 연결", "Connection"),
                    if self.connection_state == ConnectionState::Connected {
                        t(lang, "준비됨", "Ready")
                    } else {
                        t(lang, "문제 있음", "Issue")
                    },
                );
                tab_button(
                    ui,
                    &mut self.active_tab,
                    ActiveTab::ExtensionInfo,
                    t(lang, "연장 정보", "Extension"),
                    t(lang, "준비됨", "Ready"),
                );
                tab_button(
                    ui,
                    &mut self.active_tab,
                    ActiveTab::Permissions,
                    t(lang, "권한", "Permissions"),
                    t(lang, "확인 필요", "Review"),
                );
            });
        });

        TopBottomPanel::bottom("yeonjang_footer")
            .frame(
                Frame::new()
                    .fill(Color32::from_rgba_unmultiplied(250, 247, 242, 240))
                    .stroke(Stroke::new(1.0, color_line()))
                    .inner_margin(Margin::symmetric(16, 10)),
            )
            .show(ctx, |ui| {
            ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
            ui.horizontal(|ui| {
                let status_width = (ui.available_width() - 250.0).max(180.0);
                ui.allocate_ui_with_layout(
                    egui::vec2(status_width, 18.0),
                    Layout::left_to_right(Align::Center),
                    |ui| {
                        ui.add_space(2.0);
                        ui.label(
                            RichText::new(self.footer_text())
                                .size(12.0)
                                .color(color_muted())
                                .strong(),
                        );
                    },
                );

                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if primary_button(ui, t(lang, "저장", "Save")).clicked() {
                        self.save();
                    }
                    if secondary_button(ui, t(lang, "취소", "Cancel")).clicked() {
                        self.cancel_changes();
                    }
                    if text_button(ui, t(lang, "다시 불러오기", "Reload")).clicked() {
                        self.reload();
                    }
                    if text_button(ui, t(lang, "기본값 복원", "Reset")).clicked() {
                        self.restore_defaults();
                    }
                });
            });
        });

        CentralPanel::default()
            .frame(Frame::new().fill(color_panel()).inner_margin(Margin::symmetric(20, 20)))
            .show(ctx, |ui| {
            ScrollArea::vertical().show(ui, |ui| match self.active_tab {
                ActiveTab::Connection => self.draw_connection_tab(ui),
                ActiveTab::ExtensionInfo => self.draw_extension_tab(ui, ctx),
                ActiveTab::Permissions => self.draw_permissions_tab(ui),
            });
        });
    }
}

impl Drop for YeonjangGuiApp {
    fn drop(&mut self) {
        self.stop_runtime();
    }
}

impl YeonjangGuiApp {
    fn draw_connection_tab(&mut self, ui: &mut Ui) {
        let lang = self.lang();
        section_header(
            ui,
            t(lang, "노비 연결", "Connection"),
            t(
                lang,
                "브로커 주소와 인증 정보만 입력합니다.",
                "Enter only the broker address and credentials.",
            ),
        );

        connection_status_card(
            ui,
            t(lang, "현재 상태", "Current Status"),
            &[
                (
                    t(lang, "상태", "Status"),
                    match self.connection_state {
                        ConnectionState::Disconnected => t(lang, "연결되지 않음", "Disconnected").to_string(),
                        ConnectionState::Connected => t(lang, "연결됨", "Connected").to_string(),
                        ConnectionState::AuthFailed => t(lang, "인증 실패", "Auth Failed").to_string(),
                    },
                ),
                (t(lang, "마지막 오류", "Last Error"), self.display_last_error()),
            ],
        );

        ui.add_space(4.0);

        card(ui, t(lang, "브로커 정보", "Broker"), |ui| {
            ui.columns(2, |columns| {
                form_field(&mut columns[0], t(lang, "연결 주소 (Host) *", "Host *"), None, |ui| {
                    singleline_input(ui, &mut self.settings.connection.host);
                });

                let port_error = parse_port_input(&self.port_input, lang).err();
                form_field(&mut columns[1], t(lang, "포트 (Port) *", "Port *"), port_error, |ui| {
                    singleline_input(ui, &mut self.port_input);
                });
            });

            ui.add_space(10.0);

            ui.columns(2, |columns| {
                form_field(&mut columns[0], t(lang, "아이디 (ID)", "ID"), None, |ui| {
                    singleline_input(ui, &mut self.settings.connection.username);
                });

                let password_error = if !self.settings.connection.username.trim().is_empty()
                    && self.settings.connection.password.trim().is_empty()
                {
                    Some(t(lang, "인증 실패: 비밀번호를 다시 확인하세요.", "Authentication failed: check the password."))
                } else {
                    None
                };
                form_field(&mut columns[1], t(lang, "비밀번호 (Password)", "Password"), password_error, |ui| {
                    password_input(ui, &mut self.settings.connection.password);
                });
            });
        });

        ui.add_space(4.0);

        card(ui, t(lang, "자동 동작", "Automation"), |ui| {
            toggle_row(
                ui,
                &mut self.settings.connection.auto_connect,
                t(lang, "자동 접속", "Auto Connect"),
                t(lang, "실행 후 바로 연결", "Connect after launch"),
            );
            ui.separator();
            toggle_row(
                ui,
                &mut self.settings.connection.launch_on_system_start,
                t(lang, "시스템 시작 시 실행", "Launch on Startup"),
                t(lang, "컴퓨터 시작 시 자동 실행", "Run when the system starts"),
            );
        });

        ui.add_space(4.0);
        ui.horizontal_wrapped(|ui| {
            if secondary_button(ui, t(lang, "연결 확인", "Check")).clicked() {
                self.check_connection();
            }
            if primary_button(ui, self.reconnect_button_label()).clicked() {
                self.connect_now();
            }
            ui.add_enabled_ui(self.connection_state == ConnectionState::Connected, |ui| {
                if danger_button(ui, t(lang, "연결 끊기", "Disconnect")).clicked() {
                    self.disconnect();
                }
            });
        });

        ui.add_space(8.0);
        match self.connection_state {
            ConnectionState::AuthFailed => {
                alert_box(
                    ui,
                    t(lang, "연결 실패", "Connection Failed"),
                    t(lang, "아이디 또는 비밀번호를 다시 확인하세요.", "Check the ID or password."),
                    color_danger_bg(),
                    color_danger_text(),
                );
            }
            ConnectionState::Connected => {
                alert_box(
                    ui,
                    t(lang, "연결 성공", "Connection Ready"),
                    t(lang, "Nobie 브로커와의 연결이 준비되었습니다.", "The Nobie broker connection is ready."),
                    color_success_bg(),
                    color_success_text(),
                );
            }
            ConnectionState::Disconnected => {
                if self.is_dirty() {
                    alert_box(
                        ui,
                        t(lang, "저장 전 변경", "Unsaved Changes"),
                        t(lang, "설정을 저장하거나 연결 확인으로 입력값을 검사하세요.", "Save or run a connection check to validate the inputs."),
                        color_warn_bg(),
                        color_warn_text(),
                    );
                } else if self.connection_attempted {
                    alert_box(
                        ui,
                        t(lang, "연결이 끊어졌습니다", "Connection Lost"),
                        t(lang, "다시 연결 버튼으로 브로커 재접속을 시도할 수 있습니다.", "You can try reconnecting to the broker with the reconnect button."),
                        color_warn_bg(),
                        color_warn_text(),
                    );
                }
            }
        }
    }

    fn draw_extension_tab(&mut self, ui: &mut Ui, ctx: &egui::Context) {
        let lang = self.lang();
        section_header(
            ui,
            t(lang, "연장 정보", "Extension"),
            t(lang, "자동으로 감지된 정보입니다.", "Detected automatically."),
        );

        let host_name = detected_host_name();
        let platform = format!("{} {}", current_platform_name(), current_platform_version_hint());

        summary_grid(ui, &[
            (t(lang, "연장 ID", "Extension ID"), self.settings.node_id.clone()),
            (t(lang, "표시 이름", "Display Name"), self.settings.display_name.clone()),
            (t(lang, "플랫폼", "Platform"), current_platform_name().to_string()),
            (t(lang, "상태", "Status"), t(lang, "자동 생성 · 준비됨", "Auto Generated · Ready").to_string()),
        ]);

        ui.add_space(8.0);

        compact_card(ui, t(lang, "세부 정보", "Details"), |ui| {
            ui.spacing_mut().item_spacing = egui::vec2(5.0, 2.0);
            info_row(ui, t(lang, "연장 ID", "Extension ID"), |ui| {
                let row_width = ui.available_width();
                ui.allocate_ui_with_layout(
                    egui::vec2(row_width, 24.0),
                    Layout::left_to_right(Align::Center),
                    |ui| {
                        ui.label(truncate_middle(&self.settings.node_id, 28));
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if compact_copy_button(ui, t(lang, "복사", "Copy")).clicked() {
                                ctx.copy_text(self.settings.node_id.clone());
                                self.set_status(
                                    t(lang, "연장 ID를 복사했습니다.", "Copied the extension ID."),
                                    color_success_text(),
                                );
                            }
                        });
                    },
                );
            });

            ui.separator();
            ui.label(RichText::new(t(lang, "표시 이름", "Display Name")).size(11.5).strong());
            compact_singleline_input(ui, &mut self.settings.display_name);

            ui.separator();
            info_row(ui, t(lang, "운영체제", "Operating System"), |ui| {
                ui.label(platform);
            });
            ui.separator();
            info_row(ui, t(lang, "호스트 이름", "Host Name"), |ui| {
                ui.label(host_name);
            });
            ui.separator();
            info_row(ui, t(lang, "앱 버전", "App Version"), |ui| {
                ui.label(env!("CARGO_PKG_VERSION"));
            });

            ui.add_space(2.0);
            ui.horizontal_top(|ui| {
                if compact_secondary_button(ui, t(lang, "다시 감지", "Refresh")).clicked() {
                    self.set_status(
                        t(lang, "자동 감지 정보를 다시 읽었습니다.", "Refreshed detected information."),
                        color_success_text(),
                    );
                }
                if compact_linkish_button(ui, t(lang, "연장 ID 다시 생성", "Regenerate ID")).clicked() {
                    self.regenerate_extension_id();
                }
            });
        });
    }

    fn draw_permissions_tab(&mut self, ui: &mut Ui) {
        let lang = self.lang();
        section_header(
            ui,
            t(lang, "권한", "Permissions"),
            t(lang, "필요한 항목만 켜서 사용합니다.", "Enable only what you need."),
        );

        let (enabled, disabled, os_required) = self.permission_counts();
        compact_status_card(
            ui,
            t(lang, "권한 상태", "Permission Status"),
            &[
                (t(lang, "허용됨", "Enabled"), enabled),
                (t(lang, "꺼짐", "Off"), disabled),
                (t(lang, "OS 승인 필요", "OS Approval"), os_required),
            ],
        );

        ui.add_space(2.0);

        permission_card(
            ui,
            lang,
            &mut self.settings.permissions.allow_system_control,
            t(lang, "시스템 제어", "System Control"),
            t(lang, "상태 확인과 기본 제어", "Status and basic control"),
            PermissionState::Allowed,
        );
        permission_card(
            ui,
            lang,
            &mut self.settings.permissions.allow_shell_exec,
            t(lang, "명령 실행", "Command Execution"),
            t(lang, "터미널 명령 실행", "Run terminal commands"),
            PermissionState::Toggle,
        );
        permission_card(
            ui,
            lang,
            &mut self.settings.permissions.allow_screen_capture,
            t(lang, "화면 캡처", "Screen Capture"),
            t(lang, "화면을 캡처해 전달", "Capture and send the screen"),
            PermissionState::RequiresOsApproval,
        );
        permission_card(
            ui,
            lang,
            &mut self.settings.permissions.allow_keyboard_control,
            t(lang, "키보드 제어", "Keyboard Control"),
            t(lang, "입력과 단축키 실행", "Typing and shortcuts"),
            PermissionState::RequiresOsApproval,
        );
        permission_card(
            ui,
            lang,
            &mut self.settings.permissions.allow_mouse_control,
            t(lang, "마우스 제어", "Mouse Control"),
            t(lang, "이동과 클릭", "Move and click"),
            PermissionState::Toggle,
        );

        ui.add_space(8.0);
        compact_warn_box(
            ui,
            t(lang, "확인 필요", "Needs Attention"),
            t(lang, "일부 권한은 운영체제 승인 후에 동작합니다.", "Some permissions work only after OS approval."),
        );
    }
}

#[derive(Debug, Clone, Copy)]
enum PermissionState {
    Allowed,
    Toggle,
    RequiresOsApproval,
}

fn current_platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        "Unknown"
    }
}

fn current_platform_version_hint() -> &'static str {
    if cfg!(target_os = "macos") {
        "15"
    } else {
        ""
    }
}

fn detected_host_name() -> String {
    env::var("HOSTNAME")
        .or_else(|_| env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "local-host".to_string())
}

fn sanitize_token(value: &str) -> String {
    let mut result = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
        } else if !result.ends_with('-') {
            result.push('-');
        }
    }
    let trimmed = result.trim_matches('-');
    if trimmed.is_empty() {
        "extension".to_string()
    } else {
        trimmed.to_string()
    }
}

fn truncate_middle(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let head: String = value.chars().take(max / 2 - 1).collect();
    let tail: String = value
        .chars()
        .rev()
        .take(max / 2 - 2)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!("{head}…{tail}")
}

fn section_header(ui: &mut Ui, title: &str, description: &str) {
    ui.heading(RichText::new(title).size(22.0).strong());
    ui.label(RichText::new(description).size(13.0).color(color_muted()));
    ui.add_space(8.0);
}

fn card(ui: &mut Ui, title: &str, add_contents: impl FnOnce(&mut Ui)) {
    let width = ui.available_width();
    Frame::new()
        .fill(Color32::WHITE)
        .stroke(Stroke::new(1.0, color_line()))
        .corner_radius(CornerRadius::same(14))
        .inner_margin(Margin::same(16))
        .show(ui, |ui| {
            let target_width = (width - 32.0).max(0.0);
            ui.set_min_width(target_width);
            ui.set_max_width(target_width);
            ui.label(RichText::new(title).size(14.0).strong());
            ui.add_space(6.0);
            add_contents(ui);
        });
}

fn compact_card(ui: &mut Ui, title: &str, add_contents: impl FnOnce(&mut Ui)) {
    let width = ui.available_width();
    Frame::new()
        .fill(Color32::WHITE)
        .stroke(Stroke::new(1.0, color_line()))
        .corner_radius(CornerRadius::same(14))
        .inner_margin(Margin::symmetric(12, 8))
        .show(ui, |ui| {
            let target_width = (width - 24.0).max(0.0);
            ui.set_min_width(target_width);
            ui.set_max_width(target_width);
            ui.label(RichText::new(title).size(12.5).strong());
            ui.add_space(2.0);
            add_contents(ui);
        });
}

fn summary_grid(ui: &mut Ui, items: &[(&str, String)]) {
    let gap = 12.0;
    let card_width = ((ui.available_width() - gap) / 2.0).max(0.0);
    egui::Grid::new("summary_grid")
        .num_columns(2)
        .spacing([gap, 10.0])
        .show(ui, |ui| {
            for (index, (label, value)) in items.iter().enumerate() {
                ui.allocate_ui_with_layout(
                    egui::vec2(card_width, 54.0),
                    Layout::top_down(Align::Min),
                    |ui| {
                        Frame::new()
                            .fill(Color32::from_rgb(255, 253, 250))
                            .stroke(Stroke::new(1.0, color_line()))
                            .corner_radius(CornerRadius::same(12))
                            .inner_margin(Margin::symmetric(12, 10))
                            .show(ui, |ui| {
                                let inner_width = (card_width - 24.0).max(0.0);
                                ui.set_min_width(inner_width);
                                ui.set_max_width(inner_width);
                                ui.set_min_height(54.0);
                                ui.vertical(|ui| {
                                    ui.label(RichText::new(*label).size(10.5).color(color_muted()));
                                    ui.add_space(3.0);
                                    ui.label(RichText::new(value).size(12.5).strong());
                                });
                            });
                    },
                );
                if index % 2 == 1 {
                    ui.end_row();
                }
            }
        });
}

fn info_row(ui: &mut Ui, key: &str, add_value: impl FnOnce(&mut Ui)) {
    ui.horizontal(|ui| {
        ui.add_sized(
            [78.0, 16.0],
            egui::Label::new(RichText::new(key).size(12.0).color(color_muted())),
        );
        add_value(ui);
    });
}

fn field_label(ui: &mut Ui, text: &str) {
    ui.label(RichText::new(text).size(13.0).strong());
}

fn connection_status_card(ui: &mut Ui, title: &str, rows: &[(&str, String)]) {
    let width = ui.available_width();
    Frame::new()
        .fill(Color32::WHITE)
        .stroke(Stroke::new(1.0, color_line()))
        .corner_radius(CornerRadius::same(14))
        .inner_margin(Margin::symmetric(14, 5))
        .show(ui, |ui| {
            let target_width = (width - 28.0).max(0.0);
            ui.set_min_width(target_width);
            ui.set_max_width(target_width);
            ui.label(RichText::new(title).size(12.5).strong());
            ui.add_space(2.0);
            for (index, (label, value)) in rows.iter().enumerate() {
                ui.horizontal(|ui| {
                    ui.add_sized(
                        [70.0, 12.0],
                        egui::Label::new(RichText::new(*label).size(11.5).color(color_muted())),
                    );
                    ui.label(RichText::new(value).size(11.5));
                });
                if index + 1 < rows.len() {
                    ui.add_space(1.0);
                }
            }
        });
}

fn form_field(
    ui: &mut Ui,
    label: &str,
    error: Option<&str>,
    add_input: impl FnOnce(&mut Ui),
) {
    ui.vertical(|ui| {
        field_label(ui, label);
        ui.add_space(6.0);
        add_input(ui);
        if let Some(message) = error {
            ui.add_space(6.0);
            ui.label(RichText::new(message).size(12.0).color(color_danger_text()));
        }
    });
}

fn toggle_row(ui: &mut Ui, value: &mut bool, title: &str, description: &str) {
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.label(RichText::new(title).size(14.0).strong());
            ui.label(RichText::new(description).size(12.0).color(color_muted()));
        });
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            toggle_switch(ui, value);
        });
    });
}

fn permission_card(
    ui: &mut Ui,
    lang: UiLanguage,
    enabled: &mut bool,
    title: &str,
    description: &str,
    state_mode: PermissionState,
) {
    let width = ui.available_width();
    ui.scope(|ui| {
        ui.set_min_width(width);
        ui.set_max_width(width);
        Frame::new()
            .fill(Color32::WHITE)
            .stroke(Stroke::new(1.0, color_line()))
            .corner_radius(CornerRadius::same(14))
            .inner_margin(Margin::symmetric(14, 10))
            .show(ui, |ui| {
                let target_width = (width - 28.0).max(0.0);
                ui.set_min_width(target_width);
                ui.set_max_width(target_width);
                ui.set_min_height(56.0);
                ui.spacing_mut().item_spacing = egui::vec2(6.0, 3.0);
                ui.horizontal_top(|ui| {
                    ui.vertical(|ui| {
                        ui.horizontal_wrapped(|ui| {
                            ui.label(RichText::new(title).size(15.0).strong());
                            ui.label(RichText::new(description).size(12.0).color(color_muted()));
                        });
                        ui.add_space(3.0);
                        match state_mode {
                            PermissionState::Allowed => {
                                compact_badge(
                                    ui,
                                    t(lang, "허용됨", "Enabled"),
                                    color_success_bg(),
                                    color_success_text(),
                                );
                            }
                            PermissionState::Toggle => {
                                if *enabled {
                                    compact_badge(
                                        ui,
                                        t(lang, "허용됨", "Enabled"),
                                        color_success_bg(),
                                        color_success_text(),
                                    );
                                } else {
                                    compact_badge(
                                        ui,
                                        t(lang, "꺼짐", "Off"),
                                        color_disabled_bg(),
                                        color_disabled_text(),
                                    );
                                }
                            }
                            PermissionState::RequiresOsApproval => {
                                if *enabled {
                                    compact_badge(
                                        ui,
                                        t(lang, "OS 승인 필요", "OS Approval"),
                                        color_warn_bg(),
                                        color_warn_text(),
                                    );
                                } else {
                                    compact_badge(
                                        ui,
                                        t(lang, "꺼짐", "Off"),
                                        color_disabled_bg(),
                                        color_disabled_text(),
                                    );
                                }
                            }
                        }
                    });
                    ui.with_layout(Layout::right_to_left(Align::TOP), |ui| {
                        toggle_switch(ui, enabled);
                    });
                });
            });
    });
    ui.add_space(0.0);
}

fn alert_box(ui: &mut Ui, title: &str, body: &str, bg: Color32, text: Color32) {
    Frame::new()
        .fill(bg)
        .stroke(Stroke::new(1.0, text.gamma_multiply(0.35)))
        .corner_radius(CornerRadius::same(13))
        .inner_margin(Margin::symmetric(14, 12))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new("!")
                        .size(14.0)
                        .strong()
                        .color(text),
                );
                ui.vertical(|ui| {
                    ui.label(RichText::new(title).size(13.0).strong().color(text));
                    ui.label(RichText::new(body).size(13.0).color(text));
                });
            });
        });
}

fn compact_warn_box(ui: &mut Ui, title: &str, body: &str) {
    let width = ui.available_width();
    ui.scope(|ui| {
        ui.set_min_width(width);
        ui.set_max_width(width);
        Frame::new()
            .fill(color_warn_bg())
            .stroke(Stroke::new(1.0, Color32::from_rgb(239, 217, 170)))
            .corner_radius(CornerRadius::same(13))
            .inner_margin(Margin::symmetric(12, 8))
            .show(ui, |ui| {
                let target_width = (width - 28.0).max(0.0);
                ui.set_min_width(target_width);
                ui.set_max_width(target_width);
                ui.spacing_mut().item_spacing = egui::vec2(8.0, 4.0);
                ui.horizontal_top(|ui| {
                    ui.label(
                        RichText::new("!")
                            .size(13.0)
                            .strong()
                            .color(color_warn_text()),
                    );
                    ui.vertical(|ui| {
                        ui.label(
                            RichText::new(title)
                                .size(12.0)
                                .strong()
                                .color(color_warn_text()),
                        );
                        ui.label(
                            RichText::new(body)
                                .size(12.0)
                                .color(color_warn_text()),
                        );
                    });
                });
            });
    });
}

fn tab_button(
    ui: &mut Ui,
    active_tab: &mut ActiveTab,
    tab: ActiveTab,
    title: &str,
    subtitle: &str,
) {
    let selected = *active_tab == tab;
    let (rect, response) = ui.allocate_exact_size(egui::vec2(94.0, 44.0), Sense::click());
    let fill = if selected {
        color_brand_soft()
    } else if response.hovered() {
        Color32::from_rgb(242, 232, 220)
    } else {
        Color32::TRANSPARENT
    };
    let stroke = Stroke::new(
        1.0,
        if selected {
            color_brand()
        } else {
            Color32::TRANSPARENT
        },
    );

    ui.painter().rect(
        rect,
        CornerRadius::same(12),
        fill,
        stroke,
        egui::StrokeKind::Middle,
    );
    ui.painter().text(
        rect.left_top() + egui::vec2(11.0, 7.0),
        Align2::LEFT_TOP,
        title,
        FontId::proportional(14.0),
        color_text(),
    );
    ui.painter().text(
        rect.left_top() + egui::vec2(11.0, 24.0),
        Align2::LEFT_TOP,
        subtitle,
        FontId::proportional(11.0),
        color_muted(),
    );

    if response.clicked() {
        *active_tab = tab;
    }
}

fn badge(ui: &mut Ui, label: &str, bg: Color32, text: Color32) {
    ui.add_sized(
        [74.0, 28.0],
        egui::Button::new(RichText::new(label).size(11.0).strong().color(text))
            .fill(bg)
            .corner_radius(CornerRadius::same(14))
            .stroke(Stroke::new(1.0, text.gamma_multiply(0.25))),
    );
}

fn language_switcher(ui: &mut Ui, language: &mut UiLanguage) {
    ui.spacing_mut().item_spacing = egui::vec2(6.0, 0.0);
    for (candidate, label) in [(UiLanguage::Ko, "한글"), (UiLanguage::En, "English")] {
        let selected = *language == candidate;
        let fill = if selected {
            color_brand_soft()
        } else {
            Color32::WHITE
        };
        let stroke = if selected {
            Stroke::new(1.0, color_brand())
        } else {
            Stroke::new(1.0, color_line())
        };
        if ui
            .add_sized(
                [64.0, 28.0],
                egui::Button::new(
                    RichText::new(label)
                        .size(11.0)
                        .strong()
                        .color(if selected {
                            color_brand_deep()
                        } else {
                            color_muted()
                        }),
                )
                .fill(fill)
                .corner_radius(CornerRadius::same(10))
                .stroke(stroke),
            )
            .clicked()
        {
            *language = candidate;
        }
    }
}

fn compact_badge(ui: &mut Ui, label: &str, bg: Color32, text: Color32) {
    Frame::new()
        .fill(bg)
        .stroke(Stroke::new(1.0, text.gamma_multiply(0.25)))
        .corner_radius(CornerRadius::same(30))
        .inner_margin(Margin::symmetric(8, 2))
        .show(ui, |ui| {
            ui.label(RichText::new(label).size(11.0).strong().color(text));
        });
}

fn text_button(ui: &mut Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(RichText::new(label).size(12.0).strong().color(color_brand_deep()))
            .min_size(egui::vec2(0.0, 26.0))
            .fill(Color32::TRANSPARENT)
            .corner_radius(CornerRadius::same(10))
            .stroke(Stroke::NONE),
    )
}

fn secondary_button(ui: &mut Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(RichText::new(label).size(12.0).strong())
            .min_size(egui::vec2(60.0, 32.0))
            .fill(Color32::WHITE)
            .corner_radius(CornerRadius::same(11))
            .stroke(Stroke::new(1.0, color_line())),
    )
}

fn compact_secondary_button(ui: &mut Ui, label: &str) -> egui::Response {
    ui.add_sized(
        [56.0, 28.0],
        egui::Button::new(RichText::new(label).size(11.5).strong())
            .fill(Color32::WHITE)
            .corner_radius(CornerRadius::same(10))
            .stroke(Stroke::new(1.0, color_line())),
    )
}

fn compact_linkish_button(ui: &mut Ui, label: &str) -> egui::Response {
    ui.add_sized(
        [116.0, 28.0],
        egui::Button::new(RichText::new(label).size(11.5).strong().color(color_brand_deep()))
            .fill(Color32::from_rgb(248, 242, 235))
            .corner_radius(CornerRadius::same(10))
            .stroke(Stroke::new(1.0, Color32::from_rgb(231, 216, 199))),
    )
}

fn compact_copy_button(ui: &mut Ui, label: &str) -> egui::Response {
    ui.add_sized(
        [36.0, 22.0],
        egui::Button::new(RichText::new(label).size(11.0).strong())
            .fill(Color32::WHITE)
            .corner_radius(CornerRadius::same(9))
            .stroke(Stroke::new(1.0, color_line())),
    )
}

fn primary_button(ui: &mut Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(RichText::new(label).size(12.0).strong().color(Color32::WHITE))
            .min_size(egui::vec2(64.0, 32.0))
            .fill(color_brand())
            .corner_radius(CornerRadius::same(11))
            .stroke(Stroke::new(1.0, color_brand())),
    )
}

fn danger_button(ui: &mut Ui, label: &str) -> egui::Response {
    ui.add_sized(
        [92.0, 38.0],
        egui::Button::new(RichText::new(label).size(13.0).strong().color(color_danger_text()))
            .fill(Color32::from_rgb(255, 247, 247))
            .corner_radius(CornerRadius::same(11))
            .stroke(Stroke::new(1.0, Color32::from_rgb(237, 200, 200))),
    )
}

fn singleline_input(ui: &mut Ui, value: &mut String) -> egui::Response {
    ui.scope(|ui| {
        let visuals = ui.visuals_mut();
        visuals.widgets.inactive.bg_fill = Color32::from_rgb(244, 238, 230);
        visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, Color32::from_rgb(220, 207, 192));
        visuals.widgets.hovered.bg_fill = Color32::from_rgb(248, 242, 234);
        visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, color_brand());
        visuals.widgets.active.bg_fill = Color32::from_rgb(248, 242, 234);
        visuals.widgets.active.bg_stroke = Stroke::new(1.0, color_brand());
        ui.add_sized(
            [ui.available_width(), 40.0],
            TextEdit::singleline(value)
                .vertical_align(Align::Center)
                .desired_width(f32::INFINITY),
        )
    })
    .inner
}

fn compact_singleline_input(ui: &mut Ui, value: &mut String) -> egui::Response {
    ui.scope(|ui| {
        let visuals = ui.visuals_mut();
        visuals.widgets.inactive.bg_fill = Color32::from_rgb(244, 238, 230);
        visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, Color32::from_rgb(220, 207, 192));
        visuals.widgets.hovered.bg_fill = Color32::from_rgb(248, 242, 234);
        visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, color_brand());
        visuals.widgets.active.bg_fill = Color32::from_rgb(248, 242, 234);
        visuals.widgets.active.bg_stroke = Stroke::new(1.0, color_brand());
        ui.add_sized(
            [ui.available_width(), 30.0],
            TextEdit::singleline(value)
                .vertical_align(Align::Center)
                .desired_width(f32::INFINITY),
        )
    })
    .inner
}

fn password_input(ui: &mut Ui, value: &mut String) -> egui::Response {
    ui.scope(|ui| {
        let visuals = ui.visuals_mut();
        visuals.widgets.inactive.bg_fill = Color32::from_rgb(244, 238, 230);
        visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, Color32::from_rgb(220, 207, 192));
        visuals.widgets.hovered.bg_fill = Color32::from_rgb(248, 242, 234);
        visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, color_brand());
        visuals.widgets.active.bg_fill = Color32::from_rgb(248, 242, 234);
        visuals.widgets.active.bg_stroke = Stroke::new(1.0, color_brand());
        ui.add_sized(
            [ui.available_width(), 40.0],
            TextEdit::singleline(value)
                .password(true)
                .vertical_align(Align::Center)
                .desired_width(f32::INFINITY),
        )
    })
    .inner
}

fn toggle_switch(ui: &mut Ui, value: &mut bool) -> egui::Response {
    let desired_size = egui::vec2(42.0, 26.0);
    let (rect, mut response) = ui.allocate_exact_size(desired_size, Sense::click());
    if response.clicked() {
        *value = !*value;
        response.mark_changed();
    }

    let bg = if *value {
        color_brand()
    } else {
        Color32::from_rgb(220, 210, 200)
    };
    let knob_x = if *value {
        rect.right() - 14.0
    } else {
        rect.left() + 14.0
    };

    ui.painter().rect_filled(rect, CornerRadius::same(13), bg);
    ui.painter()
        .circle_filled(egui::pos2(knob_x, rect.center().y), 9.0, Color32::WHITE);

    response
}

fn compact_status_card(ui: &mut Ui, title: &str, items: &[(&str, usize)]) {
    let width = ui.available_width();
    ui.scope(|ui| {
        ui.set_min_width(width);
        ui.set_max_width(width);
        Frame::new()
            .fill(Color32::WHITE)
            .stroke(Stroke::new(1.0, color_line()))
            .corner_radius(CornerRadius::same(14))
            .inner_margin(Margin::symmetric(14, 8))
            .show(ui, |ui| {
                let target_width = (width - 28.0).max(0.0);
                ui.set_min_width(target_width);
                ui.set_max_width(target_width);
                ui.label(RichText::new(title).size(14.0).strong());
                ui.add_space(5.0);
                ui.columns(items.len(), |columns| {
                    for (column, (label, value)) in columns.iter_mut().zip(items.iter()) {
                        column.vertical(|ui| {
                            ui.label(RichText::new(*label).size(11.0).color(color_muted()));
                            ui.add_space(1.0);
                            ui.label(RichText::new(value.to_string()).size(15.0).strong());
                        });
                    }
                });
            });
    });
}

fn parse_port_input(value: &str, lang: UiLanguage) -> std::result::Result<u16, &'static str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(t(
            lang,
            "포트는 1~65535 사이여야 합니다.",
            "Port must be between 1 and 65535.",
        ));
    }

    let parsed = trimmed
        .parse::<u16>()
        .map_err(|_| {
            t(
                lang,
                "포트는 1~65535 사이여야 합니다.",
                "Port must be between 1 and 65535.",
            )
        })?;

    if parsed == 0 {
        return Err(t(
            lang,
            "포트는 1~65535 사이여야 합니다.",
            "Port must be between 1 and 65535.",
        ));
    }

    Ok(parsed)
}

fn color_bg() -> Color32 {
    Color32::from_rgb(244, 238, 230)
}

fn color_panel() -> Color32 {
    Color32::from_rgb(251, 248, 244)
}

fn color_line() -> Color32 {
    Color32::from_rgb(229, 219, 207)
}

fn color_text() -> Color32 {
    Color32::from_rgb(47, 42, 38)
}

fn color_muted() -> Color32 {
    Color32::from_rgb(125, 115, 107)
}

fn color_brand() -> Color32 {
    Color32::from_rgb(184, 140, 90)
}

fn color_brand_soft() -> Color32 {
    Color32::from_rgb(242, 229, 213)
}

fn color_brand_deep() -> Color32 {
    Color32::from_rgb(109, 76, 45)
}

fn color_success_bg() -> Color32 {
    Color32::from_rgb(233, 246, 238)
}

fn color_success_text() -> Color32 {
    Color32::from_rgb(31, 122, 68)
}

fn color_warn_bg() -> Color32 {
    Color32::from_rgb(255, 244, 221)
}

fn color_warn_text() -> Color32 {
    Color32::from_rgb(154, 104, 4)
}

fn color_danger_bg() -> Color32 {
    Color32::from_rgb(253, 234, 234)
}

fn color_danger_text() -> Color32 {
    Color32::from_rgb(177, 58, 58)
}

fn color_disabled_bg() -> Color32 {
    Color32::from_rgb(240, 236, 231)
}

fn color_disabled_text() -> Color32 {
    Color32::from_rgb(139, 131, 124)
}
