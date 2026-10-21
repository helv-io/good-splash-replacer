# AGENT.md

Guidelines for changes to Good Splash Replacer. Applies to code, UI, docs and releases.

## Product principle

Best setting is no setting. Picking an image and pressing Send must give the right result on any supported TV.

- Nothing about the TV is hardcoded: the service reads the logo files the power-off screen uses and their sizes at run time. `KNOWN` in `service/server.js` is a fallback hint only.
- Sizing rules live once, in `app/render.js`, shared by the phone page and the TV editor: Fit by default, centered, no upscaling, black padding.
- Never write to flash or a block device. Changes are bind mounts over files and are undone by Restore LG. Never reboot the TV.

## Style

- UI copy: short, plain, direct. No parentheticals, no em dashes, no marketing words. Errors are lowercase with no final period.
- Remote first: every control is reachable with the arrow keys and OK; Back closes what is open, then exits.
- No house-specific names, addresses or host names in code, docs or examples.

## Security

- The service listens on the local network only. Uploads are size-limited and checked; anything that changes the TV is allowed from the TV itself only.
- The TV report never includes serial numbers, MAC or IP addresses, or account data.

## Code

- Small commits with a message body. One concern per commit.
- Tests are required. `tools/chk.sh` runs syntax checks, the unit tests (a skipped test fails) and the ipk build, the same as CI.
- README is for user-visible things. Update it and `CHANGELOG.md` in the same change as the feature.

## Release

The default branch is `master`.

1. Run `tools/release X.Y.Z`. It bumps `app/appinfo.json` and `package.json`, proves they agree, runs `tools/chk.sh`, commits `Version X.Y.Z` and tags `vX.Y.Z`.
2. Push `master`, wait for CI and agent-checks to be green, then push the tag.
3. The Release workflow checks the version, builds the ipk and the webosbrew manifest, and attaches both to the Release page.

Before you push, run `tools/chk.sh` and `.agent-checks/bin/agent-checks local`.
