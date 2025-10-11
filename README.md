# Nerimity Desktop

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
- **Linux**: Creates both `.deb` and `.AppImage` packages

To build for a specific platform:
```bash
npm run app:dist -- --win    # Windows
npm run app:dist -- --mac    # macOS
npm run app:dist -- --linux  # Linux
```



### Releasing

When you want to create a new release, follow these steps:

1. Update the version in your project's `package.json` file (e.g. `1.7.2`)
2. Commit that change (`git commit -am v1.7.2`)
3. Tag your commit (`git tag v1.7.2`).
4. Push your changes to GitHub (`git push && git push --tags`)

After building successfully, the action will publish your release artifacts. By default, a new release draft will be created on GitHub with download links for your app. If you want to change this behavior, have a look at the [`electron-builder` docs](https://www.electron.build).

https://github.com/samuelmeuli/action-electron-builder
