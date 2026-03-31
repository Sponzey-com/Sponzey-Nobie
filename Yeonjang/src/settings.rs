use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum UiLanguage {
    #[default]
    Ko,
    En,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct YeonjangSettings {
    pub ui_language: UiLanguage,
    pub node_id: String,
    pub display_name: String,
    pub connection: BrokerConnectionSettings,
    pub mqtt: MqttTopicSettings,
    pub permissions: PermissionSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct BrokerConnectionSettings {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub auto_connect: bool,
    pub launch_on_system_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct MqttTopicSettings {
    pub status_topic: String,
    pub capabilities_topic: String,
    pub request_topic: String,
    pub response_topic: String,
    pub event_topic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct PermissionSettings {
    pub allow_system_control: bool,
    pub allow_shell_exec: bool,
    pub allow_screen_capture: bool,
    pub allow_keyboard_control: bool,
    pub allow_mouse_control: bool,
}

impl Default for YeonjangSettings {
    fn default() -> Self {
        let node_id = "yeonjang-main".to_string();
        let mut settings = Self {
            ui_language: UiLanguage::Ko,
            node_id,
            display_name: "Yeonjang".to_string(),
            connection: BrokerConnectionSettings::default(),
            mqtt: MqttTopicSettings::default(),
            permissions: PermissionSettings::default(),
        };
        settings.reset_topics_from_node_id();
        settings
    }
}

impl Default for BrokerConnectionSettings {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 1883,
            username: String::new(),
            password: String::new(),
            auto_connect: true,
            launch_on_system_start: false,
        }
    }
}

impl Default for MqttTopicSettings {
    fn default() -> Self {
        Self {
            status_topic: String::new(),
            capabilities_topic: String::new(),
            request_topic: String::new(),
            response_topic: String::new(),
            event_topic: String::new(),
        }
    }
}

impl Default for PermissionSettings {
    fn default() -> Self {
        Self {
            allow_system_control: true,
            allow_shell_exec: true,
            allow_screen_capture: true,
            allow_keyboard_control: true,
            allow_mouse_control: true,
        }
    }
}

impl YeonjangSettings {
    pub fn reset_topics_from_node_id(&mut self) {
        let prefix = format!("nobie/v1/node/{}", self.node_id.trim());
        self.mqtt.status_topic = format!("{prefix}/status");
        self.mqtt.capabilities_topic = format!("{prefix}/capabilities");
        self.mqtt.request_topic = format!("{prefix}/request");
        self.mqtt.response_topic = format!("{prefix}/response");
        self.mqtt.event_topic = format!("{prefix}/event");
    }
}

pub fn settings_path() -> PathBuf {
    if let Some(project_dirs) = ProjectDirs::from("com", "Sponzey", "Nobie") {
        return project_dirs.config_dir().join("yeonjang").join("settings.json");
    }

    PathBuf::from("Yeonjang").join("settings.json")
}

pub fn load_settings() -> Result<YeonjangSettings> {
    let path = settings_path();
    if !path.exists() {
        return Ok(YeonjangSettings::default());
    }

    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed to read settings file: {}", path.display()))?;
    let settings = serde_json::from_str::<YeonjangSettings>(&raw)
        .with_context(|| format!("failed to parse settings file: {}", path.display()))?;
    Ok(settings)
}

pub fn save_settings(settings: &YeonjangSettings) -> Result<PathBuf> {
    let path = settings_path();
    ensure_parent_dir(&path)?;

    let content = serde_json::to_string_pretty(settings)?;
    fs::write(&path, content)
        .with_context(|| format!("failed to write settings file: {}", path.display()))?;

    Ok(path)
}

fn ensure_parent_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create settings directory: {}", parent.display()))?;
    }
    Ok(())
}
