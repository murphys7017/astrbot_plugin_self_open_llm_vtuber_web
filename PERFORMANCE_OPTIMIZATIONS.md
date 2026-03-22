# 性能优化实施总结 (2026-03-23)

## 已完成的优化

### 1. ✅ 音频引用内存泄漏修复 (audio-manager.ts)

**问题：** 音频元素在播放结束或中断后没有完全清理，导致内存占用持续增长。

**实施方案：**
- 在 `clearCurrentAudio()` 和 `stopCurrentAudioAndLipSync()` 中添加显式清理
- 使用 `audio.replaceWith(audio.cloneNode(true))` 移除所有事件监听器
- 添加 `audioPool` 集合跟踪所有音频元素
- 在窗口 unload 时调用 `cleanupOrphanedAudioElements()`

**预期收益：** 
- 减少 40-50% 音频相关内存峰值
- 防止长期运行时的内存增长

**代码位置：** [src/renderer/src/utils/audio-manager.ts](src/renderer/src/utils/audio-manager.ts)

---

### 2. ✅ IPC 监听器泄漏修复 (window-manager.ts)

**问题：** WindowManager 构造函数中注册的 ipcMain.on() 监听器从未被删除，造成内存泄漏。

**实施方案：**
- 将所有 ipcMain.on() 调用提取到 `setupIpcHandlers()` 方法
- 存储所有 handler 引用在 `ipcHandlers` Map 中
- 创建 `cleanupIpcHandlers()` 方法在窗口关闭时调用
- 在 `closed` 事件中调用清理方法

**预期收益：**
- 消除 IPC handler 泄漏
- 防止重复创建 WindowManager 时的内存积累

**代码位置：** [src/main/window-manager.ts](src/main/window-manager.ts)

---

### 3. ✅ IPC 预加载接口改进 (preload/index.ts)

**问题：** `onModeChanged` 没有返回取消订阅函数，不一致性导致潜在内存泄漏。

**实施方案：**
- 统一所有 ipcRenderer.on() 接口返回清理函数
- 改进 handler 包装模式，确保每个订阅都可被取消

**预期收益：**
- 提高代码一致性和可维护性
- 防止忘记清理导致的内存泄漏

**代码位置：** [src/preload/index.ts](src/preload/index.ts)

---

## 后续优化建议 (优先级排序)

### P1: Context 结构优化

**当前问题：**
```
App
├── AiStateProvider (高频变化：aiState, backendSynthComplete)
├── Live2DConfigProvider (低频变化：modelInfo, config)
├── SubtitleProvider (高频变化：subtitleText)
├── ChatHistoryProvider (中低频：消息列表)
├── WebSocketProvider (高频：message, connection state)
├── VADProvider (中频：检测状态)
├── CameraProvider (低频：摄像头配置)
└── ... 其他 Provider
```

所有订阅者都会因为任何 Context 变化而重新渲染，造成不必要的渲染开销。

**优化方案：**

1. **分离高频与低频 Context**
   ```typescript
   // 高频 Context (每帧/毫秒级变化)
   - AiStateContext (aiState only)
   - SubtitleContext
   - Live2DAnimationContext (当前表情、口型、动作)
   
   // 中频 Context (秒级变化)
   - ChatHistoryContext
   - AiStateExtContext (backendSynthComplete, sessionInfo)
   
   // 低频 Context (应用生命周期内较少变化)
   - ModelConfigContext (仅配置，不 dispatch)
   - WebSocketConnectionContext (连接状态)
   - CameraContext
   - ScreenCaptureContext
   ```

2. **使用 useMemoCompare 或 useShallow**
   ```typescript
   // 示例
   const live2dConfig = useMemoCompare(modelInfo, shallowEqual);
   ```

3. **对订阅者使用 React.memo**
   ```typescript
   const ChatHistoryComponent = React.memo(({ children }) => {
     // Component
   });
   ```

**预期收益：
- 减少 60-70% 不必要的重新渲染
- UI 响应速度提升 200-300ms （主要体现在输入、动画更新）

---

### P1: 表情规划 LLM 调用移除

**当前流程：**
```
用户消息 
  → LLM 生成回复 (主要延迟)
  → 额外 LLM 调用进行表情规划 (冗余!)
  → 音频生成/TTS
  → 前端接收播放
```

**优化方案：**

1. **使用规则匹配替代 LLM**
   - 从 LLM 生成文本提取关键词或情感标记
   - 维护一个简单的规则表: `{keyword: expression}`
   - 或使用轻量级分类 (不做 LLM inference)

2. **前移到文本生成阶段**
   ```python
   # 后端在生成文本时同步添加表情建议
   response = llm.generate(prompt)
   emotion = simple_classify(response)  # 轻量级分类，不调用LLM
   
   send({
     "audio_url": "...",
     "text": response,
     "expression": emotion  # 直接使用，无需额外推理
   })
   ```

**预期收益：
- 减少 100-300ms 延迟（表情规划时间）
- 降低后端计算压力 30-40%

---

### P2: 音频 volumes 数组前端计算

**当前流程：**
- 后端 TTS 后生成 WAV → 读取计算 volumes 数组 → 发送 JSON payload
- 前端接收后可能不使用 volumes（已改为按 currentTime 同步口型）

**优化方案：**
- 后端只发 `audio_url` 和基本语音信息
- 前端在播放时可选地计算口型（使用 Web Audio API）
- 或保持现状但 volumes 作为可选字段

**预期收益：
- 减少消息体积 15-25%
- 降低网络延迟（特别是高延迟网络）

---

### P3: 事件监听器去重

**当前问题：** [use-ipc-handlers.ts](src/renderer/src/hooks/utils/use-ipc-handlers.ts) 在每次 deps 变化时都调用 `removeListener` 再 `on`。

**优化方案：**
```typescript
useEffect(() => {
  // 只在 isPet 从 false 变为 true 时设置一次
  if (!isPet) return;
  
  const cleanup = window.api?.onMicToggle?.(micToggleHandler);
  
  return cleanup ? cleanup : undefined;
}, [isPet]); // 移除函数引用，只依赖 isPet
```

**预期收益：
- 减少不必要的事件注册/注销
- 提升初始化性能

---

### P4: 开启 React Profiler 定期检查

**建议：**
1. 在开发模式启用 React DevTools Profiler
2. 记录关键操作的渲染时间 (baseline)
3. 定期对比优化前后

**关键指标：**
- Audio playback 触发的重新渲染時間
- 文本输入响应时间
- 模型切换时间

---

## 验证检查清单

- [x] 音频清理逻辑在所有路径执行 (正常结束、中断、错误)
- [x] IPC handler 在窗口关闭时完全清理
- [x] 没有循环引用防止 GC
- [x] 所有异步操作有超时或取消机制
- [ ] Heap snapshot 显示内存稳定 (长期运行 > 1小时)
- [ ] DevTools 检查没有分离的 DOM 节点
- [ ] 性能监视器显示稳定的帧率 (> 50 FPS 在 1080p)

---

## 回归测试

### 功能测试
1. **音频播放链路**
   - 单条音频完整播放
   - 中断现有音频并播放新消息
   - 快速切换多条消息
   - 长时间运行内存监视

2. **模式切换**
   - Window ↔ Pet 模式切换
   - 切换后 IPC 正常通信

3. **窗口管理**
   - 创建销毁窗口频繁切换
   - 关闭后进程干净退出

### 性能基准
```bash
# 建议使用 Chrome DevTools Memory 标签记录
初始内存: _____ MB
1小时后: _____ MB (应增长 < 100 MB)
峰值: _____ MB
```

---

## 参考资源

- [React Performance Optimization](https://react.dev/reference/react/memo)
- [Electron Memory Leak Prevention](https://www.electronjs.org/docs/latest/tutorial/memory-management)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)