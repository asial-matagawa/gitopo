# gitopo

Topology-preserving Git commit graph visualizer that highlights key branches.

## Overview

gitopo visualizes Git commit history with special treatment for mainline branches (master, main, release, develop, etc.) following Git Flow, GitHub Flow, and GitLab Flow conventions.

Built with Electron, Vite, and D3.js.

## Usage

```bash
npx gitopo
```

Or install globally:

```bash
npm install -g gitopo
```

## Configuration

Add a `gitopo` key to your project's `package.json` to configure default branch selectors:

```json
{
  "name": "your-project",
  "gitopo": {
    "keyBranches": ["origin/main", "origin/staging", "origin/production"]
  }
}
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `keyBranches` | `string[]` | Default branches for the 3 branch selectors (in order) |

If `keyBranches` is not specified, gitopo will default to `main` or `master` for the first selector.

## Development

```bash
# Install dependencies
npm install

# Start Vite dev server
npm run dev

# In another terminal, start Electron in dev mode
npm run electron:dev

# Build for production
npm run build

# Run production build
npx gitopo
```

## License

MIT
