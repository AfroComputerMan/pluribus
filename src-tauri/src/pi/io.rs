use tokio::process::{Child, ChildStdin, ChildStdout};

/// Transport abstraction for a `pi --mode rpc` process.
///
/// `HostProcess` = local tokio child (this issue, #17).
/// `ContainerExec` = `docker exec` transport (deferred to #18) — a compiling stub.
///
/// The seam lets #18 swap the I/O source without touching `service.rs` logic.
pub trait PiIo {
    /// Spawn the pi process and return `(child, stdout, stdin)`.
    ///
    /// The API key is injected into the child's environment under `key_name`
    /// (e.g. `OPENROUTER_API_KEY`) — Pi has NO dotenv layer, so the spawner must
    /// inject it explicitly. `key_name` is provider-derived (see commands.rs).
    fn spawn(
        &self,
        provider: &str,
        model: &str,
        key_name: &str,
        api_key: &str,
    ) -> Result<(Child, ChildStdout, ChildStdin), String>;
}

/// Host transport: spawns `pi --mode rpc` as a local tokio child process.
pub struct HostProcess;

impl PiIo for HostProcess {
    fn spawn(
        &self,
        provider: &str,
        model: &str,
        key_name: &str,
        api_key: &str,
    ) -> Result<(Child, ChildStdout, ChildStdin), String> {
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

        Ok((child, stdout, stdin))
    }
}

/// STUB for #18 — container exec transport. Compiles, returns `Err`.
#[allow(dead_code)]
pub struct ContainerExec {
    pub container_id: String,
}

impl PiIo for ContainerExec {
    fn spawn(
        &self,
        _provider: &str,
        _model: &str,
        _key_name: &str,
        _api_key: &str,
    ) -> Result<(Child, ChildStdout, ChildStdin), String> {
        Err("ContainerExec not implemented (deferred to #18)".into())
    }
}
