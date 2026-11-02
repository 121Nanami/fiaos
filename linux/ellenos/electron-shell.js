// Small Electron window for one FiaOS app. Used when ellen-app is not on PATH.
'use strict';
const { app, BrowserWindow } = require('electron');
const url = process.argv.slice(2).find(a => /^https?:\/\//.test(a)) || 'http://127.0.0.1:8080/apps.html';
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    autoHideMenuBar: true,
    backgroundColor: '#070a14',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadURL(url).catch(err => {
    win.loadURL('data:text/html,' + encodeURIComponent('<p style="font:18px sans-serif">Could not open ' + url + '<br>' + err.message + '</p>'));
  });
});
app.on('window-all-closed', () => app.quit());
