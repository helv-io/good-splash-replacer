# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0]

### Added

- Phone page is the editor: pick an image and it previews one output per target with Fit, centered, black padding and no upscaling. Fit or Fill, size, move, background and black to transparent are under Adjust
- TV editor for library items: Fit, Fill, size, move, background, black to transparent with a threshold. Save, or save as new
- Report my TV: read-only diagnostics on screen, and a code that opens a prefilled GitHub issue
- Target sizes are read from the TV: the logo files the power-off screen uses and their real pixel sizes. Uploads are checked against them
- Library items keep their source image and settings, and are re-rendered when a TV needs other sizes
- Starter logo, seeded once
- Release workflow builds the ipk and a webosbrew manifest on each tag

### Fixed

- Back exits the app, and closes the editor or the report first
- The service restarts when the app is reinstalled with another version, and exits cleanly on SIGTERM
- Apply never writes to a mounted file and mounts each target once

## [0.1.0]

### Added

- Apply a logo to the power-off screen, Restore LG, and the power-off logo switch
- Upload from a phone on the same network
