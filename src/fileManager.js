/**
 * 文件管理器模块 - 提供文件浏览功能并与终端同步工作目录
 * 
 * 主要功能：
 * 1. 创建和管理文件管理器界面
 * 2. 浏览文件和目录
 * 3. 支持列表和网格两种视图模式
 * 4. 与终端同步工作目录
 * 5. 提供导航历史记录
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * 文件管理器类
 */
class FileManager {
  constructor() {
    // DOM元素
    this.panel = null;          // 文件管理器面板
    this.pathDisplay = null;    // 路径显示区域
    this.content = null;        // 内容区域
    this.closeBtn = null;       // 关闭按钮
    
    // 状态变量
    this.currentPath = '/';     // 当前路径
    this.isVisible = false;     // 是否可见
    this.pathHistory = ['/'];   // 路径历史记录
    this.historyIndex = 0;      // 当前历史记录索引
    this.viewMode = 'list';     // 视图模式：'list' 或 'grid'
    this.onPathChange = null;   // 路径变化回调函数
  }

  /**
   * 初始化文件管理器
   */
  init() {
    this.createPanel();
    this.setupKeyboardListeners();
  }

  /**
   * 创建文件管理器面板
   */
  createPanel() {
    // 创建主面板
    this.panel = document.createElement('div');
    this.panel.className = 'file-manager-panel hidden';
    
    // 创建头部
    const header = this.createHeader();
    
    // 创建内容区域
    this.content = document.createElement('div');
    this.content.className = 'file-manager-content';
    
    // 组装面板
    this.panel.appendChild(header);
    this.panel.appendChild(this.content);
    
    // 添加到DOM
    const rightPanel = document.querySelector('.right-panel');
    if (rightPanel) {
      rightPanel.appendChild(this.panel);
    }
  }

  /**
   * 创建文件管理器头部
   * @returns {HTMLElement} 头部元素
   */
  createHeader() {
    const header = document.createElement('div');
    header.className = 'file-manager-header';
    
    // 导航按钮
    const navButtons = this.createNavigationButtons();
    
    // 视图切换按钮
    const viewButtons = this.createViewButtons();
    
    // 路径输入框
    const pathInput = this.createPathInput();
    
    // 路径显示区域
    this.pathDisplay = document.createElement('div');
    this.pathDisplay.className = 'file-manager-path';
    this.pathDisplay.textContent = this.currentPath;
    
    // 关闭按钮
    this.closeBtn = document.createElement('button');
    this.closeBtn.className = 'close-btn';
    this.closeBtn.innerHTML = '&times;';
    this.closeBtn.addEventListener('click', () => this.hide());
    
    // 组装头部
    header.appendChild(navButtons);
    header.appendChild(viewButtons);
    header.appendChild(pathInput);
    header.appendChild(this.pathDisplay);
    header.appendChild(this.closeBtn);
    
    return header;
  }

  /**
   * 创建导航按钮
   * @returns {HTMLElement} 导航按钮容器
   */
  createNavigationButtons() {
    const navButtons = document.createElement('div');
    navButtons.className = 'nav-buttons';
    
    // 后退按钮
    const backBtn = this.createButton('←', '后退', () => this.goBack());
    
    // 前进按钮
    const forwardBtn = this.createButton('→', '前进', () => this.goForward());
    
    // 上级目录按钮
    const upBtn = this.createButton('↑', '上级目录', () => this.goUp());
    
    // 刷新按钮
    const refreshBtn = this.createButton('↻', '刷新', () => this.refresh());
    
    // 添加按钮到容器
    navButtons.appendChild(backBtn);
    navButtons.appendChild(forwardBtn);
    navButtons.appendChild(upBtn);
    navButtons.appendChild(refreshBtn);
    
    return navButtons;
  }

  /**
   * 创建视图切换按钮
   * @returns {HTMLElement} 视图按钮容器
   */
  createViewButtons() {
    const viewButtons = document.createElement('div');
    viewButtons.className = 'view-buttons';
    
    // 列表视图按钮
    const listViewBtn = this.createButton('≣', '列表视图', () => this.setViewMode('list'));
    listViewBtn.className = 'view-btn active';
    
    // 网格视图按钮
    const gridViewBtn = this.createButton('▦', '网格视图', () => this.setViewMode('grid'));
    gridViewBtn.className = 'view-btn';
    
    viewButtons.appendChild(listViewBtn);
    viewButtons.appendChild(gridViewBtn);
    
    return viewButtons;
  }

  /**
   * 创建路径输入框
   * @returns {HTMLElement} 路径输入框
   */
  createPathInput() {
    const pathInput = document.createElement('input');
    pathInput.className = 'path-input';
    pathInput.type = 'text';
    pathInput.value = this.currentPath;
    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.navigateToPath(pathInput.value);
      }
    });
    
    return pathInput;
  }

  /**
   * 创建通用按钮
   * @param {string} text - 按钮文本
   * @param {string} title - 按钮标题
   * @param {Function} onClick - 点击事件处理函数
   * @returns {HTMLButtonElement} 按钮元素
   */
  createButton(text, title, onClick) {
    const button = document.createElement('button');
    button.className = 'nav-btn';
    button.innerHTML = text;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * 设置键盘事件监听
   */
  setupKeyboardListeners() {
    // 全局F11键监听
    document.addEventListener('keydown', (event) => {
      if (event.key === 'F11') {
        event.preventDefault();
        this.toggle();
      }
    });
    
    // 终端区域F11键监听
    const terminalContainer = document.getElementById('xterm-container');
    if (terminalContainer) {
      terminalContainer.addEventListener('keydown', (event) => {
        if (event.key === 'F11') {
          event.preventDefault();
          this.toggle();
        }
      });
    }
  }

  /**
   * 显示文件管理器
   */
  show() {
    if (!this.isVisible) {
      this.panel.classList.remove('hidden');
      this.isVisible = true;
      this.loadDirectory(this.currentPath);
    }
  }

  /**
   * 隐藏文件管理器
   */
  hide() {
    if (this.isVisible) {
      this.panel.classList.add('hidden');
      this.isVisible = false;
    }
  }

  /**
   * 切换文件管理器显示状态
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * 导航到指定路径
   * @param {string} path - 目标路径
   */
  async navigateToPath(path) {
    try {
      // 规范化路径
      let normalizedPath = path;
      if (!normalizedPath.startsWith('/')) {
        // 处理相对路径
        normalizedPath = this.currentPath === '/' 
          ? `/${normalizedPath}` 
          : `${this.currentPath}/${normalizedPath}`;
      }
      
      // 加载目录
      await this.loadDirectory(normalizedPath);
      
      // 更新路径输入框
      const pathInput = this.panel.querySelector('.path-input');
      if (pathInput) {
        pathInput.value = normalizedPath;
      }
    } catch (error) {
      console.error('导航到路径失败:', error);
      this.showError(`导航到路径失败: ${error}`);
    }
  }

  /**
   * 后退到上一个路径
   */
  goBack() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const path = this.pathHistory[this.historyIndex];
      this.loadDirectory(path, false); // false表示不添加到历史记录
    }
  }

  /**
   * 前进到下一个路径
   */
  goForward() {
    if (this.historyIndex < this.pathHistory.length - 1) {
      this.historyIndex++;
      const path = this.pathHistory[this.historyIndex];
      this.loadDirectory(path, false); // false表示不添加到历史记录
    }
  }

  /**
   * 上级目录
   */
  goUp() {
    if (this.currentPath === '/') {
      return; // 已经在根目录
    }
    
    const parentPath = this.currentPath.substring(0, this.currentPath.lastIndexOf('/'));
    this.navigateToPath(parentPath === '' ? '/' : parentPath);
  }

  /**
   * 刷新当前目录
   */
  refresh() {
    this.loadDirectory(this.currentPath, false); // false表示不添加到历史记录
  }

  /**
   * 加载目录内容
   * @param {string} path - 目录路径
   * @param {boolean} addToHistory - 是否添加到历史记录
   */
  async loadDirectory(path, addToHistory = true) {
    try {
      // 更新当前路径
      this.currentPath = path;
      this.pathDisplay.textContent = path;
      
      // 更新路径输入框
      const pathInput = this.panel.querySelector('.path-input');
      if (pathInput) {
        pathInput.value = path;
      }
      
      // 管理历史记录
      if (addToHistory) {
        this.updateHistory(path);
      }
      
      // 通知路径变化
      if (this.onPathChange && addToHistory) {
        this.onPathChange(path);
      }
      
      // 获取目录内容
      const files = await invoke('list_directory', { path });
      
      // 根据视图模式渲染
      if (this.viewMode === 'list') {
        this.renderFileList(files);
      } else {
        this.renderFileGrid(files);
      }
    } catch (error) {
      console.error('加载目录失败:', error);
      this.showError(`加载目录失败: ${error}`);
    }
  }

  /**
   * 更新历史记录
   * @param {string} path - 新路径
   */
  updateHistory(path) {
    // 如果我们在历史记录中间，删除当前位置之后的所有记录
    if (this.historyIndex < this.pathHistory.length - 1) {
      this.pathHistory = this.pathHistory.slice(0, this.historyIndex + 1);
    }
    
    // 添加新路径到历史记录
    this.pathHistory.push(path);
    this.historyIndex = this.pathHistory.length - 1;
  }

  /**
   * 显示错误信息
   * @param {string} message - 错误信息
   */
  showError(message) {
    this.content.innerHTML = `<div class="error-message">${message}</div>`;
  }

  /**
   * 渲染文件列表（列表视图）
   * @param {Array} files - 文件列表
   */
  renderFileList(files) {
    this.content.innerHTML = '';
    this.content.className = 'file-manager-content list-view';
    
    if (!files || files.length === 0) {
      this.content.innerHTML = '<div class="empty-message">目录为空</div>';
      return;
    }
    
    const table = document.createElement('table');
    table.className = 'file-list-table';
    
    // 表头
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>名称</th><th>大小</th><th>类型</th>';
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // 表体
    const tbody = document.createElement('tbody');
    
    // 添加上级目录链接（如果不是根目录）
    if (this.currentPath !== '/') {
      const parentRow = this.createParentDirectoryRow();
      tbody.appendChild(parentRow);
    }
    
    // 添加文件和目录
    files.forEach(file => {
      const row = this.createFileRow(file);
      tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    this.content.appendChild(table);
  }

  /**
   * 创建上级目录行
   * @returns {HTMLTableRowElement} 表格行
   */
  createParentDirectoryRow() {
    const row = document.createElement('tr');
    row.className = 'file-item directory';
    
    const nameCell = document.createElement('td');
    nameCell.className = 'file-name';
    
    const iconContainer = document.createElement('span');
    iconContainer.className = 'file-icon';
    iconContainer.innerHTML = '📁';
    
    const textNode = document.createTextNode(' ..');
    
    nameCell.appendChild(iconContainer);
    nameCell.appendChild(textNode);
    
    row.appendChild(nameCell);
    row.innerHTML += '<td>-</td><td>目录</td>';
    
    row.addEventListener('click', () => this.goUp());
    
    return row;
  }

  /**
   * 创建文件行
   * @param {Object} file - 文件对象
   * @returns {HTMLTableRowElement} 表格行
   */
  createFileRow(file) {
    const row = document.createElement('tr');
    row.className = `file-item ${file.is_dir ? 'directory' : 'file'}`;
    
    const nameCell = document.createElement('td');
    nameCell.className = 'file-name';
    
    const icon = this.getFileIconSVG(file.name, file.is_dir);
    const iconContainer = document.createElement('span');
    iconContainer.className = 'file-icon';
    iconContainer.innerHTML = icon;
    
    const textNode = document.createTextNode(` ${file.name}`);
    
    nameCell.appendChild(iconContainer);
    nameCell.appendChild(textNode);
    
    row.appendChild(nameCell);
    row.innerHTML += `<td>${this.formatFileSize(file.size)}</td><td>${file.is_dir ? '目录' : this.getFileType(file.name)}</td>`;
    
    if (file.is_dir) {
      row.addEventListener('click', () => {
        const newPath = this.currentPath === '/' 
          ? `/${file.name}` 
          : `${this.currentPath}/${file.name}`;
        this.navigateToPath(newPath);
      });
    }
    
    return row;
  }

  /**
   * 渲染文件网格（网格视图）
   * @param {Array} files - 文件列表
   */
  renderFileGrid(files) {
    this.content.innerHTML = '';
    this.content.className = 'file-manager-content grid-view';
    
    if (!files || files.length === 0) {
      this.content.innerHTML = '<div class="empty-message">目录为空</div>';
      return;
    }
    
    const grid = document.createElement('div');
    grid.className = 'file-grid';
    
    // 添加上级目录链接（如果不是根目录）
    if (this.currentPath !== '/') {
      const parentItem = this.createParentDirectoryGridItem();
      grid.appendChild(parentItem);
    }
    
    // 添加文件和目录
    files.forEach(file => {
      const item = this.createFileGridItem(file);
      grid.appendChild(item);
    });
    
    this.content.appendChild(grid);
  }

  /**
   * 创建上级目录网格项
   * @returns {HTMLElement} 网格项
   */
  createParentDirectoryGridItem() {
    const item = document.createElement('div');
    item.className = 'file-grid-item directory';
    
    const iconContainer = document.createElement('div');
    iconContainer.className = 'file-grid-icon';
    iconContainer.innerHTML = '📁';
    
    const name = document.createElement('div');
    name.className = 'file-grid-name';
    name.textContent = '..';
    
    item.appendChild(iconContainer);
    item.appendChild(name);
    
    item.addEventListener('click', () => this.goUp());
    
    return item;
  }

  /**
   * 创建文件网格项
   * @param {Object} file - 文件对象
   * @returns {HTMLElement} 网格项
   */
  createFileGridItem(file) {
    const item = document.createElement('div');
    item.className = `file-grid-item ${file.is_dir ? 'directory' : 'file'}`;
    
    const iconContainer = document.createElement('div');
    iconContainer.className = 'file-grid-icon';
    iconContainer.innerHTML = this.getFileIconSVG(file.name, file.is_dir);
    
    const name = document.createElement('div');
    name.className = 'file-grid-name';
    name.textContent = file.name;
    
    item.appendChild(iconContainer);
    item.appendChild(name);
    
    if (file.is_dir) {
      item.addEventListener('click', () => {
        const newPath = this.currentPath === '/' 
          ? `/${file.name}` 
          : `${this.currentPath}/${file.name}`;
        this.navigateToPath(newPath);
      });
    }
    
    return item;
  }

  /**
   * 格式化文件大小
   * @param {number} bytes - 文件大小（字节）
   * @returns {string} 格式化后的文件大小
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 获取文件类型
   * @param {string} filename - 文件名
   * @returns {string} 文件类型描述
   */
  getFileType(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    const types = {
      'txt': '文本文件',
      'md': 'Markdown文件',
      'html': 'HTML文件',
      'css': 'CSS文件',
      'js': 'JavaScript文件',
      'json': 'JSON文件',
      'xml': 'XML文件',
      'jpg': '图片',
      'jpeg': '图片',
      'png': '图片',
      'gif': '图片',
      'svg': 'SVG图片',
      'pdf': 'PDF文件',
      'zip': '压缩文件',
      'rar': '压缩文件',
      'tar': '压缩文件',
      'gz': '压缩文件',
      'exe': '可执行文件',
      'sh': '脚本文件',
      'py': 'Python脚本',
      'rs': 'Rust源文件',
      'java': 'Java源文件',
      'c': 'C源文件',
      'cpp': 'C++源文件',
      'h': 'C头文件',
      'hpp': 'C++头文件',
    };
    return types[extension] || '未知类型';
  }

  /**
   * 获取文件图标SVG
   * @param {string} filename - 文件名
   * @param {boolean} isDir - 是否是目录
   * @returns {string} SVG图标HTML
   */
  getFileIconSVG(filename, isDir) {
    if (isDir) {
      return `<svg class="file-icon directory-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
    }
    
    const extension = filename.split('.').pop().toLowerCase();
    const icons = {
      'txt': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
      'md': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M16 13H8"></path><path d="M16 17H8"></path><path d="M10 9H8"></path></svg>`,
      'html': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
      'css': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l-10 4 3 11 7 3 7-3 3-11-10-4z"></path></svg>`,
      'js': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v-3a2 2 0 0 0-4 0v3"></path><path d="M20 16v-3a2 2 0 0 0-4 0v3"></path><path d="M8 16v-3a2 2 0 0 0-4 0v3"></path><path d="M4 16v-3a2 2 0 0 0-4 0v3"></path><line x1="12" y1="2" x2="12" y2="22"></line></svg>`,
      'json': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6"></path><path d="M9 15l3 3 3-3"></path></svg>`,
      'xml': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
      'jpg': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
      'jpeg': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
      'png': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
      'gif': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
      'svg': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
      'pdf': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6"></path><path d="M9 15l3 3 3-3"></path></svg>`,
      'zip': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
      'rar': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
      'tar': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
      'gz': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
      'exe': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
      'sh': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M16 13H8"></path><path d="M16 17H8"></path><path d="M10 9H8"></path></svg>`,
      'py': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6"></path><path d="M9 15l3 3 3-3"></path></svg>`,
      'rs': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6"></path><path d="M9 15l3 3 3-3"></path></svg>`,
      'java': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6"></path><path d="M9 15l3 3 3-3"></path></svg>`,
      'c': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6"></path><path d="M9 15l3 3 3-3"></path></svg>`,
      'cpp': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6"></path><path d="M9 15l3 3 3-3"></path></svg>`,
      'h': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6"></path><path d="M9 15l3 3 3-3"></path></svg>`,
      'hpp': `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 18v-6"></path><path d="M9 15l3 3 3-3"></path></svg>`,
    };
    return icons[extension] || `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
  }

  /**
   * 设置视图模式
   * @param {string} mode - 视图模式：'list' 或 'grid'
   */
  setViewMode(mode) {
    if (mode !== 'list' && mode !== 'grid') {
      console.warn('无效的视图模式:', mode);
      return;
    }
    
    this.viewMode = mode;
    
    // 更新按钮状态
    const viewButtons = this.panel.querySelectorAll('.view-btn');
    viewButtons.forEach(btn => {
      btn.classList.remove('active');
    });
    
    const activeBtn = this.panel.querySelector(`.view-btn[title="${mode === 'list' ? '列表视图' : '网格视图'}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }
    
    // 重新加载当前目录以应用新的视图模式
    this.loadDirectory(this.currentPath, false);
  }

  /**
   * 设置路径变化回调函数
   * @param {Function} callback - 回调函数，接收新路径作为参数
   */
  setOnPathChange(callback) {
    this.onPathChange = callback;
  }
}

// 创建并导出文件管理器实例
export const fileManager = new FileManager();
