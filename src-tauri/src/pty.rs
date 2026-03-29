use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use serde_json::json;

// 定义一个结构体来包装 PTY 的读写端
struct PtyHandle {
    reader: Arc<Mutex<Box<dyn Read + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>, // 存储对 PTY（伪终端）主端的引用MasterPty trait 提供了控制 PTY 的方法，如调整大小、获取尺寸等
}

// 全局 PTY 映射
static PTY_MAP: std::sync::OnceLock<Arc<Mutex<HashMap<u32, PtyHandle>>>> = std::sync::OnceLock::new();

// 初始化 PTY 映射
fn init_pty_map() {
    PTY_MAP.get_or_init(|| Arc::new(Mutex::new(HashMap::new())));
}

// 获取 PTY 映射
fn get_pty_map() -> Arc<Mutex<HashMap<u32, PtyHandle>>> {
    init_pty_map();
    PTY_MAP.get().unwrap().clone()
}

// 生成唯一的 PTY ID
fn generate_pty_id() -> u32 {
    static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
}

// 创建新的 PTY 会话
#[tauri::command]
pub fn pty_spawn(app: AppHandle, cmd: String, args: Vec<String>) -> Result<u32, String> {
    init_pty_map();
    //println!("---pty_spawn cmd: {}, args: {:?}", cmd, args);
    
    // 创建 PTY 系统
    let pty_system = native_pty_system();
    
    // 打开新的 PTY
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;
    
    let id = generate_pty_id();
    //println!("---pty_spawn generated id: {}", id);

    // 构建命令
    let mut cmd_builder = CommandBuilder::new(cmd.clone());
    cmd_builder.args(&args);
    
    // 设置环境变量
    //cmd_builder.env("TERM", "xterm-256color");
        // 确保用户目录被设置，这对加载配置文件很重要
    cmd_builder.env("HOME", std::env::var("HOME").unwrap_or_else(|_| "/root".to_string()));
    
    // 启动命令
    let _child = pty_pair
        .slave
        .spawn_command(cmd_builder)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;
    
    // 创建读写端
    let reader = pty_pair.master.try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;
    let writer = pty_pair.master.take_writer()
        .map_err(|e| format!("Failed to get writer: {}", e))?;
    
    // 存储 PTY 句柄，包括 master 引用
    {
        let pty_map = get_pty_map();
        let mut map = pty_map.lock().unwrap();
        //println!("---pty_spawn storing PTY {} in map", id);
        map.insert(id, PtyHandle {
            reader: Arc::new(Mutex::new(reader)),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pty_pair.master)), // 添加这一行
        });
        println!("---pty_spawn PTY {} stored successfully, map size: {}", id, map.len());
    }

    // 准备读取线程所需的资源
    let app_handle_clone = app.clone();
    let pty_map_clone = get_pty_map();
    let id_clone = id;

    // 启动读取线程
    std::thread::spawn(move || {
        println!("---pty_spawn read thread started for PTY {}", id_clone);
        
        loop {
            // 获取 reader 的引用
            let reader = {
                let pty_map = pty_map_clone.lock().unwrap();
                if let Some(handle) = pty_map.get(&id_clone) {
                    Some(handle.reader.clone())
                } else {
                    None
                }
            };
            
            // 如果 reader 不存在，退出循环
            let reader = match reader {
                Some(r) => r,
                None => {
                    println!("---pty_spawn read thread: PTY {} not found in map", id_clone);
                    break;
                }
            };
            
            // 读取数据
            let mut buffer = [0u8; 1024];
            let data = {
                let mut reader_guard = reader.lock().unwrap();
                match reader_guard.read(&mut buffer) {
                    Ok(n) if n > 0 => {
                        Some(String::from_utf8_lossy(&buffer[..n]).to_string())
                    }
                    Ok(_) => {
                        println!("---pty_spawn read thread: EOF for PTY {}", id_clone);
                        None
                    }
                    Err(e) => {
                        eprintln!("PTY read error: {}", e);
                        None
                    }
                }
            };
            
            // 处理读取的数据
            match data {
                Some(d) => {
                    //println!("---pty_spawn read thread: sending data for PTY {}", id_clone);
                    let _ = app_handle_clone.emit("pty-output", json!({
                        "id": id_clone,
                        "data": d
                    }));
                }
                None => {
                    break;
                }
            }
        }
        
        // 读取线程退出，清理资源并通知前端
        println!("---pty_spawn read thread: exiting for PTY {}", id_clone);
        if let Ok(mut map) = pty_map_clone.lock() {
            println!("---pty_spawn read thread: removing PTY {} from map", id_clone);
            map.remove(&id_clone);
            let _ = app_handle_clone.emit("pty-closed", json!({ "id": id_clone }));
        }
    });

    println!("---pty_spawn returning id: {}", id);
    Ok(id)
}

// 向 PTY 写入数据
#[tauri::command]
pub fn pty_write(id: u32, data: String) -> Result<(), String> {
    //println!("---pty_write called with id: {}, data: {}", id, data);
    let pty_map = get_pty_map();
    let map_guard = pty_map.lock().map_err(|e| format!("PTY map mutex poisoned: {}", e))?;
    //println!("---pty_write acquired map lock, current PTY count: {}", map_guard.len());

    // 获取 writer
    let writer = match map_guard.get(&id) {
        Some(handle) => {
            //println!("---pty_write found PTY {}", id);
            handle.writer.clone()
        },
        None => {
            println!("---pty_write PTY {} not found in map", id);
            return Err(format!("PTY with ID {} not found", id));
        }
    };

    // 写入数据
    let mut writer_guard = writer.lock().unwrap();
    match writer_guard.write_all(data.as_bytes()) {
        Ok(()) => {
            //println!("---pty_write successfully wrote to PTY {}", id);
            Ok(())
        },
        Err(e) => {
            println!("---pty_write failed to write to PTY {}: {}", id, e);
            Err(format!("Failed to write to PTY: {}", e))
        },
    }
}

// 调整 PTY 尺寸
#[tauri::command]
pub fn pty_resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    println!("---pty_resize called with id: {}, cols: {}, rows: {}", id, cols, rows);
    let pty_map = get_pty_map();
    let map_guard = pty_map.lock().map_err(|e| format!("PTY map mutex poisoned: {}", e))?;
    println!("---pty_resize acquired map lock, current PTY count: {}", map_guard.len());

    // 获取 master
    let master = match map_guard.get(&id) {
        Some(handle) => {
            println!("---pty_resize found PTY {}", id);
            handle.master.clone() // 现在可以访问 master 字段了
        },
        None => {
            println!("---pty_resize PTY {} not found in map", id);
            return Err(format!("PTY with ID {} not found", id));
        }
    };

    // 调整 PTY 尺寸
    let mut master_guard = master.lock().unwrap();
    match master_guard.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(()) => {
            println!("---pty_resize successfully resized PTY {} to {}x{}", id, cols, rows);
            Ok(())
        },
        Err(e) => {
            println!("---pty_resize failed to resize PTY {}: {}", id, e);
            Err(format!("Failed to resize PTY: {}", e))
        },
    }
}

// 关闭 PTY 会话
#[tauri::command]
pub fn pty_kill(id: u32) -> Result<(), String> {
    println!("---pty_kill called with id: {}", id);
    let pty_map = get_pty_map();
    let mut map_guard = pty_map.lock().map_err(|e| format!("PTY map mutex poisoned: {}", e))?;
    
    match map_guard.remove(&id) {
        Some(_) => {
            println!("---pty_kill PTY {} removed from map", id);
            Ok(())
        },
        None => {
            println!("---pty_kill PTY {} not found in map", id);
            Err(format!("PTY with ID {} not found", id))
        }
    }
}
