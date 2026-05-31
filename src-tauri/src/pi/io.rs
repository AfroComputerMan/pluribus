use tokio::io::{AsyncRead, AsyncWrite};
use tokio::process::Child;

/// Transport abstraction for a `pi --mode rpc` process.
///
/// `HostProcess` = local tokio child (#17).
/// `ContainerExec` = `docker exec` transport (#18, see `super::container`).
///
/// The seam lets the I/O source be swapped (host child ↔ `docker exec` stream)
/// WITHOUT touching `service.rs`'s reader/writer/supervisor logic: `spawn`
/// returns boxed `AsyncRead`/`AsyncWrite` halves plus a transport-tagged
/// `PiHandle` for liveness (`wait`), the host kill safety-net (`pid`), and
/// session-end cleanup (`teardown`).
///
/// `#[async_trait]` (not native `async fn in trait`) because `service.rs` holds
/// `&dyn PiIo` across `.await`; native async-fn-in-trait is not dyn-compatible.
///
/// `Send + Sync` is required because `PiService::start` is an async Tauri command
/// future that holds `&dyn PiIo` across `.await` points; Tauri requires command
/// futures to be `Send`, which needs the trait-object referent to be `Sync`.
#[async_trait::async_trait]
pub trait PiIo: Send + Sync {
    /// Spawn the pi process and return its boxed stdio + a teardown handle.
    ///
    /// The API key is injected under `key_name` (e.g. `OPENROUTER_API_KEY`) —
    /// Pi has NO dotenv layer, so the spawner must inject it explicitly (host:
    /// child `.env`; container: exec `env`, never baked into the image).
    /// `key_name` is provider-derived (see commands.rs).
    async fn spawn(
        &self,
        provider: &str,
        model: &str,
        key_name: &str,
        api_key: &str,
    ) -> Result<PiTransport, String>;
}

/// The reshaped spawn result: transport-agnostic stdio + a teardown handle.
///
/// `service.rs` drives `stdout` via `BufReader::lines()` (needs `AsyncRead`) and
/// `stdin` via `write_all` (needs `AsyncWrite`); both are trait objects so a
/// `docker exec` stream fits where a tokio `ChildStdout`/`ChildStdin` used to.
pub struct PiTransport {
    pub stdout: Box<dyn AsyncRead + Unpin + Send>,
    pub stdin: Box<dyn AsyncWrite + Unpin + Send>,
    pub handle: PiHandle,
}

/// Transport-tagged liveness/teardown handle.
///
/// `Host` carries the tokio child (host PID for the kill safety-net).
/// `Container` carries a bollard client + the container/exec ids so the
/// supervisor can poll the exec for exit and the cleanup can stop+remove.
pub enum PiHandle {
    Host(Child),
    Container {
        docker: bollard::Docker,
        container_id: String,
        exec_id: String,
    },
}

impl PiHandle {
    /// Supervisor: block until the process/exec exits; return its exit code.
    ///
    /// Host  → `child.wait()` then `.code()`.
    /// Container → poll `inspect_exec` until `running == Some(false)`, then
    /// return the recorded `exit_code` (poll interval ~250 ms — fine for the
    /// cleanup `ProcessExit` emit; we don't need sub-ms exit detection).
    pub async fn wait(&mut self) -> Option<i32> {
        match self {
            PiHandle::Host(child) => match child.wait().await {
                Ok(s) => s.code(),
                Err(_) => None,
            },
            PiHandle::Container {
                docker, exec_id, ..
            } => loop {
                match docker.inspect_exec(exec_id).await {
                    Ok(info) => {
                        if info.running == Some(false) {
                            return info.exit_code.map(|c| c as i32);
                        }
                    }
                    // Daemon/exec gone — treat as exited (unknown code).
                    Err(_) => return None,
                }
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            },
        }
    }

    /// PID for the host kill safety-net; `None` for containers (no host PID —
    /// teardown stops the container instead).
    pub fn pid(&self) -> Option<u32> {
        match self {
            PiHandle::Host(child) => child.id(),
            PiHandle::Container { .. } => None,
        }
    }

    /// Force-terminate and reap the process. Called ONLY by the supervisor,
    /// which owns the `Child`, so the kill is coordinated with the owned handle
    /// and never signals a recycled PID (#26 review). Host → SIGKILL via
    /// `start_kill` then reap with `wait`. Container removal is handled by the
    /// explicit `teardown()` path, so this is a no-op for containers.
    pub async fn kill(&mut self) {
        match self {
            PiHandle::Host(child) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
            }
            PiHandle::Container { .. } => {}
        }
    }

    /// Session-end teardown.
    ///
    /// Host → no-op: dropping `PiTransport`/`PiService` closes stdin (EOF →
    /// clean exit); `pi_stop` keeps the `kill_pid` safety-net via `pid()`.
    /// Container → `stop_container(t:10)` then `remove_container(force, v)`
    /// (best-effort: a stopped/missing container must not error the stop path).
    pub async fn teardown(&self) {
        match self {
            PiHandle::Host(_) => { /* drop EOFs stdin; pi_stop kills the pid */ }
            PiHandle::Container {
                docker,
                container_id,
                ..
            } => {
                super::container::stop_and_remove(docker, container_id).await;
            }
        }
    }
}

/// Host transport: spawns `pi --mode rpc` as a local tokio child process.
pub struct HostProcess;

#[async_trait::async_trait]
impl PiIo for HostProcess {
    async fn spawn(
        &self,
        provider: &str,
        model: &str,
        key_name: &str,
        api_key: &str,
    ) -> Result<PiTransport, String> {
        // Keep `--mode rpc` BEFORE `--provider`/`--model` (verified arg order, ADR 0005).
        let mut child = tokio::process::Command::new("pi")
            .args(["--mode", "rpc", "--provider", provider, "--model", model])
            .env(key_name, api_key) // Pi has NO dotenv layer — inject explicitly.
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn pi: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture pi stdout".to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture pi stdin".to_string())?;

        Ok(PiTransport {
            stdout: Box::new(stdout),
            stdin: Box::new(stdin),
            handle: PiHandle::Host(child),
        })
    }
}
