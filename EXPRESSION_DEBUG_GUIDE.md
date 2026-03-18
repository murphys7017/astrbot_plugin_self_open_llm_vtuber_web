# 表情(Expression)响应诊断指南

## 问题描述
收到包含 `actions.expressions` 的音频消息后，Live2D 模型没有响应表情切换。

## 改进的调试要点

### 1. **WebSocket 消息接收层** (`websocket-handler.tsx`)
已添加日志输出：
```
"actions received:" - 显示完整的 actions 对象
"expressions in actions:" - 显示表情数组
```

**检查方法**：打开浏览器开发者工具 (F12) → Console，查看是否有这些日志输出。

### 2. **音频任务处理层** (`use-audio-task.ts`)
改进点：
- 表情现在在音频加载前立即设置（而不是等待 `canplaythrough` 事件）
- 添加了详细的日志：
  ```
  "[AudioTask] Received expressions:" - 表情队列是否收到
  "[AudioTask] LAppAdapter found" - 适配器是否初始化
  "[AudioTask] Attempting to set expression:" - 表情设置尝试
  "[AudioTask] No expressions provided" - 表情数据为空
  ```

### 3. **表情设置层** (`use-live2d-expression.ts`)
改进的诊断日志：
```
[setExpression] Input value: {value} Type: {type}
[setExpression] Setting expression by name/index: {value}
[setExpression] Retrieved expression name: {name}
[setExpression] Calling setExpression with name: {name}
[setExpression] Failed to set expression: {error}
```

## 调试步骤

### 步骤 1: 验证消息格式
1. 打开浏览器 DevTools (F12)
2. 发送包含表情的消息
3. 在 Console 中查找：
   ```
   actions received: {实际的 actions 对象}
   expressions in actions: {数组内容}
   ```
4. **期望**: 应该看到 `expressions: [3]`

### 步骤 2: 检查表情数据传递
在 Console 中查找：
```
[AudioTask] Received expressions: [3]
```
**问题排查**:
- 如果看不到这条日志 → 表情数据可能在 websocket-handler 中丢失
- 如果看到但值为 null → `message.actions?.expressions` 未正确传递

### 步骤 3: 检查 LAppAdapter 初始化
查找日志：
```
[AudioTask] LAppAdapter found
```
**问题排查**:
- 如果看到 `[AudioTask] LAppAdapter not found` → Live2D 模型可能未加载
- 检查是否看到 `Found model for audio playback`

### 步骤 4: 检查表情设置
查找日志：
```
[setExpression] Input value: 3 Type: number
[setExpression] Setting expression by index: 3
[setExpression] Retrieved expression name: {表情名称}
[setExpression] Calling setExpression with name: {表情名称}
```

**可能的问题**:
- `Retrieved expression name: null` → 模型可能没有该索引的表情
- 没有看到 `Calling setExpression` → getExpressionName 返回 null

## 常见问题排查

| 问题 | 解决方案 |
|------|--------|
| 看不到任何表情相关日志 | 检查 Console 过滤设置，确保显示 All levels |
| `LAppAdapter not found` | 确保 Live2D 模型已完全加载，等待 `"Found model"` 日志 |
| `Retrieved expression name: null` | 检查表情索引是否有效，尝试 `window.getLAppAdapter().getExpressionCount()` 查看可用表情数 |
| 日志正常但表情未改变 | 尝试在 Console 执行 `window.testSetExpression(0)` 手动测试表情 |

## 启用完整测试

在浏览器 Console 中输入：
```javascript
// 获取表情总数
window.getLAppAdapter().getExpressionCount()

// 获取指定表情名称
window.getLAppAdapter().getExpressionName(0)
window.getLAppAdapter().getExpressionName(3)

// 手动设置表情（需要先启用 testSetExpression）
window.testSetExpression(3)
```

## 日志输出示例

### 正常流程
```
actions received: {expressions: [3], expression_decision: {...}}
expressions in actions: [3]
[AudioTask] Received expressions: [3]
[AudioTask] LAppAdapter found
[AudioTask] Attempting to set expression: 3
[setExpression] Input value: 3 Type: number
[setExpression] Setting expression by index: 3
[setExpression] Retrieved expression name: "smirk"
[setExpression] Calling setExpression with name: "smirk"
```

### 异常流程（缺少表情）
```
actions received: undefined
expressions in actions: undefined
[AudioTask] Received expressions: null
[AudioTask] No expressions provided
```

## 文件修改列表
- ✅ `src/renderer/src/services/websocket-handler.tsx` - 增强 actions 日志
- ✅ `src/renderer/src/hooks/utils/use-audio-task.ts` - 改进表情处理与日志
- ✅ `src/renderer/src/hooks/canvas/use-live2d-expression.ts` - 详细诊断日志
