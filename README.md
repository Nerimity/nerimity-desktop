# Nerimity Desktop

### Download Nerimity

[Click here](https://github.com/Nerimity/nerimity-desktop/releases/latest) to download the latest releasae.

### Building

#### Prerequisites

- Node.js (v16 or higher)
- npm (comes with Node.js)

#### Installation

```bash
npm install
```

#### Building Installers

To build the installer for your current platform:

```bash
npm run app:dist
```

The built installer will be created in the `dist/` folder.

**Platform-specific builds:**

- **Windows**: Creates an NSIS installer (`.exe`)
- **macOS**: Creates a DMG installer (`.dmg`) - requires macOS to build
- **Linux**: Creates `.deb`, `.AppImage` and Flatpak packages. The Flatpak build needs `flatpak`, `flatpak-builder` (>= 1.2.2) and `org.electronjs.Electron2.BaseApp` installed. Screen sharing uses the xdg-desktop-portal Screencast interface; grant it with `flatpak permission-set screencast screencast com.nerimity.desktop yes` if necessary.

To build for a specific platform:

```bash
npm run app:dist -- --win    # Windows
npm run app:dist -- --mac    # macOS
npm run app:dist -- --linux  # Linux
```

### Optional companion features (Linux-first)

The `injected/` folder adds a small set of opt-in tools to the running site:

- **Call chat reader (TTS)**: a button in the call bar reads new messages aloud. It uses an embedded Edge TTS client (`src/tts.js`) — no Python or `edge-tts` installation is required. Choose all messages or selected users, rate, locale and a custom voice in the panel; *Test voice* reports the effective voice and locale. Audio is streamed to `pw-play`, `ffplay`, `mpv`, `paplay` or `aplay` via stdin, so no temporary files are needed and Flatpak builds work through `flatpak-spawn --host`.
- **Screen share audio**: on Wayland the native portal picker is opened once per share instead of being triggered while listing sources. **Scan for audio apps** lists PipeWire output streams; selected apps are linked with venmic (an optional dependency) and Nerimity's own audio is always excluded. Without a selected app the system default audio is used.
- **Tray**: clicking the icon shows/hides the window; the menu also offers Reload and Open in browser. Closing the window keeps the app in the tray.

These features are injected at runtime and degrade gracefully if the site changes its selectors.

### Releasing

When you want to create a new release, follow these steps:

1. Update the version in your project's `package.json` file (e.g. `2.3.3`)
2. Commit that change (`git commit -am v2.3.3`)
3. Tag your commit (`git tag v2.3.3`).
4. Push your changes to GitHub (`git push && git push --tags`)

After building successfully, the action will publish your release artifacts. By default, a new release draft will be created on GitHub with download links for your app. If you want to change this behavior, have a look at the [`electron-builder` docs](https://www.electron.build).

https://github.com/samuelmeuli/action-electron-builder
