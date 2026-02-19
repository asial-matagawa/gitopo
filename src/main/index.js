const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5273');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
}

// Handle git command execution from renderer
ipcMain.handle('git:exec', async (event, args) => {
  try {
    const result = execSync(`git ${args}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle gh command execution from renderer
ipcMain.handle('gh:exec', async (event, args) => {
  try {
    const result = execSync(`gh ${args}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle config reading from package.json
ipcMain.handle('config:get', async () => {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return { success: true, config: {} };
    }
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return { success: true, config: packageJson.gitopo || {} };
  } catch (error) {
    return { success: false, error: error.message, config: {} };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
