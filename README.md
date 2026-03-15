# 对分易自动答题助手 v5.2

对分易（duifene.com）DeepSeek AI 自动答题 Tampermonkey 脚本。

## ✨ 功能

- 🤖 DeepSeek v4-pro
- 📋 单选/多选/判断/填空/问答题
- 🔄 逐题自动切换
- 🖥️ 悬浮终端 + 答题卡
- 📤 自动提交+返回列表

## ⚙️ 配置

| 设置 | 默认值 |
|------|--------|
| API Key | 必填 |
| Model | `deepseek-v4-pro` |
| 题间延时 | `1200ms` |
| 自动提交 | 关闭 |
| 返回列表 | 开启 |

获取 Key：https://platform.deepseek.com → API Keys

## 🔄 更新日志

### v5.2.0 (2026-06-10)
- 🔥 **fillBlank 精确定位 + FillAnswer()** — 截图发现填空 `<input>` 的 `onchange="FillAnswer(this)"` 是页面真正的保存入口
  - 搜索范围从 `#divSubjectItem` 任意 input 改为精确 `.subject-fillblank input`（避免了 file upload/textarea 干扰）
  - 写入 value 后**直接调用页面 `FillAnswer(input)` 函数**，绕过所有事件系统
  - 辅助发送 `input/change/keyup` 事件做视觉反馈
  - 保留 jQuery `triggerHandler('change')` 兜底

### v5.1.0 (2026-06-10)
- 🔥 **fillBlank 事件顺序修正** — v5.0 先写 value 再发 keydown，框架在 keydown 时看到 value 已经是最终值，input 事件时 delta=0，字符计数不触发
  - 改为：`focus → keydown(旧值) → 写value → InputEvent('input', {inputType:'insertText'}) → keyup → change → blur`
  - keydown 在 value 改变**之前**（与真实打字一致）
  - 用 `InputEvent` 替代 `Event('input')`，携带 `inputType:'insertText'` + `data` 更真实
  - KeyboardEvent 补充 `key:'a', code:'KeyA', keyCode:65, which:65` 完整属性
  - `inp.focus()` 真实 focus + 搜索范围扩大至 `[contenteditable]`
  - 加详细 console.log 便于排查

### v5.0.0 (2026-06-10)
- 🔥 **填空题完整键盘事件链** — 诊断证明手动打字触发 `keydown → input → keyup → change`，v4.9 只发了 `input` 和 `change`，字符计数不更新
  - 新增 `KeyboardEvent('keydown')` → `Event('input')` → `KeyboardEvent('keyup')` → `Event('change')` → `Event('blur')` 完整链
  - 新增 `focus` + jQuery `triggerHandler('input'/'change'/'blur')` 绕过 isTrusted
  - 搜索范围扩至 `input:not([type])`（有些填空 input 不带 type 属性）
  - 填完后直接调 `ajaxSave()` 发保存请求
  - 视觉反馈：绿色边框 + 浅绿背景

### v4.9.0 (2026-06-10)
- 🔥 **根本性突破** — 诊断证明 jQuery trigger / MouseEvent / 原生 click 全部被 `e.isTrusted` 拦截
- 📚 **triggerHandler** — jQuery 的 `$(el).triggerHandler('click')` 直接调用绑定的 handler 函数，完全不经过 DOM 事件系统，`isTrusted` 管不着
- 🔧 answerStr 改为 `"A,B,C,D"` 逗号分隔格式
- 🔧 新增 `fillBlank()` 填空题写入逻辑
- 🔧 AJAX 多处并行尝试 `StudentPaper.ashx` / `Paper.ashx` 等端点

### v4.8.0 — 直接注入 hidUps
- 更新 hidUps JSON + DOM class + AJAX 三连保存（有视觉但无持久化）

### v4.0-v4.7
- 悬浮终端、答题卡、题型全覆盖、UEditor 等
