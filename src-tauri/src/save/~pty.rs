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

    match fork.is_parent() {
        Ok(master) => {
            // 将master包装在Arc<Mutex<>>中
            let master_arc = Arc::new(Mutex::new(master));
            
            // 存储到全局map
            {
                let pty_map = get_pty_map();
                let mut map = pty_map.lock().unwrap();
                map.insert(id, master_arc.clone());
            }

            // 启动读取线程
            let app_handle = app.clone();
            std::thread::spawn(move || {
                let mut buffer = [0u8; 1024];
                loop {
                    // 在读取线程中获取锁
                    let mut master_guard = match master_arc.lock() {
                        Ok(guard) => guard,
                        Err(_) => break, // 锁被破坏，退出线程
                    };
                    
                    match master_guard.read(&mut buffer) {
                        Ok(n) if n > 0 => {
                            let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                            // 释放锁后再发送事件
                            drop(master_guard);
                            
                            let _ = app_handle.emit("pty-output", json!({
                                "id": id,
                                "data": data
                            }));
                        }
                        Ok(_) => break, // EOF
                        Err(e) => {
                            eprintln!("PTY read error: {}", e);
                            break;
                        }
                    }
                }
            });

            Ok(id)
        }
        Err(_) => {
            // 子进程：替换为目标命令（exec）
            let mut command = std::process::Command::new(&cmd);
            command.args(&args);
            let exec_res = command.exec(); // 成功时不会返回
            eprintln!("Failed to exec command: {:?}", exec_res);
            std::process::exit(1);
        }
    }
}

// 向 PTY 写入数据
/*#[tauri::command]
pub fn pty_write(id: u32, data: String) -> Result<(), String> {
    println!("---pty_write id: {}, data: {}", id, data);
    let map = get_pty_map();
    let map_guard = map.lock().map_err(|e| format!("PTY map mutex poisoned: {}", e))?;
    
    if let Some(master_arc) = map_guard.get(&id) {
        use std::io::Write;
        // 先锁住内部的 Master，再写入
        let mut master_guard = master_arc.lock().map_err(|e| format!("PTY mutex poisoned: {}", e))?;
        master_guard.write_all(data.as_bytes()).map_err(|e| format!("Failed to write to PTY: {}", e))?;
        Ok(())
    } else {
        Err(format!("PTY with ID {} not found", id))
    }
}*/
#[tauri::command]
pub fn pty_write(id: u32, data: String) -> Result<(), String> {
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
