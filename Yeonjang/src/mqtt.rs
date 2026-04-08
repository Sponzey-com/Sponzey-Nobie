use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc::{self, Receiver};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use rumqttc::{Client, Event, Incoming, LastWill, MqttOptions, Outgoing, QoS};
use serde::Serialize;

use crate::node::{capabilities_payload, spawn_request_task};
use crate::protocol::{Request, Response};
use crate::settings::{YeonjangSettings, load_settings};

const RESPONSE_CHUNK_BYTES: usize = 48 * 1024;
const MQTT_MAX_PACKET_BYTES: usize = 8 * 1024 * 1024;
const MQTT_REQUEST_CHANNEL_CAPACITY: usize = 256;
const MQTT_RECONNECT_DELAY: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub enum RuntimeEvent {
    Connected,
    Reconnecting(String),
    Disconnected(String),
    AuthFailed(String),
    ResponsePublishFailed { method: String, message: String },
    RequestHandled { method: String, ok: bool },
}

pub struct MqttRuntimeHandle {
    client: Arc<Mutex<Option<Client>>>,
    stop_requested: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl MqttRuntimeHandle {
    pub fn stop(mut self) -> Result<()> {
        self.stop_requested.store(true, Ordering::SeqCst);
        if let Some(client) = self.client.lock().ok().and_then(|guard| guard.clone()) {
            let _ = client.disconnect();
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        Ok(())
    }
}

pub fn start_runtime(
    settings: YeonjangSettings,
) -> Result<(MqttRuntimeHandle, Receiver<RuntimeEvent>)> {
    validate_connection_settings(&settings)?;

    let normalized = normalize_settings(settings);
    let (event_tx, event_rx) = mpsc::channel::<RuntimeEvent>();
    let active_client = Arc::new(Mutex::new(None));
    let stop_requested = Arc::new(AtomicBool::new(false));
    let control_client = Arc::clone(&active_client);
    let control_stop = Arc::clone(&stop_requested);

    let thread = thread::spawn(move || {
        while !stop_requested.load(Ordering::SeqCst) {
            let options = match build_runtime_options(&normalized) {
                Ok(options) => options,
                Err(error) => {
                    let _ = event_tx.send(RuntimeEvent::Disconnected(error.to_string()));
                    break;
                }
            };

            let (client, mut connection) = Client::new(options, 20);
            if let Ok(mut slot) = active_client.lock() {
                *slot = Some(client.clone());
            }

            if let Err(error) = publish_bootstrap(&client, &normalized) {
                match classify_error(&error) {
                    RuntimeEvent::AuthFailed(message) => {
                        let _ = event_tx.send(RuntimeEvent::AuthFailed(message));
                        break;
                    }
                    RuntimeEvent::Disconnected(message) | RuntimeEvent::Reconnecting(message) => {
                        let _ = event_tx.send(RuntimeEvent::Reconnecting(format!(
                            "{message}. Retrying in {} seconds.",
                            MQTT_RECONNECT_DELAY.as_secs()
                        )));
                        if !sleep_with_stop_check(MQTT_RECONNECT_DELAY, &stop_requested) {
                            break;
                        }
                        continue;
                    }
                    other => {
                        let _ = event_tx.send(other);
                        break;
                    }
                }
            }

            let should_retry = run_connection_loop(
                &client,
                &mut connection,
                &normalized,
                &event_tx,
                &stop_requested,
            );

            if let Ok(mut slot) = active_client.lock() {
                *slot = None;
            }

            if !should_retry {
                break;
            }
        }
    });

    Ok((
        MqttRuntimeHandle {
            client: control_client,
            stop_requested: control_stop,
            thread: Some(thread),
        },
        event_rx,
    ))
}

pub fn probe_connection(settings: &YeonjangSettings) -> Result<()> {
    validate_connection_settings(settings)?;
    let address = format!(
        "{}:{}",
        settings.connection.host.trim(),
        settings.connection.port
    );
    let target = address
        .to_socket_addrs()
        .with_context(|| format!("failed to resolve broker address: {address}"))?
        .next()
        .ok_or_else(|| anyhow!("failed to resolve broker address: {address}"))?;

    TcpStream::connect_timeout(&target, Duration::from_secs(2))
        .with_context(|| format!("failed to reach MQTT broker at {address}"))?;
    Ok(())
}

fn build_runtime_options(settings: &YeonjangSettings) -> Result<MqttOptions> {
    let mut options = build_options(settings)?;
    options.set_keep_alive(Duration::from_secs(20));
    options.set_max_packet_size(MQTT_MAX_PACKET_BYTES, MQTT_MAX_PACKET_BYTES);
    options.set_request_channel_capacity(MQTT_REQUEST_CHANNEL_CAPACITY);
    options.set_credentials(
        settings.connection.username.clone(),
        settings.connection.password.clone(),
    );
    options.set_last_will(LastWill::new(
        settings.mqtt.status_topic.clone(),
        serde_json::to_vec(&status_payload(settings, "offline", "disconnected"))?,
        QoS::AtLeastOnce,
        true,
    ));
    Ok(options)
}

fn sleep_with_stop_check(duration: Duration, stop_requested: &AtomicBool) -> bool {
    let step = Duration::from_millis(100);
    let mut elapsed = Duration::ZERO;
    while elapsed < duration {
        if stop_requested.load(Ordering::SeqCst) {
            return false;
        }
        let sleep_for = duration.saturating_sub(elapsed).min(step);
        thread::sleep(sleep_for);
        elapsed += sleep_for;
    }
    true
}

fn run_connection_loop(
    client: &Client,
    connection: &mut rumqttc::Connection,
    settings: &YeonjangSettings,
    event_tx: &mpsc::Sender<RuntimeEvent>,
    stop_requested: &AtomicBool,
) -> bool {
    let mut announced_connected = false;

    for notification in connection.iter() {
        if stop_requested.load(Ordering::SeqCst) {
            let _ = event_tx.send(RuntimeEvent::Disconnected(
                "requested disconnect".to_string(),
            ));
            return false;
        }

        match notification {
            Ok(Event::Incoming(Incoming::ConnAck(_))) => {
                announced_connected = true;
                let _ = event_tx.send(RuntimeEvent::Connected);
            }
            Ok(Event::Incoming(Incoming::Publish(publish))) => {
                if publish.topic != settings.mqtt.request_topic {
                    continue;
                }

                let payload = publish.payload.to_vec();
                let response_client = client.clone();
                let response_settings = settings.clone();
                let response_events = event_tx.clone();

                thread::spawn(move || {
                    let _ = publish_runtime_state(
                        &response_client,
                        &response_settings,
                        "refreshing-capabilities",
                        true,
                    );

                    let (method, response) = match serde_json::from_slice::<Request>(&payload) {
                        Ok(request) => {
                            let method = request.method.clone();
                            let response =
                                spawn_request_task(request).join().unwrap_or_else(|_| {
                                    Response::error(
                                        None,
                                        "request_failed",
                                        "request thread panicked",
                                    )
                                });
                            (method, response)
                        }
                        Err(error) => (
                            "invalid_request".to_string(),
                            Response::error(
                                None,
                                "invalid_request",
                                format!("failed to parse request payload: {error}"),
                            ),
                        ),
                    };

                    if let Err(error) =
                        publish_response(&response_client, &response_settings, &response)
                    {
                        let _ = response_events.send(RuntimeEvent::ResponsePublishFailed {
                            method,
                            message: error.to_string(),
                        });
                        return;
                    }

                    let _ =
                        publish_runtime_state(&response_client, &response_settings, "ready", true);

                    let _ = response_events.send(RuntimeEvent::RequestHandled {
                        method,
                        ok: response.ok,
                    });
                });
            }
            Ok(Event::Outgoing(Outgoing::Disconnect)) => {
                let _ = event_tx.send(RuntimeEvent::Disconnected(
                    "requested disconnect".to_string(),
                ));
                return false;
            }
            Ok(_) => {}
            Err(error) => {
                if announced_connected {
                    let _ = publish_status(client, settings, "offline", "disconnected", true);
                }

                match classify_error(&anyhow!(error.to_string())) {
                    RuntimeEvent::AuthFailed(message) => {
                        let _ = event_tx.send(RuntimeEvent::AuthFailed(message));
                        return false;
                    }
                    RuntimeEvent::Disconnected(message) | RuntimeEvent::Reconnecting(message) => {
                        let _ = event_tx.send(RuntimeEvent::Reconnecting(format!(
                            "{message}. Retrying in {} seconds.",
                            MQTT_RECONNECT_DELAY.as_secs()
                        )));
                        return sleep_with_stop_check(MQTT_RECONNECT_DELAY, stop_requested);
                    }
                    other => {
                        let _ = event_tx.send(other);
                        return false;
                    }
                }
            }
        }
    }

    if announced_connected {
        let _ = publish_status(client, settings, "offline", "disconnected", true);
    }

    if stop_requested.load(Ordering::SeqCst) {
        let _ = event_tx.send(RuntimeEvent::Disconnected("requested disconnect".to_string()));
        return false;
    }

    let _ = event_tx.send(RuntimeEvent::Reconnecting(format!(
        "MQTT connection ended. Retrying in {} seconds.",
        MQTT_RECONNECT_DELAY.as_secs()
    )));
    sleep_with_stop_check(MQTT_RECONNECT_DELAY, stop_requested)
}

fn normalize_settings(mut settings: YeonjangSettings) -> YeonjangSettings {
    if settings.mqtt.request_topic.trim().is_empty()
        || settings.mqtt.response_topic.trim().is_empty()
        || settings.mqtt.status_topic.trim().is_empty()
        || settings.mqtt.capabilities_topic.trim().is_empty()
    {
        settings.reset_topics_from_node_id();
    }
    settings
}

fn build_options(settings: &YeonjangSettings) -> Result<MqttOptions> {
    let host = settings.connection.host.trim();
    let client_id = format!("{}-mqtt", settings.node_id.trim());
    if host.is_empty() {
        anyhow::bail!("broker host is required")
    }
    Ok(MqttOptions::new(client_id, host, settings.connection.port))
}

fn validate_connection_settings(settings: &YeonjangSettings) -> Result<()> {
    if settings.connection.host.trim().is_empty() {
        anyhow::bail!("broker host is required")
    }
    if settings.connection.username.trim().is_empty() {
        anyhow::bail!("broker username is required")
    }
    if settings.connection.password.trim().is_empty() {
        anyhow::bail!("broker password is required")
    }
    Ok(())
}

fn publish_bootstrap(client: &Client, settings: &YeonjangSettings) -> Result<()> {
    client.subscribe(settings.mqtt.request_topic.clone(), QoS::AtLeastOnce)?;
    publish_runtime_state(client, settings, "ready", true)?;
    Ok(())
}

fn publish_response(
    client: &Client,
    settings: &YeonjangSettings,
    response: &Response,
) -> Result<()> {
    let payload = serde_json::to_vec(response)?;
    if payload.len() <= RESPONSE_CHUNK_BYTES || response.id.is_none() {
        client.publish(
            settings.mqtt.response_topic.clone(),
            QoS::AtLeastOnce,
            false,
            payload,
        )?;
        return Ok(());
    }

    let request_id = response.id.clone();
    let total_chunks = payload.len().div_ceil(RESPONSE_CHUNK_BYTES);
    let total_size_bytes = payload.len();

    for (chunk_index, chunk) in payload.chunks(RESPONSE_CHUNK_BYTES).enumerate() {
        let envelope = ResponseChunkEnvelope {
            transport: "chunk",
            id: request_id.clone(),
            chunk_index,
            chunk_count: total_chunks,
            total_size_bytes,
            encoding: "base64",
            mime_type: "application/json",
            base64_data: base64_encode(chunk),
        };
        client.publish(
            settings.mqtt.response_topic.clone(),
            QoS::AtLeastOnce,
            false,
            serde_json::to_vec(&envelope)?,
        )?;
    }

    Ok(())
}

fn publish_capabilities(client: &Client, settings: &YeonjangSettings) -> Result<()> {
    client.publish(
        settings.mqtt.capabilities_topic.clone(),
        QoS::AtLeastOnce,
        true,
        serde_json::to_vec(&capabilities_payload())?,
    )?;
    Ok(())
}

fn publish_runtime_state(
    client: &Client,
    settings: &YeonjangSettings,
    message: &str,
    retained: bool,
) -> Result<()> {
    let runtime_settings = refresh_runtime_settings(settings);
    publish_capabilities(client, &runtime_settings)?;
    publish_status(client, &runtime_settings, "online", message, retained)?;
    Ok(())
}

fn refresh_runtime_settings(fallback: &YeonjangSettings) -> YeonjangSettings {
    load_settings()
        .map(normalize_settings)
        .map(|mut refreshed| {
            // Keep publishing on the runtime's active topics even if the persisted
            // node id/topics changed while the current session is connected.
            refreshed.mqtt = fallback.mqtt.clone();
            refreshed
        })
        .unwrap_or_else(|_| fallback.clone())
}

fn publish_status(
    client: &Client,
    settings: &YeonjangSettings,
    state: &str,
    message: &str,
    retained: bool,
) -> Result<()> {
    client.publish(
        settings.mqtt.status_topic.clone(),
        QoS::AtLeastOnce,
        retained,
        serde_json::to_vec(&status_payload(settings, state, message))?,
    )?;
    Ok(())
}

fn classify_error(error: &anyhow::Error) -> RuntimeEvent {
    let message = error.to_string();
    let lower = message.to_lowercase();
    if lower.contains("not authorized")
        || lower.contains("bad username or password")
        || lower.contains("authentication")
        || lower.contains("auth")
    {
        RuntimeEvent::AuthFailed(message)
    } else {
        RuntimeEvent::Disconnected(message)
    }
}

#[derive(Debug, Serialize)]
struct StatusPayload<'a> {
    node_id: &'a str,
    display_name: &'a str,
    state: &'a str,
    message: &'a str,
    version: &'static str,
}

fn status_payload<'a>(
    settings: &'a YeonjangSettings,
    state: &'a str,
    message: &'a str,
) -> StatusPayload<'a> {
    StatusPayload {
        node_id: settings.node_id.as_str(),
        display_name: settings.display_name.as_str(),
        state,
        message,
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[derive(Debug, Serialize)]
struct ResponseChunkEnvelope {
    transport: &'static str,
    id: Option<String>,
    chunk_index: usize,
    chunk_count: usize,
    total_size_bytes: usize,
    encoding: &'static str,
    mime_type: &'static str,
    base64_data: String,
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut index = 0;
    while index < bytes.len() {
        let first = bytes[index];
        let second = bytes.get(index + 1).copied();
        let third = bytes.get(index + 2).copied();

        output.push(TABLE[(first >> 2) as usize] as char);
        output.push(
            TABLE[(((first & 0b0000_0011) << 4) | (second.unwrap_or(0) >> 4)) as usize] as char,
        );

        match second {
            Some(second) => {
                output.push(
                    TABLE[(((second & 0b0000_1111) << 2) | (third.unwrap_or(0) >> 6)) as usize]
                        as char,
                );
            }
            None => output.push('='),
        }

        match third {
            Some(third) => output.push(TABLE[(third & 0b0011_1111) as usize] as char),
            None => output.push('='),
        }

        index += 3;
    }
    output
}
