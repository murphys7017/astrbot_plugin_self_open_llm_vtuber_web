# AstrBot Desktop Pet Frontend

这是一个基于原始 `Open LLM Vtuber Web` 前端改造的 Electron + React + TypeScript 项目，当前主要用于配合 AstrBot 插件运行 Live2D 桌宠。

和原项目相比，是围绕 AstrBot 本地桌宠场景做了协议、播放链路、Live2D 行为和调试流程的定制化改造。

## 当前项目定位

- 前端仓库：[murphys7017/astrbot_plugin_self_open_llm_vtuber_web: The Web/Electron frontend for Open-LLM-VTuber Project](https://github.com/murphys7017/astrbot_plugin_self_open_llm_vtuber_web)
- 对应后端插件仓库：[murphys7017/astrbot_plugin_self_open_llm_vtuber](https://github.com/murphys7017/astrbot_plugin_self_open_llm_vtuber)
- 主要运行方式：前端使用 `npm run dev`，后端由 AstrBot 插件提供 WebSocket 与静态资源服务

## 相比原项目的主要改动

### 1. 接入 AstrBot 自定义协议

原项目更多是面向自身的一套前后端交互方式；当前项目已经改为围绕 AstrBot 插件通信：

- 使用插件提供的 WebSocket 服务收发消息
- 使用插件提供的静态资源服务加载 `live2ds`、背景、头像、缓存音频
- 支持 `set-model-and-conf`、`audio`、`control`、`backend-synth-complete`、`force-new-message` 等消息类型
- `model_info` 改为由后端插件动态下发，而不是前端写死

### 2. 音频传输从 base64 改为 `audio_url`

原来的整段 base64 音频传输方案已经替换为 URL 播放方案：

- 后端不再向前端发送整段 `audio` base64
- 改为发送 `audio_url`
- 前端直接通过 `new Audio(audioUrl)` 播放
- 音频缓存文件由后端落到静态目录，前端通过 HTTP 访问

这次改造的目标是减少消息体积、降低前端解码负担，并让播放链路更接近真实浏览器音频行为。

### 3. 重做了音频、字幕、口型、表情的同步链路

这是当前项目相对原项目最重要的一组改动。

已做的同步优化包括：

- 字幕不再在收到消息瞬间显示，而是在真实播放开始时显示
- 字幕会在音频自然结束或播放报错时清空
- 表情会在真实播放开始时应用，结束后恢复默认表情
- 口型不再简单按独立时间轴推进，而是尽量跟随 `audio.currentTime`
- 前端不再等待整段音频完全缓冲后才开始播放
- 收到 `audio_url` 后会尽快请求播放，口型数据异步追上
- 修复了旧音频事件在新音频接管后仍然触发，导致串音、字幕错位、口型错位的问题

### 4. 新增了基础表情到 Live2D 表情文件的优先映射

当前前后端表情流程已经调整为：

- 优先使用 `expression_decision.base_expression`
- 再根据模型配置中的 `emotionMap` 解析出具体 `exp3.json`
- 只有在缺少 `base_expression` 时才回退到旧的 `expressions`

同时，表达方式也从“仅依赖索引”逐步转向“优先使用文件名或相对路径”，减少不同模型下索引错位的问题。

### 5. 新增了 motion3.json 动作支持

原项目主要关注表情和基础口型；当前项目额外支持后端直接驱动 Live2D 动作：

- 前端支持消费 `actions.motions`
- 支持通过动作文件名或相对路径匹配模型中的 `motion3.json`
- 音频播放时可触发指定 motion
- 无音频时也可单独触发 motion
- 当消息已经指定 motion 时，会避免默认 `Talk` 随机动作干扰

### 6. 支持按模型配置文件驱动表情和动作映射

当前项目把很多运行时差异放到了模型配置里，而不是硬编码在前端：

- `emotionMap`：基础情绪到表情文件的映射
- `motionMap`：基础情绪到动作文件的映射
- `tapMotions`：点击模型时的动作配置
- `idleMotionGroupName`：待机动作组配置

这让不同 Live2D 模型的兼容方式更稳定，也方便后端按统一语义发消息。

### 7. 增强了中断、连续回复和队列处理

围绕桌宠实际使用场景，做过一轮比较重的播放状态机调整：

- 新回复到达时会停止当前音频和口型
- 中断时会清理音频、字幕、表情和任务队列
- 连续两条语音不会继续复用旧音频实例
- 前端在一轮播放完成后会回发 `frontend-playback-complete`

### 8. 多媒体输入与工具状态展示继续保留并适配

在保留原项目已有交互能力的基础上，当前版本继续支持：

- 文本输入
- 摄像头截图和屏幕截图随消息一起上传
- 背景资源切换
- 历史记录列表与切换
- 工具调用状态展示

不过这些能力现在都是围绕 AstrBot 插件的消息协议运行，而不是原项目默认后端。

## 后端配套改动概览

虽然这个仓库是前端，但它依赖的后端插件也已经做了配套修改，主要包括：

- 音频消息从 base64 改为 `audio_url`
- 音频文件缓存到 `/cache/audio/`
- 增加缓存清理策略
- 根据 `base_expression` 生成 `actions.expressions`
- 根据 `motionMap` 生成 `actions.motions`
- `model_info` 从插件配置和 `live2ds/model_dict.json` 动态解析

如果只启动这个前端而没有同步修改 AstrBot 插件，很多能力不会正常工作。

## 开发方式

### 安装依赖

```bash
npm install
```

### 本地开发

```bash
npm run dev
```

说明：

- 你当前一直使用的就是这个命令
- 它只会启动前端 Electron 开发环境
- 如果修改了 AstrBot 插件 Python 代码，需要另外重启 AstrBot 或对应插件进程

### 构建

```bash
# 仅构建前端资源
npm run build

# Windows 安装包
npm run build:win

# macOS 安装包
npm run build:mac

# Linux 安装包
npm run build:linux
```

## 当前最关键的运行链路

可以把现在的桌宠主流程理解为：

1. AstrBot 插件向前端发送 `set-model-and-conf`
2. 前端根据 `model_info.url` 加载 Live2D 模型
3. 用户发消息后，后端插件处理文本、图片、语音和表情规划
4. 如果有语音，后端发送 `audio_url + display_text + actions`
5. 前端尽快开始播放音频
6. 播放开始时显示字幕并应用表情/动作
7. 播放过程中口型尽量跟随实际音频时间轴
8. 播放结束后清理字幕和表情，并通知后端本轮播放完成

## 目前建议重点关注的文件

- 前端播放主链路：
  [use-audio-task.ts](C:/Users/Administrator/Downloads/weather-query/astrbot_plugin_self_open_llm_vtuber_web/src/renderer/src/hooks/utils/use-audio-task.ts)
- WebSocket 消息分发：
  [websocket-handler.tsx](C:/Users/Administrator/Downloads/weather-query/astrbot_plugin_self_open_llm_vtuber_web/src/renderer/src/services/websocket-handler.tsx)
- WebSocket 消息类型：
  [websocket-service.tsx](C:/Users/Administrator/Downloads/weather-query/astrbot_plugin_self_open_llm_vtuber_web/src/renderer/src/services/websocket-service.tsx)
- 全局音频控制：
  [audio-manager.ts](C:/Users/Administrator/Downloads/weather-query/astrbot_plugin_self_open_llm_vtuber_web/src/renderer/src/utils/audio-manager.ts)
- 后端平台适配器：
  `C:\Users\Administrator\Downloads\AstrBot\data\plugins\astrbot_plugin_self_open_llm_vtuber\platform_adapter.py`
- 后端音频 payload 构造：
  `C:\Users\Administrator\Downloads\AstrBot\data\plugins\astrbot_plugin_self_open_llm_vtuber\adapter\payload_builder.py`

## 备注

这个项目现在已经明显偏离上游模板项目，后续如果继续迭代，建议把它当成一个 AstrBot 桌宠专用前端来维护，而不要再把 README、协议和运行方式按原始 `Open LLM Vtuber` 模板理解。
