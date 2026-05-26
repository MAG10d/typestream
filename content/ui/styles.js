// TypeStream - UI Styles
// MonkeyType-inspired dark theme injected into Shadow DOM.

(function(global) {
  'use strict';

  global.TypeStreamStyles = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');

    :host {
      all: initial;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .ts-container {
      font-family: 'JetBrains Mono', 'Roboto Mono', 'Cascadia Code', monospace;
      background: #1a1a1a;
      border-radius: 8px;
      padding: 16px 20px;
      color: #d1d0ce;
      user-select: none;
      width: 100%;
      position: relative;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
      border: 1px solid #2a2a2a;
    }

    .ts-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #2a2a2a;
    }

    .ts-title {
      font-size: 13px;
      font-weight: 600;
      color: #e2b714;
      letter-spacing: 0.5px;
      cursor: grab;
    }

    .ts-title:active {
      cursor: grabbing;
    }

    .ts-header-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .ts-btn {
      background: none;
      border: 1px solid #333;
      color: #646669;
      cursor: pointer;
      padding: 3px 8px;
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
      transition: all 0.15s;
    }

    .ts-btn:hover {
      color: #d1d0ce;
      border-color: #555;
    }

    .ts-btn.active {
      color: #e2b714;
      border-color: #e2b714;
    }

    .ts-stats {
      display: flex;
      gap: 20px;
      margin-bottom: 16px;
    }

    .ts-stat {
      display: flex;
      flex-direction: column;
    }

    .ts-stat-value {
      font-size: 28px;
      font-weight: 700;
      color: #e2b714;
      line-height: 1.1;
    }

    .ts-stat-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #646669;
    }

    .ts-typing-area {
      position: relative;
      min-height: 60px;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      align-content: flex-start;
      gap: 6px;
      padding: 8px 0;
      transition: filter 0.2s;
    }

    .ts-typing-area.paused {
      filter: blur(2px);
      opacity: 0.5;
    }

    .ts-word {
      display: inline-flex;
      position: relative;
      font-size: 20px;
      line-height: 1.5;
      transition: color 0.1s;
    }

    .ts-word.untyped {
      color: #646669;
    }

    .ts-word.correct {
      color: #d1d0ce;
    }

    .ts-word.current {
      position: relative;
    }

    .ts-word.current::after {
      content: '';
      position: absolute;
      left: 0;
      bottom: 2px;
      width: 100%;
      height: 2px;
      background: #e2b714;
      animation: ts-cursor-blink 1s infinite;
    }

    @keyframes ts-cursor-blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }

    .ts-word.incorrect {
      color: #ca4754;
      text-decoration: underline;
      text-decoration-color: #ca4754;
    }

    .ts-char {
      display: inline;
    }

    .ts-char.correct {
      color: #d1d0ce;
    }

    .ts-char.incorrect {
      color: #ca4754;
      background: rgba(202, 71, 84, 0.15);
      border-radius: 2px;
    }

    .ts-char.untyped {
      color: #646669;
    }

    .ts-settings {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid #2a2a2a;
      display: none;
    }

    .ts-settings.open {
      display: block;
    }

    .ts-settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 12px;
    }

    .ts-settings-label {
      color: #646669;
    }

    .ts-toggle {
      position: relative;
      width: 36px;
      height: 20px;
      cursor: pointer;
    }

    .ts-toggle input {
      display: none;
    }

    .ts-toggle-slider {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #333;
      border-radius: 10px;
      transition: 0.2s;
    }

    .ts-toggle-slider::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      left: 2px;
      top: 2px;
      background: #646669;
      border-radius: 50%;
      transition: 0.2s;
    }

    .ts-toggle input:checked + .ts-toggle-slider {
      background: #e2b714;
    }

    .ts-toggle input:checked + .ts-toggle-slider::before {
      transform: translateX(16px);
      background: #1a1a1a;
    }

    .ts-slider-input {
      -webkit-appearance: none;
      width: 100px;
      height: 4px;
      background: #333;
      border-radius: 2px;
      outline: none;
    }

    .ts-slider-input::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      background: #e2b714;
      border-radius: 50%;
      cursor: pointer;
    }

    .ts-toast {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 99999;
      background: #2a2a2a;
      color: #d1d0ce;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      border-left: 3px solid #ca4754;
      animation: ts-toast-in 0.3s ease-out;
      pointer-events: none;
    }

    @keyframes ts-toast-in {
      from {
        opacity: 0;
        transform: translateX(20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .ts-empty-state {
      text-align: center;
      padding: 30px 20px;
      color: #646669;
    }

    .ts-empty-state .ts-empty-icon {
      font-size: 36px;
      margin-bottom: 12px;
      opacity: 0.6;
    }

    .ts-empty-state .ts-empty-text {
      font-size: 14px;
      line-height: 1.6;
    }

    .ts-empty-state .ts-empty-subtext {
      font-size: 11px;
      margin-top: 6px;
      opacity: 0.7;
    }

    .ts-empty-state .ts-empty-btn {
      margin-top: 14px;
      background: #e2b714;
      color: #1a1a1a;
      border: none;
      padding: 6px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      transition: opacity 0.15s;
    }

    .ts-empty-state .ts-empty-btn:hover {
      opacity: 0.85;
    }
  `;

})(typeof globalThis !== 'undefined' ? globalThis : window);
