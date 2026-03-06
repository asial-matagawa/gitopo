# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Merge edge color now correctly reflects the source branch when the merged commit is a sub-branch commit (previously showed the destination key branch color instead)

## [0.0.5] - 2026-02-26

### Fixed

- Sub-branch overlap detection now correctly handles nested sub-branches (when one sub-branch is completely contained within another's time range)

## [0.0.4] - 2026-02-24

### Added

- Settings menu (gear icon in top right corner)
- Merge commit display style options (Circle, Filled square, Hollow square)
- Merge edge style options (Dashed, Solid) for second parent edges
- Sub-branch background rectangles to visually group commits
- Hover highlighting for sub-branch commits and rectangles
- Tag display in commit tooltip with tag icon
- Author display in commit tooltip after date
- Pull request display toggle in settings (default: ON)
- Lineage-based sub-branch detection: branches originating from a key branch (directly or indirectly) belong to that key branch's lineage

### Changed

- Sub-branches now allow merges from other key branches
- Sub-branch ownership determined by branch point (first commit's parent), not merge destination
- Edges from key branches into sub-branches now use the source key branch's color
- Tooltip now shows branches and tags below the date line with icons
- Sub-branches with merges from unknown branches are split into separate sub-branches
- Commits from the same parent are now placed in separate sub-branches (first-parent chain only)

### Fixed

- Sub-branch overlap detection now uses actual commit positions instead of branch point/merge commit only
- Stash refs excluded from commit graph
- Commits with the same parent are now correctly placed in separate sub-branches

### Removed

- Edge hover highlighting

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
