# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3]

### Changed

- Full screen: logos are rendered at the size of the screen the power-off logo is shown on, read from the TV, instead of the small stock logo box. Fit pads with black, Fill covers the screen, smaller images stay centered at their own size
- Report my TV lists the full-screen size and the stock logo size of each file

## [0.2.2]

### Added

- Magic Remote pointer: hover focuses, click chooses, a click outside a menu or dialog closes it, and the wheel scrolls the logos. Arrows continue from where the pointer left off

## [0.2.1]

### Changed

- No color buttons needed: OK on a logo opens Apply, Edit, Delete and Cancel. Delete asks first with Cancel focused. Back closes the menu or dialog, then exits

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
