---
feature: discord-rpc-bridge
status: delivered
updated: 2026-10-09
branch: feat/discord-rpc-bridge
commits: 5d3e24f..43a09d8
---

# Discord Rich Presence bridge (non-Discord users)

## Report

**What was built** — The desktop app now impersonates Discord's local IPC
endpoint on Windows, macOS, and Linux. When the Discord desktop app is closed,
games, media players, and other clients that push rich presence connect to the
bridge instead; their `SET_ACTIVITY` payloads are mapped into Nerimity's
activity shape (name from the sending process, action by activity type, cover
art, timestamps, Spotify links) and merged into the existing `rpc-changed`
list, next to extension RPCs, with neither source clobbering the other. Every
10 seconds the bridge probes all `discord-ipc-*` endpoints it does not own and
steps aside the moment the real Discord answers, re-binding after Discord
exits. The feature ships off by default behind a new "Discord Rich Presence
(no Discord needed)" toggle in nerimity-web's Activity Status settings,
directly under the existing Discord Activity block and only in the Electron
app; the web change lives on the same branch name in
`~/nerimity-repos/nerimity-web/.worktrees/discord-rpc-bridge` (spec lives only
in this repo).

**Verification** — Desktop: `npm test` (node --test, 4/4 including handshake ->
READY, activity mapping, clear/disconnect removal, foreign pause/resume),
`node --check` on all six changed files, and a real Electron smoke run: with
the default flag off no socket was bound; with `discordRpcEnabled:true` the
app bound `$XDG_RUNTIME_DIR/discord-ipc-0`, answered a fake client's handshake
with READY and replied to `SET_ACTIVITY` (smoke config and sockets removed
afterwards). Web: `pnpm build` passed (3.80s). `pnpm exec eslint` and
`pnpm exec tsc --noEmit` fail at baseline under TypeScript 7 (plugin/config
errors on unmodified files) — PRE-EXISTING, not caused by this change. The
`set-discord-rpc-enabled` IPC handler was verified by code trace, not runtime
(the page was not running during smoke). An independent review found no
critical or major issues; its minor findings (stop-during-bind race, post-
destroy frame processing, link scheme allowlist, pid parsing, dead field) were
fixed in `43a09d8` and re-tested.

**Journey log** —
1. The Discord Activity feature turned out to live in nerimity-web
   (`useDiscordActivityTracker` + remote tracker), not this repo; three local
   web checkouts existed and only `~/nerimity-repos/nerimity-web` was at
   `origin/main`, so that one got the worktree.
2. `npm ci` on the web repo fails with ERESOLVE (TS 7 peer conflict);
   `pnpm install --frozen-lockfile` is the working path there.
3. Desktop `npm rebuild` dies building `node-window-manager` because ccache
   points at a missing `g++-11`; `CC=gcc CXX=g++ npm rebuild <pkgs>` fixes it,
   and the electron binary needs a manual `node node_modules/electron/install.js`
   because the package.json `allowScripts` allowlist skips electron's postinstall.
4. `pkill -f` matching its own command line kills the shell; bracketed patterns
   (`dist/electr[o]n`) avoid self-match. A killed Electron leaves stale unix
   sockets, which the bridge's own stale-socket path then handles.
5. Reviewer verified the settings toggle double-wiring (block onClick +
   Checkbox onChange) empirically in headless Chromium — safe only because the
   native input covers the hit area — and traced `rpc-changed` end to end
   through the eager `connectionEvents` import graph.

## [S1] Problem

Nerimity's only way to show someone's Discord presence is the "Discord Activity"
setting in the web app: paste a Discord user ID, join the tracking Discord server,
and keep Discord running so the remote tracker (`supertiger.nerimity.com`) can
observe you. It often breaks, and it excludes anyone who has dropped Discord.

Games, media players, and editors already push rich presence through Discord's
local IPC socket (`discord-ipc-*`). When the Discord desktop app is closed those
connections just fail. The feature request: impersonate that local endpoint on
Windows, macOS, and Linux, capture the activities apps send, and publish them to
the Nerimity profile through the existing activity pipeline. The user called it
"Discord Rich Presence for non-Discord users".

## [S2] Design

### Shape of the change

Two repos, two worktrees, one branch name each:

- `nerimity-desktop` worktree `.worktrees/discord-rpc-bridge`, branch
  `feat/discord-rpc-bridge` — the bridge itself (this spec lives here).
- `nerimity-web` worktree `.worktrees/discord-rpc-bridge`, branch
  `feat/discord-rpc-bridge` (checkout `~/nerimity-repos/nerimity-web`, the one
  already at `origin/main`) — the settings toggle next to the existing Discord
  Activity block.

### Bridge module (`src/rpc/DiscordBridge.js`)

Pure Node, no `electron` import (so `node --test` can run it directly). Exports
`class DiscordBridge extends EventEmitter`.

Lifecycle:

- `start()` resolves candidate IPC endpoints, probes for a foreign Discord
  server first, and binds only when no foreign server answers. The current
  activity list is readable via `getRPCs()` and emitted as `"update"` on every
  change.
- `stop()` closes all listeners and sockets and drops every captured activity,
  emitting `"update"` with `[]` when it had any.
- While paused or running, a 10 s probe re-checks foreign servers: one answer
  anywhere we do not own pauses the bridge (Discord came back); all clear
  resumes it (Discord exited).

Candidate endpoints (index 0 for binding; probe indexes 0..9 on every candidate
directory so a Discord instance that moved to a later index is still detected):

- Windows: named pipe `\\.\pipe\discord-ipc-N`
- Linux: `$XDG_RUNTIME_DIR/discord-ipc-0`,
  `$XDG_RUNTIME_DIR/app/com.discordapp.Discord/discord-ipc-0`,
  `$XDG_RUNTIME_DIR/snap.discord/discord-ipc-0`, `$TMPDIR`/`os.tmpdir()`, `/tmp`
- macOS: `os.tmpdir()` (`$TMPDIR`), `/tmp`

A "foreign server" check is a plain `net.connect` to a candidate we do not own;
success means someone (Discord) is listening. On unix a path that exists but
refuses connections is a stale socket: unlink it, then bind.

Protocol (Discord IPC framing: `u32le opcode`, `u32le length`, JSON payload):

- Opcode 0 handshake `{"v":1,"client_id":...}` -> reply frame with
  `{"cmd":"DISPATCH","evt":"READY","data":{"v":1,"config":{...},"user":{...}}}`.
  No handshake within 3 s closes the connection.
- Opcode 1 frame: `SET_ACTIVITY` (args `{pid, activity}`) upserts or clears
  (activity null) one entry keyed `<connectionId>:<pid>` and replies echoing
  cmd/nonce; `SUBSCRIBE`/`UNSUBSCRIBE` and `GET_CURRENT_USER` get success
  replies; unknown commands get an `evt:"ERROR"` reply; malformed JSON closes.
- Opcode 2 close -> drop connection and its activities.
- Opcode 3 ping -> opcode 4 pong, payload echoed.
- Payloads above 1 MB close the connection.
- Connection close removes that connection's activities and emits an update.

Activity mapping to the Nerimity RPC shape (same field names and length limits
as `WebSocketRPCServer.sanitizedData`: name 30, action 20, imgSrc/title/subtitle
30-250 as there, link 250):

- `id`: `<connectionId>:<pid>`
- `name`: `activity.name`, else the process name resolved from `pid`
  (`/proc/<pid>/exe` on Linux, `ps -o comm=` on macOS, `tasklist` on Windows,
  cached per pid), else `"Unknown"`
- `action`: type 0 Playing, 1 Streaming, 2 Listening to, 3 Watching,
  5 Competing in; type 4 (Custom) entries are dropped, matching the remote
  tracker
- `imgSrc`: `assets.large_image` else `small_image`; `http(s)://` URLs kept,
  `spotify:<hex>` -> `https://i.scdn.co/image/<hex>`, 32-char hex app asset
  hashes -> `https://cdn.discordapp.com/app-assets/<client_id>/<hash>.png`,
  anything else (`mp:external/...`, keys we cannot resolve) dropped
- `title`: `details`, `subtitle`: `state`
- `link`: `sync_id` -> `https://open.spotify.com/track/<sync_id>`, else first
  button URL, else `url` on Streaming activities; only `http(s)://` URLs are
  kept, anything else dropped
- `startedAt` / `endsAt`: `timestamps.start` / `timestamps.end` in ms

### Wiring (desktop)

- `store.js`: `getDiscordRpcEnabled()` (default **false**) and
  `setDiscordRpcEnabled(value)` under key `discordRpcEnabled`.
- `mainWindow.js`:
  - `ipc.handle("get-discord-rpc-enabled")` / `ipc.on("set-discord-rpc-enabled")`;
    setting the flag starts or stops the bridge immediately.
  - On window open, if the flag is on, start the bridge before `loadURL` so
    early activities are not lost.
  - Re-emit the merged RPC list on `did-finish-load` (the page's
    `rpc-changed` listener only sees future updates).
  - `relaunch-app` stops the bridge alongside `stopRPCServer`.
- `preloaders/mainPreloader.js`: expose `getDiscordRpcEnabled()` /
  `setDiscordRpcEnabled(value)` on `WindowAPI`.
- `utils.js` owns the merge: `rpc-changed` now carries
  `[...(rpcServer?.RPCs ?? []), ...bridgeRPCs]` whenever either side changes,
  so the web app's existing `localRPC.updateElectronRPCs` path renders bridge
  activities with zero web-side data plumbing. Turning the toggle off emits the
  merged list without bridge entries (clearing them from the profile).
- The activity-listener suppression gate (`startActivityListener` early return)
  keeps keying off extension RPCs only; window-based activity status is a
  separate channel and is untouched.

### Toggle (web, `ActivityStatus.tsx`)

- New `SettingsBlock` directly under the existing Discord Activity block,
  rendered only when `electronWindowAPI()?.isElectron`, styled like the
  neighbouring blocks: label + description + `Checkbox`, `onClick` on the block
  toggles, state read from `getDiscordRpcEnabled()` on mount, changes written
  through `setDiscordRpcEnabled`.
- `src/common/Electron.ts`: add `getDiscordRpcEnabled(): Promise<boolean>` and
  `setDiscordRpcEnabled(value: boolean): void` to the `WindowAPI` interface.
- Strings in `src/locales/list/en-gb.json` (source locale; other languages fall
  back, Weblate picks them up later):
  - `settings.activity.discordRpcBridge`: "Discord Rich Presence (no Discord
    needed)"
  - `settings.activity.discordRpcBridgeDescription`: "Show what you are playing
    or listening to by capturing rich presence from apps on this computer.
    Works without Discord, and steps aside while the Discord app is running."

### Behaviour guarantees

- Off by default; nothing changes for existing users until they flip the
  toggle.
- Never fights the real Discord app: the bridge yields whenever any
  `discord-ipc-*` endpoint answers and takes over again within ~10 s of Discord
  exiting.
- Bridge activities and extension RPC activities share one `rpc-changed`
  list; neither source can clobber the other because both emit the merged list.

## [S3] Out of Scope

- Replacing or changing the existing "Discord Activity" tracker (paste your
  Discord ID) and the Last.fm tracker.
- Resolving Discord `mp:external/...` image URLs (undecryptable) or querying
  Discord's API for application names (needs auth).
- Sandboxed flatpak/snap clients whose sockets live in another mount namespace.
- Non-English locale files (Weblate owns those).
- Packaging/CI changes; making the bridge survive app quit (it dies with the
  app by design).

## Tasks

- [x] T1: DiscordBridge module with endpoint binding, foreign-Discord backoff, protocol handling, activity mapping — acceptance: `node --test src/rpc` passes, covering handshake -> READY, SET_ACTIVITY -> mapped entry, null activity / disconnect -> removal, foreign-server pause and resume (covers: S2; depends: —)
- [x] T2: Desktop wiring: store flag, IPC handlers, preloader API, merged `rpc-changed` emit, start/stop lifecycle — acceptance: `node --check` passes on every changed file, flag defaults to false, toggling on starts the bridge and off stops and clears it, `rpc-changed` payload contains extension + bridge entries merged (covers: S2; depends: T1)
- [x] T3: Web toggle: WindowAPI interface, settings block next to Discord Activity with electron gate, en-gb strings — acceptance: `npm run build` succeeds in the web worktree and the block reads/writes `getDiscordRpcEnabled`/`setDiscordRpcEnabled` (covers: S2; depends: T1 wiring contract T2)
