// ...existing code...
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
 import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * 创建一个终端实例
 * @param {HTMLElement} container - 终端将要挂载的DOM容器
 * @returns {Promise<Object>} 返回一个包含终端实例和相关方法的对象
 */
/**
 * 创建一个终端实例并设置相关功能
 * @param {HTMLElement} container - 终端将要挂载的DOM容器
 * @returns {Object} 返回一个包含终端实例和相关方法的对象
 */
export async function createTerminal(container) {
  console.log('Creating terminal in container', container);
  // 创建一个新的终端实例，配置列数、行数、光标闪烁和行尾转换等参数
  const term = new Terminal({
    cols: 80,
    rows: 24,
    cursorBlink: true,
    convertEol: true,
  });
  // 创建并加载自适应尺寸的插件
  const fit = new FitAddon();
  term.loadAddon(fit);
  // 打开终端并挂载到指定容器
  term.open(container);
  // 确保容器可聚焦并自动聚焦到终端，以便接收键盘输入
  try {
    // 使容器可聚焦（如果还没有）
    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '0');
    // 点击容器时聚焦终端
    container.addEventListener('click', () => term.focus());
    // 立即聚焦终端
    term.focus();
  } catch (e) {
    console.warn('无法设置聚焦到 xterm 容器', e);
  }
  try { 
    // 延迟一次 fit，保证容器已经布局完成
    fit.fit();
    setTimeout(() => { try { fit.fit(); } catch(e){} }, 50);
  } catch(e){}
   let inputBuffer = ''; // 尝试创建 PTY（如果后端实现了 pty_spawn）
  // 尝试创建 PTY（如果后端实现了 pty_spawn）
  let ptyId = null;
  try {
    ptyId = await invoke('pty_spawn', { cmd: '/bin/bash', args: [] });
    console.log('[terminal] pty spawned id=', ptyId);
  } catch (e) {
    console.warn('[terminal] pty_spawn not available, falling back to run_command', e);
    ptyId = null;
  }

  // 监听后端事件（若后端通过事件推送 pty 输出）
  let unlistenHandler = null;
  if (ptyId) {
    unlistenHandler = await listen('pty-output', event => {
      try {
        const p = event.payload; // { id, data }
        if (p && p.id === ptyId) {
          term.write(p.data);
        }
      } catch (err) {
        console.error('pty-output handler error', err);
      }
    });
  }

  // 当用户在 xterm 中输入
  term.onData(async (data) => {
    // 立即回显用户输入到终端
    term.write(data);
    
    if (ptyId) {
      // 写入 pty
      try {
        await invoke('pty_write', { id: ptyId, data });
      } catch (err) {
        console.error('pty_write failed', err);
      }
    } else {
      // 无 pty 时，简单回车触发 run_command（命令以换行为分割）
      // 这里将收到的 data 可能包含回车，合并到缓冲并在遇到 \r 或 \n 时发送
      inputBuffer += data;
      if (data === '\r' || data === '\n') {
        const cmd = inputBuffer.trim();
        inputBuffer = '';
        if (!cmd) {
          term.write('\r\n');
          return;
        }
        try {
          const out = await invoke('run_command', { cmd });
          term.write(out + '\r\n');
        } catch (err) {
          term.write(`[error] ${String(err)}\r\n`);
        }
      }
    }
  });


  // 改变尺寸时适配
  window.addEventListener('resize', () => {
    try { fit.fit(); } catch (e) {}
  });

  // 返回可供外部调用的 API
  return {
    term,
    async destroy() {
      if (unlistenHandler) {
        try { await unlistenHandler(); } catch (e) {}
      }
      try { term.dispose(); } catch (e) {}
       if (ptyId) {
        try { await invoke('pty_kill', { id: ptyId }); } catch(e) {}
      }
    },
    async write(data) {
      term.write(data);
    },
  };
}
