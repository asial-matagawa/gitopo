#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');
const mainPath = path.join(__dirname, '../src/main/index.js');

// Spawn Electron in detached mode so it runs independently
const child = spawn(electron, [mainPath], {
  stdio: 'ignore',
  cwd: process.cwd(),
  detached: true,
});

// Allow the parent process to exit independently
child.unref();

// Exit immediately - Electron will continue running in background
process.exit(0);
