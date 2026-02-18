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
