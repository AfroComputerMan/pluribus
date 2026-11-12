// Injected into the page BEFORE app code runs. Implements the slice of Tauri v2's
// `window.__TAURI_INTERNALS__` the frontend touches, so the real React app boots
// in plain Chromium. A run is simulated entirely client-side:
//   - pi_agent_running reflects window.__demo.running
//   - pi_steer_agent / pi_abort resolve and flip state
//   - SQL selects return canned/empty rows; the PRAGMA returns WAL.
export const TAURI_MOCK = () => {
  const w = /** @type {any} */ (window);
  w.__demo = { running: false, invokeLog: [] };

  const T = "2026-01-01T00:00:00Z";
  const DEMO = {
    workspace: { id: "ws-demo", name: "Demo Project", cwd: "/tmp/demo", created_at: T, updated_at: T },
    thread: {
      id: "th-demo", remote_id: "th-demo", title: "Steer + abort demo", status: "regular",
      session_id: "th-demo", cwd: "/tmp/demo", workspace_id: "ws-demo", git_branch: null,
      model: "openrouter/deepseek/deepseek-v4-flash", effort: null, dev_panel_open: 0,
      agent_status: null, provider_type: "pi", created_at: T, updated_at: T,
    },
  };

  const ok = (v) => Promise.resolve(v);

  w.__TAURI_INTERNALS__ = {
    // getCurrentWindow()/getCurrentWebviewWindow() read this synchronously at
    // import time — without it the app white-screens on boot.
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    // Callback registry used by @tauri-apps/api event/listen + channels.
    transformCallback(cb) {
      const id = (w.__cbId = (w.__cbId || 0) + 1);
      w[`_${id}`] = cb;
      return id;
    },
    unregisterCallback(id) {
      delete w[`_${id}`];
    },
    invoke(cmd, args) {
      w.__demo.invokeLog.push(cmd);

      // --- tauri-plugin-sql -------------------------------------------------
      if (cmd === "plugin:sql|load") return ok("sqlite:pluribus.db");
      if (cmd === "plugin:sql|select") {
        const q = String((args && args.query) || "").toLowerCase();
        if (q.includes("journal_mode")) return ok([{ journal_mode: "wal" }]);
        // Seed one workspace + one Pi-model thread so the chat composer (and the
        // #20 steer/abort controls) are reachable without a real backend.
        if (q.includes("from workspaces")) return ok([DEMO.workspace]);
        if (q.includes("from threads")) return ok([DEMO.thread]);
        return ok([]); // messages / settings / everything else: empty
      }
      if (cmd === "plugin:sql|execute") return ok([0, 0]);

      // --- tauri-plugin-path / fs-ish ranges -------------------------------
      if (cmd === "plugin:path|resolve_directory") return ok("/tmp/pluribus");
      if (cmd === "plugin:path|join")
        return ok(((args && args.paths) || []).join("/") || "/tmp/pluribus");
      if (cmd === "list_clone_dirs") return ok([]);

      // --- tauri event system ----------------------------------------------
      if (cmd === "plugin:event|listen") return ok(0);
      if (cmd === "plugin:event|unlisten") return ok(null);
      if (cmd === "plugin:event|emit") return ok(null);

      // --- #20 steer/abort feature -----------------------------------------
      if (cmd === "pi_agent_running") return ok(!!w.__demo.running);
      if (cmd === "pi_get_state")
        return ok({ running: !!w.__demo.running, agent_running: !!w.__demo.running });
      if (cmd === "pi_steer_agent") return ok(null); // queued; UI shows the notice
      if (cmd === "pi_abort" || cmd === "pi_stop") {
        w.__demo.running = false;
        return ok(null);
      }
      if (cmd === "pi_prompt" || cmd === "pi_start_session") {
        w.__demo.running = true;
        return ok(null);
      }

      // Everything else: a harmless default so boot never throws on an
      // unmocked command (logged above so we can see what was hit).
      return ok(null);
    },
  };
};
