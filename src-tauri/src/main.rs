// src-tauri/src/main.rs
// 在发布版本中防止在Windows上出现额外的控制台窗口，请勿删除！！
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sysinfo::{System, Disks};

// 导入模块
mod pty;        // 伪终端模块
mod config;     // 配置模块
mod filemanager; // 文件管理器模块

/**
 * 系统统计信息结构体
 * 包含CPU、内存和磁盘的使用情况
 */
#[derive(Serialize, Deserialize)]
struct SystemStats {
    cpu: f32,           // CPU使用率（百分比）
    memory: MemoryStats, // 内存使用情况
    disk: DiskStats,    // 磁盘使用情况
}

/**
 * 内存统计信息结构体
 */
#[derive(Serialize, Deserialize)]
struct MemoryStats {
    used: u64,  // 已使用内存（MB）
    total: u64, // 总内存（MB）
}

/**
 * 磁盘统计信息结构体
 */
#[derive(Serialize, Deserialize)]
struct DiskStats {
    used: u64,  // 已使用磁盘空间（GB）
    total: u64, // 总磁盘空间（GB）
}

/**
 * 获取系统统计信息
 * 
 * 包括CPU使用率、内存使用情况和磁盘使用情况
 * 
 * # 返回值
 * - Ok(SystemStats): 成功时返回包含系统统计信息的结构体
 * - Err(String): 失败时返回错误信息字符串
 */
#[tauri::command]
fn get_system_stats() -> Result<SystemStats, String> {
    // 创建System对象以获取系统信息
    let mut sys = System::new_all();
    
    // 刷新所有系统信息
    sys.refresh_all();
    
    // 获取CPU使用率
    let cpu_usage = sys.global_cpu_usage() as f32;
    
    // 获取内存信息
    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();
    
    // 获取磁盘信息
    let mut disk_used = 0;
    let mut disk_total = 0;
    let disks = Disks::new_with_refreshed_list();
    
    for disk in &disks {
        disk_used += disk.total_space() - disk.available_space();
        disk_total += disk.total_space();
    }
    
    // 转换为GB
    let disk_used_gb = disk_used / (1024 * 1024 * 1024);
    let disk_total_gb = disk_total / (1024 * 1024 * 1024);
    
    // 返回系统统计信息
    Ok(SystemStats {
        cpu: cpu_usage,
        memory: MemoryStats {
            used: memory_used / (1024 * 1024), // 转换为MB
            total: memory_total / (1024 * 1024), // 转换为MB
        },
        disk: DiskStats {
            used: disk_used_gb,
            total: disk_total_gb,
        },
    })
}

/**
 * 执行命令（在系统默认工作目录中）
 * 
 * # 参数
 * - cmd: 要执行的命令字符串
 * 
 * # 返回值
 * - Ok(String): 成功时返回命令输出
 * - Err(String): 失败时返回错误信息
 * 
 * # 注意
 * - 此命令在系统默认工作目录中执行
 * - 对于需要在特定工作目录中执行的命令，请使用 filemanager::run_curdir_command
 */
#[tauri::command]
fn run_command(cmd: String) -> Result<String, String> {
    use std::process::Command;
    
    println!("run_command 执行命令: {}", cmd);
    
    let output = Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .output();
    
    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            
            // 如果有错误输出，合并标准输出和错误输出
            if !stderr.is_empty() {
                Ok(format!("{}\n{}", stdout, stderr))
            } else {
                Ok(stdout)
            }
        }
        Err(e) => Err(format!("命令执行失败: {}", e))
    }
}

/**
 * 问候命令
 * 
 * # 参数
 * - name: 问候的对象名称
 * 
 * # 返回值
 * - String: 问候语
 */
#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好, {}! 这是来自 Tauri 2.0 Rust 后端的问候。", name)
}

/**
 * 主函数
 * 
 * 初始化Tauri应用并注册所有命令
 */
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init()) // 初始化shell插件
        .invoke_handler(tauri::generate_handler![
            // 基本命令
            greet,
            get_system_stats,
            run_command,
            
            // PTY（伪终端）命令
            pty::pty_spawn,   // 创建PTY
            pty::pty_write,   // 向PTY写入数据
            pty::pty_kill,    // 终止PTY
            pty::pty_resize,  // 调整PTY尺寸
            
            // 配置命令
            config::get_config, // 读取配置文件
            
            // 文件管理器命令
            filemanager::list_directory,          // 列出目录内容
            filemanager::get_current_working_dir, // 获取当前工作目录
            filemanager::set_current_working_dir, // 设置当前工作目录
            filemanager::run_curdir_command,      // 在当前工作目录中执行命令
        ]) // 注册所有命令
        .run(tauri::generate_context!())
        .expect("运行Tauri应用时出错");
}
