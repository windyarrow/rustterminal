/**
 * 文件管理器模块 - 提供文件系统操作功能并与终端同步工作目录
 * 
 * 主要功能：
 * 1. 管理全局工作目录
 * 2. 提供目录列表功能
 * 3. 在指定工作目录中执行命令
 * 4. 与前端终端和文件管理器同步工作目录
 */

use std::fs;
use std::path::Path;
use serde::{Serialize, Deserialize};
use std::env;
use std::path::PathBuf;

// 全局工作目录变量
// 注意：使用 unsafe 是因为这是一个全局可变静态变量
// 在实际生产环境中，应考虑使用线程安全的替代方案，如 Mutex 或 RwLock
pub static mut CURRENT_WORKING_DIR: Option<PathBuf> = None;

/**
 * 文件信息结构体
 * 用于表示文件或目录的基本信息
 */
#[derive(Serialize, Deserialize)]
pub struct FileInfo {
    name: String,   // 文件名
    path: String,   // 完整路径
    size: u64,      // 文件大小（字节）
    is_dir: bool,   // 是否是目录
}

/**
 * 获取当前工作目录
 * 
 * # 返回值
 * - 如果已设置工作目录，返回该目录的字符串表示
 * - 如果未设置工作目录，返回系统当前工作目录或根目录("/")
 * 
 * # 安全性
 * - 使用 unsafe 块访问全局可变静态变量
 */
#[tauri::command]
pub fn get_current_working_dir() -> String {
    unsafe {
        match &CURRENT_WORKING_DIR {
            Some(path) => path.to_string_lossy().to_string(),
            None => {
                // 如果没有设置，使用系统默认工作目录
                let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
                CURRENT_WORKING_DIR = Some(cwd.clone());
                cwd.to_string_lossy().to_string()
            }
        }
    }
}

/**
 * 设置当前工作目录
 * 
 * # 参数
 * - path: 要设置的工作目录路径
 * 
 * # 返回值
 * - Ok(()) 表示成功
 * - Err(String) 表示失败，包含错误信息
 * 
 * # 安全性
 * - 使用 unsafe 块修改全局可变静态变量
 */
#[tauri::command]
pub fn set_current_working_dir(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    // 验证路径是否存在
    if !path_buf.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    
    // 验证路径是否是目录
    if !path_buf.is_dir() {
        return Err(format!("路径不是目录: {}", path));
    }
    
    // 更新全局工作目录
    unsafe {
        CURRENT_WORKING_DIR = Some(path_buf);
    }
    
    Ok(())
}

/**
 * 在当前工作目录中执行命令
 * 
 * # 参数
 * - cmd: 要执行的命令字符串
 * 
 * # 返回值
 * - Ok(String) 表示成功，包含命令输出
 * - Err(String) 表示失败，包含错误信息
 * 
 * # 说明
 * - 命令在全局工作目录中执行
 * - 如果未设置工作目录，使用系统当前工作目录
 * - 使用 sh shell 执行命令
 */
#[tauri::command]
pub fn run_curdir_command(cmd: String) -> Result<String, String> {
    // 获取当前工作目录
    let cwd = unsafe {
        match &CURRENT_WORKING_DIR {
            Some(path) => path.clone(),
            None => {
                // 如果没有设置，使用系统默认工作目录
                let default_cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("~/"));
                CURRENT_WORKING_DIR = Some(default_cwd.clone());
                default_cwd
            }
        }
    };
    
    // 执行命令
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("执行命令失败: {}", e))?;
    
    // 根据命令执行结果返回输出
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/**
 * 列出目录内容
 * 
 * # 参数
 * - path: 要列出的目录路径
 * 
 * # 返回值
 * - Ok(Vec<FileInfo>) 表示成功，包含目录内容列表
 * - Err(String) 表示失败，包含错误信息
 * 
 * # 说明
 * - 返回的文件列表按名称排序，目录在前
 * - 包含文件和目录的基本信息
 */
#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileInfo>, String> {
    let dir_path = Path::new(&path);
    
    // 验证路径是否存在
    if !dir_path.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    
    // 验证路径是否是目录
    if !dir_path.is_dir() {
        return Err(format!("路径不是目录: {}", path));
    }
    
    // 读取目录内容
    let entries = fs::read_dir(dir_path)
        .map_err(|e| format!("无法读取目录: {}", e))?;
    
    let mut files = Vec::new();
    
    // 遍历目录项
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("获取文件元数据失败: {}", e))?;
        
        // 提取文件信息
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path().to_string_lossy().to_string();
        let file_size = metadata.len();
        let is_dir = metadata.is_dir();
        
        files.push(FileInfo {
            name: file_name,
            path: file_path,
            size: file_size,
            is_dir,
        });
    }
    
    // 按名称排序，目录在前
    files.sort_by(|a, b| {
        if a.is_dir && !b.is_dir {
            return std::cmp::Ordering::Less;
        }
        if !a.is_dir && b.is_dir {
            return std::cmp::Ordering::Greater;
        }
        a.name.cmp(&b.name)
    });
    
    Ok(files)
}
