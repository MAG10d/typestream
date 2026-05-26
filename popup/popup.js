// TypeStream - Popup Script

(function() {
  'use strict';

  const statusDot = document.getElementById('ts-status-dot');
  const statusText = document.getElementById('ts-status-text');
  const gotoBtn = document.getElementById('ts-goto-yt');
  const toggleBtn = document.getElementById('ts-toggle-overlay');
  const toggleText = document.getElementById('ts-toggle-text');
  const reportBtn = document.getElementById('ts-report-bug');

  // Check current tab
  async function checkStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
        statusDot.className = 'ts-dot active';
        statusText.textContent = 'Ready — YouTube video detected';

        // Check if panel is injected
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
          if (response && response.active) {
            toggleText.textContent = 'Restart Typing Panel';
          } else {
            toggleText.textContent = 'Show Typing Panel';
          }
        } catch (e) {
          toggleText.textContent = 'Show Typing Panel';
        }

        gotoBtn.style.display = 'none';
        toggleBtn.style.display = 'block';
      } else {
        statusDot.className = 'ts-dot';
        statusText.textContent = 'Open a YouTube video to start';
        gotoBtn.style.display = 'block';
        toggleBtn.style.display = 'none';
      }
    } catch (e) {
      statusDot.className = 'ts-dot error';
      statusText.textContent = 'Error detecting status';
    }
  }

  // Go to YouTube
  gotoBtn.addEventListener('click', () => {
    chrome.tabs.update({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  });

  // Toggle overlay
  toggleBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
      window.close();
    } catch (e) {
      // Content script not loaded, try injecting
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.reload(tab.id);
      window.close();
    }
  });

  // Report bug
  reportBtn.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/typestream/typestream/issues/new' });
  });

  // Initial check
  checkStatus();
})();
