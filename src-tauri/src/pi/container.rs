use std::collections::HashMap;

use bollard::query_parameters::{
    CreateContainerOptionsBuilder, ListContainersOptionsBuilder, RemoveContainerOptionsBuilder,
    StartContainerOptions,
};
use bollard::Docker;
use futures_util::StreamExt;
use tokio::io::AsyncRead;
use tokio_util::io::StreamReader;

use super::io::{PiHandle, PiIo, PiTransport};

/// The hand-built sandbox base image (`docker/sandbox-base/Dockerfile`, `pi-base`
/// target). #18 only ever runs the `pi-base` tag; the backend never builds it
/// (ADR 0004 deferred) — it only checks presence and errors with a build hint.
pub const PI_SANDBOX_IMAGE: &str = "pluribus-pi-sandbox:base";

/// Label every managed container so startup reconcile / window-close teardown
/// can find and force-remove them (`docker ps` filter by `pluribus.managed=true`).
pub const MANAGED_LABEL_KEY: &str = "pluribus.managed";
pub const MANAGED_LABEL_VALUE: &str = "true";

/// Container transport: drives `pi --mode rpc` inside a per-agent Docker
/// container via `docker exec` (bollard). One container per agent (#18 POC).
pub struct ContainerExec {
    /// Deterministic, per-session name: `pluribus-sandbox-<thread-id-prefix>`.
    pub container_name: String,
    /// Optional per-agent clone bind-mount (#19): `(host_path, container_path)`.
    /// When `Some`, the host clone dir is bind-mounted read-write into the
    /// container at `container_path`, and the `pi` exec runs with that path as
    /// its `working_dir` (Pi has NO `--cwd` flag — it uses the process cwd).
    /// When `None`, behave exactly as #18 (no mount, default cwd).
    pub mount: Option<(String, String)>,
}

#[async_trait::async_trait]
impl PiIo for ContainerExec {
    async fn spawn(
        &self,
        provider: &str,
        model: &str,
        key_name: &str,
        api_key: &str,
    ) -> Result<PiTransport, String> {
        // 1. Connect to the Docker daemon via the platform socket defaults.
        let docker = Docker::connect_with_socket_defaults()
            .map_err(|e| format!("Docker not reachable: {e}"))?;

        // 2. Require the base image to be present — NO silent build (ADR 0004).
        if let Err(e) = docker.inspect_image(PI_SANDBOX_IMAGE).await {
            if let bollard::errors::Error::DockerResponseServerError {
                status_code: 404, ..
            } = e
            {
                return Err(format!(
                    "base image '{PI_SANDBOX_IMAGE}' not found — build it: \
                     docker build --target pi-base -t {PI_SANDBOX_IMAGE} docker/sandbox-base"
                ));
            }
            return Err(format!("Docker not reachable: {e}"));
        }

        // 3. Best-effort remove a stale container of the same name (idempotent
        //    restart after a crash that skipped teardown). Ignore errors.
        let rm_opts = RemoveContainerOptionsBuilder::default()
            .force(true)
            .v(true)
            .build();
        let _ = docker
            .remove_container(&self.container_name, Some(rm_opts))
            .await;

        // 4. Create the container: open stdin (so the exec stdin half stays
        //    attachable) and tag it managed for orphan reconcile. The image's
        //    ENTRYPOINT is `sleep infinity` — a no-op host; Pi is launched per
        //    session by the exec below.
        let mut labels = HashMap::new();
        labels.insert(
            MANAGED_LABEL_KEY.to_string(),
            MANAGED_LABEL_VALUE.to_string(),
        );
        // When a clone mount is configured (#19), bind-mount the host clone dir
        // into the container read-write (NO `:ro` — Pi must edit it; the clone,
        // not a read-only mount, is the source-protecting boundary). When `None`,
        // host_config stays absent and behaviour matches #18 exactly.
        let host_config = self.mount.as_ref().map(|(host, container)| {
            bollard::models::HostConfig {
                binds: Some(vec![format!("{host}:{container}")]),
                ..Default::default()
            }
        });
        let body = bollard::models::ContainerCreateBody {
            image: Some(PI_SANDBOX_IMAGE.to_string()),
            open_stdin: Some(true),
            labels: Some(labels),
            host_config,
            ..Default::default()
        };
        let create_opts = CreateContainerOptionsBuilder::default()
            .name(&self.container_name)
            .build();
        let created = docker
            .create_container(Some(create_opts), body)
            .await
            .map_err(|e| format!("Failed to create sandbox container: {e}"))?;
        let container_id = created.id;

        docker
            .start_container(&container_id, None::<StartContainerOptions>)
            .await
            .map_err(|e| format!("Failed to start sandbox container: {e}"))?;

        // 5. Create the exec: launch `pi --mode rpc` inside the container with
        //    the API key delivered via the exec env (NEVER baked into the
        //    image). `tty: false` keeps stdout multiplexed framing intact (a
        //    PTY would corrupt the NDJSON stream); attach all three streams so
        //    stdin stays writable and stdout is readable.
        // Pi has NO `--cwd` flag — it operates on the process cwd. When a clone
        // is mounted (#19), set the exec `working_dir` to the container mount
        // path so Pi's native tools act on the clone. `None` when unmounted (#18).
        let working_dir = self.mount.as_ref().map(|(_, container)| container.clone());
        let exec = docker
            .create_exec(
                &container_id,
                bollard::exec::CreateExecOptions {
                    cmd: Some(vec![
                        "pi".to_string(),
                        "--mode".to_string(),
                        "rpc".to_string(),
                        "--provider".to_string(),
                        provider.to_string(),
                        "--model".to_string(),
                        model.to_string(),
                    ]),
                    env: Some(vec![format!("{key_name}={api_key}")]),
                    working_dir,
                    attach_stdin: Some(true),
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    tty: Some(false),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| format!("Failed to create pi exec: {e}"))?;
        let exec_id = exec.id;

        // 6. Start the exec and attach. `tty:false` → multiplexed `LogOutput`
        //    frames; we keep ONLY `StdOut` (StdErr/Console would corrupt the
        //    NDJSON line stream) and adapt the byte stream into an `AsyncRead`
        //    via `tokio_util::io::StreamReader`. `BufReader::lines()` then splits
        //    on `\n` exactly as on the host (ADR 0005 LF framing preserved).
        let (stdout, stdin): (
            Box<dyn AsyncRead + Unpin + Send>,
            Box<dyn tokio::io::AsyncWrite + Unpin + Send>,
        ) = match docker
            .start_exec(&exec_id, None)
            .await
            .map_err(|e| format!("Failed to start pi exec: {e}"))?
        {
            bollard::exec::StartExecResults::Attached { output, input } => {
                // `filter_map`'s closure returns an `async move {}` future which is
                // `!Unpin`, making the resulting stream (and `StreamReader`) `!Unpin`;
                // `Box::pin` makes the stream `Unpin` so it fits `Box<dyn AsyncRead +
                // Unpin + Send>`.
                let byte_stream = Box::pin(output.filter_map(|frame| async move {
                    match frame {
                        Ok(bollard::container::LogOutput::StdOut { message }) => Some(Ok(message)),
                        // Drop StdErr / StdIn / Console frames — only StdOut is NDJSON.
                        Ok(_) => None,
                        Err(e) => Some(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
                    }
                }));
                (Box::new(StreamReader::new(byte_stream)), Box::new(input))
            }
            bollard::exec::StartExecResults::Detached => {
                // Should never happen (we set attach_*), but fail loudly.
                let _ = PiHandle::Container {
                    docker: docker.clone(),
                    container_id: container_id.clone(),
                    exec_id: exec_id.clone(),
                }
                .teardown()
                .await;
                return Err("pi exec started detached (expected attached)".to_string());
            }
        };

        Ok(PiTransport {
            stdout,
            stdin,
            handle: PiHandle::Container {
                docker,
                container_id,
                exec_id,
            },
        })
    }
}

/// Stop (`t:10`) then force-remove (`force`, `v`) a container by id/name.
/// Best-effort — a stopped/missing container must not error the caller. Shared
/// by `PiHandle::teardown` (container arm) and `PiService`'s teardown view.
pub async fn stop_and_remove(docker: &Docker, container: &str) {
    use bollard::query_parameters::StopContainerOptionsBuilder;
    let stop_opts = StopContainerOptionsBuilder::default().t(10).build();
    let _ = docker.stop_container(container, Some(stop_opts)).await;
    let rm_opts = RemoveContainerOptionsBuilder::default()
        .force(true)
        .v(true)
        .build();
    let _ = docker.remove_container(container, Some(rm_opts)).await;
}

/// Force-remove every container labeled `pluribus.managed=true` (best-effort).
///
/// Used by startup reconcile (orphans from a previous run that skipped
/// teardown) — TS `kill_pid` cannot stop containers, so the backend must.
/// Errors are logged and swallowed so one bad container can't block startup.
pub async fn reap_managed_containers() {
    let docker = match Docker::connect_with_socket_defaults() {
        Ok(d) => d,
        // No daemon (or host-only dev) — nothing to reap.
        Err(e) => {
            eprintln!("[pi] orphan reconcile skipped — Docker not reachable: {e}");
            return;
        }
    };

    let mut filters = HashMap::new();
    filters.insert(
        "label".to_string(),
        vec![format!("{MANAGED_LABEL_KEY}={MANAGED_LABEL_VALUE}")],
    );
    let list_opts = ListContainersOptionsBuilder::default()
        .all(true)
        .filters(&filters)
        .build();

    let containers = match docker.list_containers(Some(list_opts)).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[pi] orphan reconcile failed to list containers: {e}");
            return;
        }
    };

    let rm_opts = RemoveContainerOptionsBuilder::default()
        .force(true)
        .v(true)
        .build();
    for c in containers {
        if let Some(id) = c.id {
            if let Err(e) = docker.remove_container(&id, Some(rm_opts.clone())).await {
                eprintln!("[pi] orphan reconcile failed to remove {id}: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::query_parameters::CreateContainerOptionsBuilder;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    /// JSONL round-trip through `docker exec` stdin→stdout.
    ///
    /// Proves the wire contract the live transport depends on: `open_stdin`,
    /// `attach_stdin/out/err`, `tty:false`, and LF framing. Without those, stdin
    /// drops or a PTY corrupts the multiplexed stream. Uses `cat` as a pure echo
    /// so it is image-agnostic (alpine), independent of the pi base image.
    ///
    /// `#[ignore]`d — CI has no Docker daemon. Run locally with Docker up:
    ///   `cargo test -- --ignored pi_container_jsonl_roundtrip`
    #[tokio::test]
    #[ignore]
    async fn pi_container_jsonl_roundtrip() {
        let docker = Docker::connect_with_socket_defaults().expect("docker connect");
        let name = "pluribus-test-roundtrip";

        // Clean any stale container from a previous aborted run.
        let rm_opts = RemoveContainerOptionsBuilder::default()
            .force(true)
            .v(true)
            .build();
        let _ = docker.remove_container(name, Some(rm_opts.clone())).await;

        let mut labels = HashMap::new();
        labels.insert(
            MANAGED_LABEL_KEY.to_string(),
            MANAGED_LABEL_VALUE.to_string(),
        );
        let body = bollard::models::ContainerCreateBody {
            image: Some("alpine:latest".to_string()),
            open_stdin: Some(true),
            cmd: Some(vec!["sleep".to_string(), "infinity".to_string()]),
            labels: Some(labels),
            ..Default::default()
        };
        let created = docker
            .create_container(
                Some(CreateContainerOptionsBuilder::default().name(name).build()),
                body,
            )
            .await
            .expect("create container");
        docker
            .start_container(&created.id, None::<StartContainerOptions>)
            .await
            .expect("start container");

        let exec = docker
            .create_exec(
                &created.id,
                bollard::exec::CreateExecOptions {
                    cmd: Some(vec!["cat".to_string()]),
                    attach_stdin: Some(true),
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    tty: Some(false),
                    ..Default::default()
                },
            )
            .await
            .expect("create exec");

        let (mut stdout, mut stdin): (
            Box<dyn AsyncRead + Unpin + Send>,
            Box<dyn tokio::io::AsyncWrite + Unpin + Send>,
        ) = match docker.start_exec(&exec.id, None).await.expect("start exec") {
            bollard::exec::StartExecResults::Attached { output, input } => {
                let byte_stream = Box::pin(output.filter_map(|frame| async move {
                    match frame {
                        Ok(bollard::container::LogOutput::StdOut { message }) => Some(Ok(message)),
                        Ok(_) => None,
                        Err(e) => Some(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
                    }
                }));
                (Box::new(StreamReader::new(byte_stream)), Box::new(input))
            }
            bollard::exec::StartExecResults::Detached => panic!("exec detached"),
        };

        let sent = "{\"type\":\"ping\"}";
        stdin.write_all(sent.as_bytes()).await.expect("write");
        stdin.write_all(b"\n").await.expect("write lf");
        stdin.flush().await.expect("flush");

        let mut lines = BufReader::new(&mut stdout).lines();
        let got = lines
            .next_line()
            .await
            .expect("read line")
            .expect("a line");
        assert_eq!(got, sent, "JSONL line must round-trip byte-for-byte");

        // Teardown.
        stop_and_remove(&docker, &created.id).await;
    }
}
