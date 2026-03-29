/**
 * 终端模块 - 提供终端功能并与文件管理器同步工作目录
 * 
 * 主要功能：
 * 1. 创建和管理 xterm 终端实例
 * 2. 支持 PTY（伪终端）和回退命令执行模式
 * 3. 与文件管理器同步工作目录
 * 4. 处理用户输入和命令执行
 */

import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// 全局状态变量
let currentWorkingDirectory = '/'; // 当前工作目录
let onDirectoryChange = null;     // 目录变化回调函数

/**
 * 创建一个终端实例
 * @param {HTMLElement} container - 终端将要挂载的DOM容器
 * @param {Object} options - 配置选项
 * @param {number} options.opacity - 终端透明度 (0-1)
 * @returns {Promise<Object>} 返回终端API对象
 */
export async function createTerminal(container, options = {}) {
  console.log('正在创建终端实例，容器:', container, '选项:', options);

  // 配置终端透明度，默认为不透明
  const opacity = options.opacity !== undefined ? options.opacity : 1;
  
  // 创建 xterm 终端实例
  const term = new Terminal({
    cols: 80,
    rows: 24,
    cursorBlink: true,
    convertEol: true,
    allowTransparency: true,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 18,
    fontWeight: 'normal',
    fontWeightBold: 'bold',
    lineHeight: 1.2,
    theme: {
      background: `rgba(0, 0, 0, ${opacity})`,
      foreground: '#ffffff',
      cursor: '#ffffff',
      cursorAccent: '#000000'
    }
  });

  // 加载自适应尺寸插件
  const fit = new FitAddon();
  term.loadAddon(fit);
  
  // 打开终端并挂载到容器
  term.open(container);

  // 设置终端容器透明度
  if (opacity < 1) {
    container.style.backgroundColor = `rgba(0, 0, 0, ${opacity})`;
    const xtermElement = container.querySelector('.xterm');
    if (xtermElement) {
      xtermElement.style.setProperty('--xterm-background-color', `rgba(0, 0, 0, ${opacity})`);
    }
  }

  // 设置终端焦点
  try {
    if (!container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '0');
    }
    container.addEventListener('click', () => term.focus());
    term.focus();
  } catch (e) {
    console.warn('无法设置终端焦点:', e);
  }

  // 延迟调整终端尺寸以确保容器布局完成
  setTimeout(() => {
    try {
      fit.fit();
    } catch (e) {
      console.error('调整终端尺寸失败:', e);
    }
  }, 100);

  // 终端状态变量
  let inputBuffer = '';
  let ptyId = null;
  let ptyValid = false;
  let unlistenOutput = null;
  let unlistenClosed = null;

  /**
   * 调整PTY尺寸以匹配终端当前尺寸
   */
  async function resizePty() {
    if (ptyId && ptyValid) {
      try {
        const cols = term.cols;
        const rows = term.rows;
        await invoke('pty_resize', { id: ptyId, cols, rows });
      } catch (err) {
        console.error('调整PTY尺寸失败:', err);
      }
    }
  }

  // 尝试创建PTY（伪终端）
  try {
    ptyId = await invoke('pty_spawn', { cmd: '/bin/sh', args: ['-l'] });
    console.log('PTY创建成功，ID:', ptyId);
    
    if (typeof ptyId !== 'number') {
      throw new Error(`无效的PTY ID: ${ptyId} (类型: ${typeof ptyId})`);
    }
    
    ptyValid = true;
    await resizePty(); // 初始设置PTY尺寸
  } catch (e) {
    console.warn('PTY创建失败，使用回退模式:', e);
    ptyId = null;
  }

  // 监听PTY输出事件
  if (ptyId) {
    unlistenOutput = await listen('pty-output', event => {
      try {
        const p = event.payload;
        if (p && p.id === ptyId && ptyValid) {
          term.write(p.data);
        }
      } catch (err) {
        console.error('处理PTY输出失败:', err);
      }
    });

    // 监听PTY关闭事件
    unlistenClosed = await listen('pty-closed', event => {
      try {
        const p = event.payload;
        if (p && p.id === ptyId) {
          console.log('PTY已关闭，ID:', ptyId);
          ptyValid = false;
          term.write('\r\n[进程已退出]\r\n');
          
          // 清理事件监听
          if (unlistenOutput) {
            unlistenOutput();
            unlistenOutput = null;
          }
          if (unlistenClosed) {
            unlistenClosed();
            unlistenClosed = null;
          }
        }
      } catch (err) {
        console.error('处理PTY关闭事件失败:', err);
      }
    });
  }

  /**
   * 处理用户输入
   * 支持两种模式：PTY模式和非PTY模式
   */
  term.onData(async (data) => {
    // 处理功能键
    if (data === '\x1b[24~') { // F12键
      const leftPanel = document.querySelector('.left-panel');
      if (leftPanel) {
        leftPanel.classList.toggle('system-monitor-hidden');
      }
      return;
    }

    if (data === '\x1b[23~') { // F11键
      const fileManager = (await import('./fileManager.js')).fileManager;
      if (fileManager) {
        fileManager.toggle();
      }
      return;
    }

    // PTY模式处理
    if (ptyId && ptyValid) {
      // 检查是否是回车键，处理可能的cd命令
      if (data === '\r' || data === '\n') {
        const lines = inputBuffer.split('\n');
        const lastLine = lines[lines.length - 1] || inputBuffer;
        const cmd = lastLine.trim();
        
        // 检测并处理cd命令
        if (cmd.startsWith('cd ')) {
          await handleCdCommand(cmd.substring(3).trim());
        }
        
        inputBuffer = ''; // 重置输入缓冲区
      } else {
        inputBuffer += data; // 累积输入到缓冲区
      }
      
      // 写入数据到PTY
      try {
        await invoke('pty_write', { id: ptyId, data });
      } catch (err) {
        console.error('写入PTY失败:', err);
        if (String(err).includes('no longer valid') || String(err).includes('not found')) {
          ptyValid = false;
          term.write('\r\n[终端已关闭]\r\n');
          if (unlistenOutput) { unlistenOutput(); unlistenOutput = null; }
          if (unlistenClosed) { unlistenClosed(); unlistenClosed = null; }
        }
      }
    } 
    // 非PTY模式处理
    else if (!ptyId) {
      inputBuffer += data;
      
      if (data === '\r' || data === '\n') {
        const cmd = inputBuffer.trim();
        inputBuffer = '';
        
        if (!cmd) {
          term.write('\r\n');
          return;
        }
        
        try {
          // 检测并处理cd命令
          if (cmd.startsWith('cd ')) {
            await handleCdCommand(cmd.substring(3).trim());
            return;
          }

          // 执行其他命令
          const out = await invoke('run_curdir_command', { cmd });
          term.write(out + '\r\n');
        } catch (err) {
          term.write(`[错误] ${String(err)}\r\n`);
        }
      }
    } 
    // PTY已关闭
    else {
      term.write('\r\n[终端已关闭，输入被忽略]\r\n');
    }
  });

  /**
   * 处理cd命令，更新工作目录
   * @param {string} newPath - 新路径
   */
  async function handleCdCommand(newPath) {
    // 处理相对路径
    let targetPath = newPath;
    if (!newPath.startsWith('/')) {
      if (newPath === '..') {
        // 上级目录
        const parts = currentWorkingDirectory.split('/');
        parts.pop();
        targetPath = parts.join('/') || '/';
      } else if (newPath === '.') {
        // 当前目录
        targetPath = currentWorkingDirectory;
      } else {
        // 相对路径
        targetPath = currentWorkingDirectory === '/' 
          ? `/${newPath}` 
          : `${currentWorkingDirectory}/${newPath}`;
      }
    }
    
    try {
      // 更新后端全局工作目录
      await invoke('set_current_working_dir', { path: targetPath });
      
      // 更新前端变量
      currentWorkingDirectory = targetPath;
      
      // 通知目录变化
      if (onDirectoryChange) {
        onDirectoryChange(currentWorkingDirectory);
      }
      
      term.write(`\r\n`);
    } catch (err) {
      term.write(`cd: ${String(err)}\r\n`);
    }
  }

  // 窗口大小变化时调整终端尺寸
  const resizeHandler = () => {
    try {
      fit.fit();
      resizePty();
    } catch (e) {
      console.error('调整尺寸失败:', e);
    }
  };
  
  window.addEventListener('resize', resizeHandler);

  // 返回终端API对象
  return {
    term,        // xterm终端实例
    ptyId,       // PTY ID（如果有）
    ptyValid,    // PTY是否有效
    
    /**
     * 销毁终端，清理资源
     */
    async destroy() {
      // 清理事件监听
      if (unlistenOutput) {
        try { await unlistenOutput(); } catch (e) {}
        unlistenOutput = null;
      }
      if (unlistenClosed) {
        try { await unlistenClosed(); } catch (e) {}
        unlistenClosed = null;
      }
      
      // 关闭PTY
      if (ptyId && ptyValid) {
        try { await invoke('pty_kill', { id: ptyId }); } catch(e) {}
      }
      
      // 销毁终端
      try { term.dispose(); } catch (e) {}
      
      // 移除窗口大小监听
      window.removeEventListener('resize', resizeHandler);
    },
    
    /**
     * 向终端写入数据
     * @param {string} data - 要写入的数据
     */
    async write(data) {
      term.write(data);
    },
  };
}

/**
 * 设置目录变化回调函数
 * @param {Function} callback - 回调函数，接收新路径作为参数
 */
export function setOnDirectoryChange(callback) {
  onDirectoryChange = callback;
}

/**
 * 获取当前工作目录
 * @returns {string} 当前工作目录路径
 */
export function getCurrentWorkingDirectory() {
  return currentWorkingDirectory;
}

/**
 * 设置当前工作目录
 * @param {string} path - 新工作目录路径
 */
export function setCurrentWorkingDirectory(path) {
  currentWorkingDirectory = path;
  if (onDirectoryChange) {
    onDirectoryChange(path);
  }
}
