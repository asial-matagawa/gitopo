# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.0.3] - 2026-02-20

### Added

- Refresh button next to repository name (fetches from remotes and reloads graph)
- Keyboard shortcut Ctrl+R / Cmd+R for refresh

### Changed

- Improved sub-branch detection algorithm: sub-branches are now assigned to key branches based on merge destination
- Improved sub-branch layout: uses span from branch point to merge commit for collision detection

## [0.0.2] - 2026-02-19

### Added

- Troubleshooting section in README for Electron install issue

## [0.0.1] - 2026-02-19

### Added

- Initial release
- Key branch columns with color-coded display (green, blue, orange)
- Sub-branch detection from merge commits
- Pull request display via GitHub CLI
- Time axis zoom with Ctrl/Cmd + scroll
- Pan navigation with scroll and drag
- Configurable commit limit (1 to 100,000,000)
- Loading screen with progress messages
- Responsive UI controls
- Configuration via `package.json` gitopo key
