// src/fileManager.js
import { invoke } from '@tauri-apps/api/core';

// 文件管理器类
class FileManager {
  constructor() {
    this.panel = null;
    this.pathDisplay = null;
    this.content = null;
    this.closeBtn = null;
    this.currentPath = '/';
    this.isVisible = false;
  }

  // 初始化文件管理器
  init() {
    // 创建文件管理器面板
    this.panel = document.createElement('div');
    this.panel.className = 'file-manager-panel hidden';
    
    // 创建头部
    const header = document.createElement('div');
    header.className = 'file-manager-header';
    
    this.pathDisplay = document.createElement('div');
    this.pathDisplay.className = 'file-manager-path';
    this.pathDisplay.textContent = this.currentPath;
    
    this.closeBtn = document.createElement('button');
    this.closeBtn.className = 'close-btn';
    this.closeBtn.innerHTML = '&times;';
    this.closeBtn.addEventListener('click', () => this.hide());
    
    header.appendChild(this.pathDisplay);
    header.appendChild(this.closeBtn);
    
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
    
    // 设置键盘事件监听
    this.setupKeyboardListeners();
  }

  // 设置键盘事件监听
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

  // 显示文件管理器
  show() {
    if (!this.isVisible) {
      this.panel.classList.remove('hidden');
      this.isVisible = true;
      this.loadDirectory(this.currentPath);
    }
  }

  // 隐藏文件管理器
  hide() {
    if (this.isVisible) {
      this.panel.classList.add('hidden');
      this.isVisible = false;
    }
  }

  // 切换文件管理器显示状态
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  // 加载目录内容
  async loadDirectory(path) {
    try {
      this.currentPath = path;
      this.pathDisplay.textContent = path;
      
      const files = await invoke('list_directory', { path });
      this.renderFileList(files);
    } catch (error) {
      console.error('加载目录失败:', error);
      this.content.innerHTML = `<div class="error-message">加载目录失败: ${error}</div>`;
    }
  }

  // 渲染文件列表
  renderFileList(files) {
    this.content.innerHTML = '';
    
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
      const parentRow = document.createElement('tr');
      parentRow.className = 'file-item directory';
      parentRow.innerHTML = '<td class="file-name">..</td><td>-</td><td>目录</td>';
      parentRow.addEventListener('click', () => {
        const parentPath = this.currentPath.substring(0, this.currentPath.lastIndexOf('/'));
        this.loadDirectory(parentPath === '' ? '/' : parentPath);
      });
      tbody.appendChild(parentRow);
    }
    
    // 添加文件和目录
    files.forEach(file => {
      const row = document.createElement('tr');
      row.className = `file-item ${file.is_dir ? 'directory' : 'file'}`;
      row.innerHTML = `
        <td class="file-name">${file.name}</td>
        <td>${this.formatFileSize(file.size)}</td>
        <td>${file.is_dir ? '目录' : this.getFileType(file.name)}</td>
      `;
      
      row.addEventListener('click', () => {
        if (file.is_dir) {
          const newPath = this.currentPath === '/' 
            ? `/${file.name}` 
            : `${this.currentPath}/${file.name}`;
          this.loadDirectory(newPath);
        }
      });
      
      tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    this.content.appendChild(table);
  }

  // 格式化文件大小
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 获取文件类型
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
}

// 导出单例
export const fileManager = new FileManager();
