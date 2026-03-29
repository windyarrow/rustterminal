use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use pty::fork::Fork;
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use serde_json::json;

// 使用Arc<Mutex<Master>>来安全地共享PTY master
type PtyMaster = Arc<Mutex<pty::fork::Master>>;
type PtyMap = Arc<Mutex<HashMap<u32, PtyMaster>>>;
static PTY_MAP: std::sync::OnceLock<PtyMap> = std::sync::OnceLock::new();

// 初始化 PTY 映射
fn init_pty_map() {
    PTY_MAP.get_or_init(|| Arc::new(Mutex::new(HashMap::new())));
}

// 获取 PTY 映射
fn get_pty_map() -> PtyMap {
    PTY_MAP.get().expect("PTY map not initialized").clone()
}

// 生成唯一的 PTY ID
fn generate_pty_id() -> u32 {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(1);
    COUNTER.fetch_add(1, Ordering::SeqCst)
}

// 创建 PTY 会话
#[tauri::command]
pub fn pty_spawn(app: AppHandle, cmd: String, args: Vec<String>) -> Result<u32, String> {
    init_pty_map();
    println!("---pty_spawn cmd: {}, args: {:?}", cmd, args);
    
    // Fork PTY
    let fork = Fork::from_ptmx().map_err(|e| format!("Failed to fork PTY: {}", e))?;
    let id = generate_pty_id();
    println!("---pty_spawn generated id: {}", id);
    match fork.is_parent() {
        Ok(master) => {
            // 将master包装在Arc<Mutex<>>中
            let master_arc = Arc::new(Mutex::new(master));
            
            // 存储到全局map
            {
                let pty_map = get_pty_map();
                let mut map = pty_map.lock().unwrap();
                println!("---pty_spawn storing PTY {} in map", id);
                map.insert(id, master_arc.clone());
                 println!("---pty_spawn PTY {} stored successfully, map size: {}", id, map.len());
            }

            // 准备读取线程所需的资源
            let app_handle_clone = app.clone();
            let pty_map_clone = get_pty_map(); // 获取全局映射的克隆
            let id_clone = id; // 克隆 ID 以在线程中使用
            // 启动读取线程
            std::thread::spawn(move || {
                println!("---pty_spawn read thread started for PTY {}", id_clone);
                let mut buffer = [0u8; 1024];
                loop {
                    // 在读取线程中获取锁
                    let mut master_guard = match master_arc.lock() {
                        Ok(guard) => guard,
                        Err(_) => {
                            println!("---pty_spawn read thread: lock poisoned for PTY {}", id_clone);
                            break;// 锁被破坏，退出线程
                        }
                    };
                    
                    match master_guard.read(&mut buffer) {
                        Ok(n) if n > 0 => {
                            let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                            // 释放锁后再发送事件
                            drop(master_guard);
                            println!("---pty_spawn read thread: sending data for PTY {}", id_clone);
                            let _ = app_handle_clone.emit("pty-output", json!({
                                "id": id,
                                "data": data
                            }));
                        }
                        Ok(_) => {
                             println!("---pty_spawn read thread: EOF for PTY {}", id_clone);
                             break;
                         } // EOF
                       Err(e) => {
                            eprintln!("PTY read error: {}", e);
                            break;
                        }
                    }
                    
                }
                
                // 读取线程退出，清理资源并通知前端
                println!("---pty_spawn read thread: exiting for PTY {}", id_clone);
                // 先发送关闭事件，让前端知道 PTY 已关闭
                let _ = app_handle_clone.emit("pty-closed", json!({ "id": id }));
                // 延迟更长时间再从映射中移除 PTY，给前端足够时间处理关闭事件
                std::thread::sleep(std::time::Duration::from_millis(500));
                if let Ok(mut map) = pty_map_clone.lock() {
                     println!("---pty_spawn read thread: removing PTY {} from map", id_clone);
                    map.remove(&id);
                }
            });
            println!("---pty_spawn returning id: {}", id);
            Ok(id)
        }
Err(_) => {
    // 子进程：替换为目标命令（exec）
    // 注意：这些输出可能不可见，因为标准错误可能被重定向
    let _ = writeln!(std::io::stderr(), "---pty_spawn child process: starting, cmd={}, args={:?}", cmd, args);
    
    // 设置环境变量
    std::env::set_var("TERM", "xterm-256color");
    
    // 在子进程中，PTY 的 slave 端已经是标准输入/输出
    // 我们只需要执行命令
    let mut command = std::process::Command::new(&cmd);
    command.args(&args);
    
    let _ = writeln!(std::io::stderr(), "---pty_spawn child process: executing command");
    
    // 尝试执行命令
    let err = command.exec(); // 成功时不会返回
    
    // 如果到达这里，说明 exec 失败
    let _ = writeln!(std::io::stderr(), "---pty_spawn child process: exec failed: {:?}", err);
    let _ = writeln!(std::io::stderr(), "---pty_spawn child process: error: {:?}", std::io::Error::last_os_error());
    std::process::exit(1);
}

        }
    }


// 向 PTY 写入数据
#[tauri::command]
pub fn pty_write(id: u32, data: String) -> Result<(), String> {
    println!("---pty_write id: {}, data: {}", id, data);
    let map = get_pty_map();
    let mut map_guard = map.lock().map_err(|e| format!("PTY map mutex poisoned: {}", e))?;

    // 先克隆出 Arc，释放对 map_guard 的不可变借用
    let master_arc = match map_guard.get(&id).cloned() {
        Some(m) => m,
        None => return Err(format!("PTY with ID {} not found", id)),
    };

    // 现在 map_guard 仍然持有锁，但不再被借用，可以安全地用于后续的可变操作
    let mut master_guard = master_arc.lock().map_err(|e| format!("PTY mutex poisoned: {}", e))?;
    match master_guard.write_all(data.as_bytes()) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(9) => {
            // EBADF: PTY 已失效，从映射中移除
            map_guard.remove(&id);
            Err(format!("PTY {} is no longer valid", id))
        }
        Err(e) => Err(format!("Failed to write to PTY: {}", e)),
    }
}

// 关闭 PTY 会话
#[tauri::command]
pub fn pty_kill(id: u32) -> Result<(), String> {
    let pty_map = get_pty_map();
    let mut map = pty_map.lock().unwrap();
    
    if map.remove(&id).is_some() {
        Ok(())
    } else {
        Err(format!("PTY with ID {} not found", id))
    }
}
