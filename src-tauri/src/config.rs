use serde_json::json;
use tauri::Manager;
use config::{Config, File, FileFormat, Value};
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn get_config(section: String, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    // 获取应用程序配置目录
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config dir: {}", e))?;
    
    // 构建 config.ini 文件路径
    let config_path = config_dir.join("config.ini");
    
    // 如果配置文件不存在，尝试使用项目目录中的配置文件（仅用于开发）
    if !config_path.exists() {
        // 获取当前工作目录
        let current_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current dir: {}", e))?;
        
        // 构建项目目录中的配置文件路径
        let project_config_path = current_dir.join("config.ini");
        
        // 如果项目目录中的配置文件存在，则使用它
        if project_config_path.exists() {
            // 读取项目目录中的配置文件
            let config_content = fs::read_to_string(&project_config_path)
                .map_err(|e| format!("Failed to read config file: {}", e))?;
            
            // 解析 INI 内容
            let config = Config::builder()
                .add_source(File::from_str(&config_content, FileFormat::Ini))
                .build()
                .map_err(|e| format!("Failed to parse config file: {}", e))?;
            
            // 获取指定 section 的配置
            let section_config = config.get_table(&section)
                .map_err(|e| format!("Failed to get section '{}': {}", section, e))?;
            
            // 将配置转换为 JSON 对象
            let mut json_config = serde_json::Map::new();
            for (key, value) in section_config {
                let json_value = convert_config_value(value);
                json_config.insert(key, json_value);
            }
            
            return Ok(json!(json_config));
        }
        
        return Err(format!("Config file not found at: {:?} or {:?}", config_path, project_config_path));
    }
    
    // 读取 INI 文件内容
    let config_content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;
    
    // 解析 INI 内容
    let config = Config::builder()
        .add_source(File::from_str(&config_content, FileFormat::Ini))
        .build()
        .map_err(|e| format!("Failed to parse config file: {}", e))?;
    
    // 获取指定 section 的配置
    let section_config = config.get_table(&section)
        .map_err(|e| format!("Failed to get section '{}': {}", section, e))?;
    
    // 将配置转换为 JSON 对象
    let mut json_config = serde_json::Map::new();
    for (key, value) in section_config {
        let json_value = convert_config_value(value);
        json_config.insert(key, json_value);
    }
    
    Ok(json!(json_config))
}

// 辅助函数：将 config::Value 转换为 serde_json::Value
fn convert_config_value(value: Value) -> serde_json::Value {
    // 在 config 0.15.x 中，Value 不是枚举，而是使用内部表示
    // 我们需要使用它的方法来获取不同类型的值
    // 尝试转换为字符串
    if let Ok(s) = value.clone().into_string() {
        json!(s)
    } 
    // 尝试转换为整数
    else if let Ok(i) = value.clone().into_int() {
        json!(i)
    } 
    // 尝试转换为浮点数
    else if let Ok(f) = value.clone().into_float() {
        json!(f)
    } 
    // 尝试转换为布尔值
    else if let Ok(b) = value.clone().into_bool() {
        json!(b)
    } 
    // 尝试转换为表（对象）
    else if let Ok(table) = value.clone().into_table() {
        let mut json_table = serde_json::Map::new();
        for (k, v) in table {
            json_table.insert(k, convert_config_value(v));
        }
        json!(json_table)
    } 
    // 尝试转换为数组
    else if let Ok(array) = value.clone().into_array() {
        let json_array: Vec<serde_json::Value> = array
            .into_iter()
            .map(convert_config_value)
            .collect();
        json!(json_array)
    } 
    // 其他情况，尝试转换为字符串
    else {
        json!(value.to_string())
    }
}
