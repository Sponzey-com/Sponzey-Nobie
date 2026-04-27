use std::process::Command;

fn git_output(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn main() {
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs");
    println!("cargo:rerun-if-changed=../resource/nobie-1-128.png");

    let git_commit =
        git_output(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".to_string());
    let git_describe = git_output(&["describe", "--tags", "--always", "--dirty"])
        .unwrap_or_else(|| git_commit.clone());
    let build_target = std::env::var("TARGET").unwrap_or_else(|_| "unknown".to_string());

    println!("cargo:rustc-env=YEONJANG_GIT_COMMIT={git_commit}");
    println!("cargo:rustc-env=YEONJANG_GIT_DESCRIBE={git_describe}");
    println!("cargo:rustc-env=YEONJANG_BUILD_TARGET={build_target}");
}
