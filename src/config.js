import { invoke } from '@tauri-apps/api/core';

/**
 * 从配置文件读取字体设置
 * @returns {Promise<Object>} 返回包含字体设置的对象
 */
async function loadFontConfig() {
  // 添加这行来调试
  console.log('---Loading font config...');
  try {
    const config = await invoke('get_config', { section: 'terminal' });
    console.log('---Loaded config:', config); // 添加这行来调试
    return {
      fontFamily: config.font_family || 'monospace',
      fontSize: config.font_size || 18,
      fontWeight: config.font_weight || 'normal',
      fontWeightBold: config.font_weight_bold || 'bold',
      lineHeight: config.line_height || 1.0
    };
  } catch (err) {
    console.log('Failed to load font config, using defaults', err);
    return {
      fontFamily: 'monospace',
      fontSize: 18,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      lineHeight: 1.0
    };
  }
}

/**
 * 应用字体设置到终端实例
 * @param {Terminal} term - xterm 实例
 * @param {Object} fontConfig - 字体配置对象
 */
function applyFontSettings(term, fontConfig) {
  term.options.fontFamily = fontConfig.fontFamily;
  term.options.fontSize = fontConfig.fontSize;
  term.options.fontWeight = fontConfig.fontWeight;
  term.options.fontWeightBold = fontConfig.fontWeightBold;
  term.options.lineHeight = fontConfig.lineHeight;
  // 刷新终端以应用更改
  term.refresh(0, term.rows - 1);
    // 如果有 fit 插件，重新计算尺寸
  if (term._plugins && term._plugins.length > 0) {
    const fitAddon = term._plugins.find(p => p instanceof FitAddon);
    if (fitAddon) {
      setTimeout(() => {
        try {
          fitAddon.fit();
        } catch(e) {
          console.error('Fit error after font change:', e);
        }
      }, 100);
    }
  }
}


/**
 * 初始化终端字体设置
 * @param {Terminal} term - xterm 实例
 * @returns {Promise<Object>} 返回一个包含更新方法的对象
 */
export async function initTerminalFont(term) {
  const fontConfig = await loadFontConfig();
  applyFontSettings(term, fontConfig);
  
  return {
    /**
     * 更新终端字体设置
     */
    async update() {
      const newFontConfig = await loadFontConfig();
      applyFontSettings(term, newFontConfig);
    }
  };
}
