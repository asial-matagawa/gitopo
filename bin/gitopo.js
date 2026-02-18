#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');
const mainPath = path.join(__dirname, '../src/main/index.js');

const child = spawn(electron, [mainPath], {
  stdio: 'inherit',
  cwd: process.cwd(),
});

child.on('close', (code) => {
  process.exit(code);
});
