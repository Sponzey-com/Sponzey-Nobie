mod automation;
mod features;
mod gui;
mod mqtt;
mod node;
mod platform;
mod protocol;
mod settings;

use std::env;
use std::io::{self, BufRead, Write};

use anyhow::Result;
use serde_json::json;

use crate::node::spawn_request_task;
use crate::protocol::{Request, Response};

fn main() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();

    if let Some(command) = parse_flag_value(&args, "--exec") {
        run_exec_shell(command)?;
        return Ok(());
    }

    if let Some(exec_bin_index) = args.iter().position(|arg| arg == "--exec-bin") {
        run_exec_binary(args[(exec_bin_index + 1)..].to_vec())?;
        return Ok(());
    }

    if args.iter().any(|arg| arg == "--stdio") {
        run_stdio()?;
        return Ok(());
    }

    if args.is_empty() || args.iter().any(|arg| arg == "--gui") {
        gui::run_gui()?;
        return Ok(());
    }

    eprintln!("Usage: nobie-yeonjang [--gui | --stdio | --exec <command> | --exec-bin <program> [args...]]");
    std::process::exit(2);
}

fn run_stdio() -> Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut writer = stdout.lock();

    for line in stdin.lock().lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<Request>(trimmed) {
            Ok(request) => spawn_request_task(request)
                .join()
                .unwrap_or_else(|_| Response::error(None, "request_failed", "request thread panicked")),
            Err(error) => Response::error(None, "invalid_request", error.to_string()),
        };

        serde_json::to_writer(&mut writer, &response)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }

    Ok(())
}

fn run_exec_shell(command: String) -> Result<()> {
    let response = spawn_request_task(Request {
        id: Some("local-exec".to_string()),
        method: "system.exec".to_string(),
        params: json!({
            "command": command,
            "shell": true,
        }),
    })
    .join()
    .unwrap_or_else(|_| Response::error(None, "request_failed", "request thread panicked"));
    write_response_and_exit(response)
}

fn run_exec_binary(args: Vec<String>) -> Result<()> {
    let Some(program) = args.first().cloned() else {
        eprintln!("Usage: nobie-yeonjang --exec-bin <program> [args...]");
        std::process::exit(2);
    };

    let response = spawn_request_task(Request {
        id: Some("local-exec-bin".to_string()),
        method: "system.exec".to_string(),
        params: json!({
            "command": program,
            "args": args.into_iter().skip(1).collect::<Vec<_>>(),
            "shell": false,
        }),
    })
    .join()
    .unwrap_or_else(|_| Response::error(None, "request_failed", "request thread panicked"));
    write_response_and_exit(response)
}

fn write_response_and_exit(response: Response) -> Result<()> {
    serde_json::to_writer_pretty(io::stdout().lock(), &response)?;
    io::stdout().lock().write_all(b"\n")?;

    if response.ok {
        return Ok(());
    }

    std::process::exit(1);
}

fn parse_flag_value(args: &[String], flag: &str) -> Option<String> {
    let index = args.iter().position(|arg| arg == flag)?;
    args.get(index + 1).cloned()
}
