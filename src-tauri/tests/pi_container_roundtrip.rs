//! Integration test: JSONL round-trip through `docker exec` stdin→stdout.
//!
//! Proves the wire contract the live `ContainerExec` transport depends on:
//! `open_stdin`, `attach_stdin/out/err`, `tty:false`, LF framing, and the
//! `StreamReader`+`filter_map(StdOut)` adaptation used in
//! `src-tauri/src/pi/container.rs`. Uses `cat` as a pure echo — image-agnostic
//! (alpine), independent of the Pi sandbox image.
//!
//! This is an `#[ignore]`d integration test — CI has no Docker daemon.
//! Run locally with Docker running:
//!
//! ```text
//! cargo test -- --ignored pi_container
//! ```

use std::collections::HashMap;

use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::query_parameters::{
    CreateContainerOptionsBuilder, RemoveContainerOptionsBuilder, StartContainerOptions,
};
use bollard::Docker;
use futures_util::StreamExt;
use pluribus_lib::pi::container::{
    stop_and_remove, MANAGED_LABEL_KEY, MANAGED_LABEL_VALUE,
};
use tokio::io::{AsyncRead, AsyncWriteExt, BufReader, AsyncBufReadExt};
use tokio_util::io::StreamReader;

/// JSONL round-trip through `docker exec` stdin→stdout using the exact
/// bollard 0.20 API path exercised by `ContainerExec::spawn`.
///
/// Asserts:
/// - `create_container` with `open_stdin:true` keeps stdin attachable.
/// - `create_exec` with `attach_stdin/stdout/stderr:true` and `tty:Some(false)`.
/// - `start_exec` yields `Attached { output, input }` (not `Detached`).
/// - `filter_map(LogOutput::StdOut)` + `StreamReader` produces a valid `AsyncRead`.
/// - A JSON line written to `input` is echoed byte-for-byte on `output`.
///
/// Run locally (requires Docker daemon + `alpine:latest` pulled):
///   `cargo test -- --ignored pi_container_jsonl_roundtrip`
#[tokio::test]
#[ignore]
async fn pi_container_jsonl_roundtrip() {
    let docker = Docker::connect_with_socket_defaults().expect("docker connect");
    let container_name = "pluribus-test-roundtrip";

    // Best-effort remove any stale container from a prior aborted run.
    let rm_opts = RemoveContainerOptionsBuilder::default()
        .force(true)
        .v(true)
        .build();
    let _ = docker
        .remove_container(container_name, Some(rm_opts))
        .await;

    // Create a labelled container (alpine `sleep infinity` — no Pi image needed).
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
            Some(
                CreateContainerOptionsBuilder::default()
                    .name(container_name)
                    .build(),
            ),
            body,
        )
        .await
        .expect("create container");

    docker
        .start_container(&created.id, None::<StartContainerOptions>)
        .await
        .expect("start container");

    // Create exec: `cat` echoes stdin to stdout with `tty:false` (no PTY
    // corruption) and all three streams attached (same flags as ContainerExec).
    let exec = docker
        .create_exec(
            &created.id,
            CreateExecOptions {
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

    // Start the exec and adapt the multiplexed output stream to AsyncRead,
    // keeping only StdOut frames (the same path as ContainerExec::spawn).
    let (mut stdout, mut stdin): (
        Box<dyn AsyncRead + Unpin + Send>,
        Box<dyn tokio::io::AsyncWrite + Unpin + Send>,
    ) = match docker
        .start_exec(&exec.id, None)
        .await
        .expect("start exec")
    {
        StartExecResults::Attached { output, input } => {
            let byte_stream = Box::pin(output.filter_map(|frame| async move {
                match frame {
                    Ok(bollard::container::LogOutput::StdOut { message }) => Some(Ok(message)),
                    // Drop StdErr / StdIn / Console — only StdOut is NDJSON.
                    Ok(_) => None,
                    Err(e) => Some(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
                }
            }));
            (Box::new(StreamReader::new(byte_stream)), Box::new(input))
        }
        StartExecResults::Detached => {
            stop_and_remove(&docker, &created.id).await;
            panic!("exec started detached — expected Attached (check attach_stdin/stdout flags)");
        }
    };

    // Write one NDJSON line and flush so `cat` sees EOF-of-line and echoes it.
    let sent = r#"{"type":"ping"}"#;
    stdin.write_all(sent.as_bytes()).await.expect("write payload");
    stdin.write_all(b"\n").await.expect("write LF");
    stdin.flush().await.expect("flush");

    // Read the echoed line back through the StreamReader-adapted AsyncRead.
    let mut lines = BufReader::new(&mut stdout).lines();
    let got = lines
        .next_line()
        .await
        .expect("read line io error")
        .expect("expected a line — got EOF");

    // Teardown before asserting so the container is always cleaned up.
    stop_and_remove(&docker, &created.id).await;

    assert_eq!(
        got, sent,
        "JSONL line must round-trip byte-for-byte through docker exec stdin→stdout"
    );
}
