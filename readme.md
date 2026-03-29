好的！既然你已经成功搭建好了 Tauri 2.0 的开发环境，下面我将通过一个简单的 **“系统信息查看器”** 示例，带你一步步了解如何进行前后端通信。

这个应用将包含两个功能：
1.  **前端**：点击按钮，界面显示“欢迎使用 Tauri”。
2.  **后端**：点击按钮，调用 Rust 获取操作系统类型，并显示在界面上。

---

### 第一步：配置 Rust 后端命令

在 Tauri 2.0 中，后端代码位于 `src-tauri/src/lib.rs` 或 `main.rs` 中。我们需要在这里定义可以被前端调用的命令。

1.  **打开文件**：
    打开 `src-tauri/src/lib.rs`（如果只有 `main.rs`，就打开 `main.rs`）。

2.  **编写代码**：
    清空原有代码，复制以下内容。这里我们使用了 `tauri::command` 宏来导出函数：

    ```rust
    // 1. 引入必要的模块
    use tauri::Manager;

    // 2. 定义一个简单的命令，接收一个名字，返回问候语
    // #[tauri::command] 宏是必须的，它告诉 Tauri 这是一个可以被前端调用的函数
    #[tauri::command]
    fn greet(name: &str) -> String {
        format!("你好, {}! 这是来自 Rust 后端的消息。", name)
    }

    // 3. 定义另一个命令，获取系统信息（演示无参数调用）
    #[tauri::command]
    fn get_system_info() -> String {
        // std::env::consts 是 Rust 标准库，用于获取系统常量
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;
        format!("当前系统: {} | 架构: {}", os, arch)
    }

    // 4. 主函数（或 lib 入口），在这里注册命令
    #[cfg_attr(mobile, tauri::mobile_entry_point)]
    pub fn run() {
        tauri::Builder::default()
            // 5. 关键步骤：使用 .invoke_handler 注册上面定义的命令
            // 这里使用了 generated_handler! 宏来自动生成处理器
            .invoke_handler(tauri::generate_handler![greet, get_system_info])
            // 如果你之前添加了 shell 插件，也要在这里保留
            .plugin(tauri_plugin_shell::init())
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
    ```

    *注意：如果你的代码在 `main.rs` 中，将 `pub fn run()` 改为 `fn main()` 并去掉 `pub`。*

3.  **配置权限（Tauri 2.0 特有）**：
    Tauri 2.0 引入了更严格的权限系统。仅仅注册命令是不够的，你还需要允许前端调用它。

    *   打开 `src-tauri/capabilities/default.json`。
    *   在 `"allow"` 列表中添加你的命令标识符（通常是 `crate::命令名`）。

    修改后的 `default.json` 应该类似这样：

    ```json
    {
      "$schema": "../gen/schemas/desktop-schema.json",
      "identifier": "default",
      "description": "Default capabilities for the application",
      "windows": ["main"],
      "permissions": [
        "core:default",
        "shell:allow-open",
        {
          "identifier": "allow-greet",
          "allow": [
            {
              "cmd": "greet"
            }
          ]
        },
        {
          "identifier": "allow-get-system-info",
          "allow": [
            {
              "cmd": "get_system_info"
            }
          ]
        }
      ]
    }
    ```
    *解释：这里我们定义了两个权限 `allow-greet` 和 `allow-get-system-info`，分别允许前端调用 `greet` 和 `get_system_info` 命令。*

---

### 第二步：编写前端页面

现在我们来修改前端代码，让用户可以通过点击按钮触发这些 Rust 命令。

1.  **修改 HTML 结构**：
    打开 `index.html`，将 `<body>` 中的内容替换为：

    ```html
    <div id="app">
      <h1>Tauri 2.0 入门教程</h1>

      <div class="card">
        <h2>1. 简单问候</h2>
        <input id="greet-input" placeholder="输入一个名字..." />
        <button id="greet-btn">问候一下</button>
        <p id="greet-result"></p>
      </div>

      <div class="card">
        <h2>2. 系统信息</h2>
        <button id="sys-info-btn">获取系统信息</button>
        <p id="sys-info-result"></p>
      </div>
    </div>
    ```

2.  **添加 CSS 样式**（可选，为了好看一点）：
    打开 `src/style.css`，添加：

    ```css
    body {
      font-family: sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #f3f3f3;
    }
    #app {
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      width: 300px;
    }
    .card {
      margin-bottom: 20px;
      border-bottom: 1px solid #eee;
      padding-bottom: 20px;
    }
    button {
      margin-top: 10px;
      padding: 8px 16px;
      cursor: pointer;
      background-color: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
    }
    button:hover {
      background-color: #0056b3;
    }
    input {
      padding: 8px;
      width: 80%;
      margin-bottom: 5px;
    }
    p {
      color: #333;
      font-weight: bold;
    }
    ```

3.  **编写 JavaScript 逻辑**：
    打开 `src/main.js`，清空并写入以下代码。这里我们使用 Tauri API 的 `invoke` 函数来调用后端：

    ```javascript
    // 导入 Tauri API 的 invoke 函数
    const { invoke } = window.__TAURI__.core;

    // 1. 处理问候按钮点击
    document.getElementById('greet-btn').addEventListener('click', () => {
      // 获取输入框的值
      const name = document.getElementById('greet-input').value;
      // 调用 Rust 后端的 'greet' 命令，并传递参数
      invoke('greet', { name })
        .then((message) => {
          // 成功回调：将返回的消息显示在页面上
          document.getElementById('greet-result').innerText = message;
        })
        .catch((error) => {
          console.error(error);
        });
    });

    // 2. 处理系统信息按钮点击
    document.getElementById('sys-info-btn').addEventListener('click', () => {
      // 调用 Rust 后端的 'get_system_info' 命令，无需参数
      invoke('get_system_info')
        .then((info) => {
          document.getElementById('sys-info-result').innerText = info;
        })
        .catch((error) => {
          console.error(error);
        });
    });
    ```

---

### 第三步：运行项目

1.  确保你之前安装了 `@tauri-apps/cli`：
    ```bash
    npm install --save-dev @tauri-apps/cli@next
    ```

2.  启动开发服务器：
    ```bash
    npm run tauri dev
    ```

### 总结

通过这个简单的教程，你学会了 Tauri 2.0 开发的核心流程：

1.  **后端**：在 Rust 中使用 `#[tauri::command]` 定义函数。
2.  **权限**：在 `src-tauri/capabilities/default.json` 中配置允许前端调用这些命令。
3.  **注册**：在 `tauri::Builder` 中使用 `invoke_handler` 注册命令。
4.  **前端**：使用 `invoke('命令名', { 参数 })` 调用后端代码。

你可以尝试修改 `get_system_info` 函数，让它返回更复杂的数据结构（如 JSON 对象），并在前端解析显示，这就是 Tauri 开发的基础！



cargo tauri dev可以运行 。npm run tauri dev
npm error Missing script: "tauri"
npm error
npm error To see a list of scripts, run:
npm error   npm run
npm error A complete log of this run can be found in: /home/arrow/.npm/_logs/2026-03-20T15_40_40_207Z-debug-0.log
```plaintext
npm run tauri dev
```

这是因为虽然你的项目可以运行了，但 package.json 里的脚本配置还没有更新。

cargo tauri dev 是直接调用 Rust 的工具链，所以它能工作。而 npm run tauri dev 是尝试去读取 package.json 中的 scripts 配置，因为里面没有定义 tauri 这个命令，所以报错了。

为了方便以后使用（以及保持 Node.js 生态的一致性），建议你把 npm 的脚本补上。

解决方法
打开 package.json。
在项目根目录下找到这个文件并打开。

修改 scripts 部分。
找到 "scripts" 字段，添加 "tauri": "tauri"。修改后应该类似下面这样（注意保留你原本的 dev 和 build）：

json
 复制
 插入
 新文件

"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "tauri": "tauri"  <-- 添加这一行
},
保存文件。

再次运行 npm 命令。
现在你可以愉快地使用 npm 来启动了：

bash
 复制
 插入
 运行

npm run tauri dev
原理说明
当你运行 npm run tauri dev 时，npm 实际上做了两件事：

它读取 package.json，找到 "tauri" 对应的值，也就是 tauri。
它实际上是在执行 tauri dev。
只要你全局安装了 Tauri CLI（或者通过 npx），或者在 node_modules 里安装了依赖，这个命令就能打通。加上这一行配置后，npm run 就知道怎么把任务转交给 Tauri 了。