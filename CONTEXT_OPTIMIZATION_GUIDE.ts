/**
 * Context Optimization Strategy
 * 
 * Current Issue: All high-frequency state changes trigger full tree re-renders
 * Solution: Split contexts by update frequency and dependency patterns
 */

// ============================================================================
// CURRENT PROBLEM (DO NOT USE)
// ============================================================================
/*
// App.tsx - ALL children re-render when ANY context changes
<AiStateProvider>
  <Live2DConfigProvider>
    <SubtitleProvider>
      <ChatHistoryProvider>
        <WebSocketProvider>
          <VADProvider>
            {children}
          </VADProvider>
        </WebSocketProvider>
      </ChatHistoryProvider>
    </SubtitleProvider>
  </Live2DConfigProvider>
</AiStateProvider>

// Problem:
// - Audio.currentTime changes 60fps → ALL subscribers re-render 60fps
// - Each re-render cycles through all Context.Provider components
// - Memoization breaks because context value changes every frame
*/

// ============================================================================
// OPTIMIZED SOLUTION - Split by Frequency & Dependencies
// ============================================================================

// HIGH FREQUENCY (Updates every frame/100ms)
// ============================================================================
/**
 * Ultra-high frequency: AI conversation state
 * Updates: aiState changes (multiple times per conversation turn)
 * Cost: Minimal (enum-like values)
 * Subscribers: Footer, Sidebar, Canvas components
 */
interface AiStateContextType {
  aiState: 'idle' | 'thinking-speaking' | 'interrupted' | 'loading' | 'listening' | 'waiting';
  setAiState: (state: AiState | ((prev: AiState) => AiState)) => void;
}

/**
 * High frequency: Subtitle and playback display
 * Updates: Every audio playback start/stop, multiple times per message
 * Cost: String updates (relatively cheap)
 * Subscribers: Subtitle component, UI state indicators
 */
interface SubtitleContextType {
  subtitleText: string;
  setSubtitleText: (text: string) => void;
  showSubtitle: boolean;
  setShowSubtitle: (show: boolean) => void;
}

/**
 * Medium-high frequency: Socket connectivity
 * Updates: When socket connects/disconnects, message batch sent
 * Cost: Enum + metadata
 * Subscribers: Connection indicator, error boundaries
 */
interface WebSocketConnectionContextType {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  lastUpdateTime: number;
}

// ============================================================================
// MEDIUM FREQUENCY (Updates per conversation turn)
// ============================================================================
/**
 * Medium frequency: Chat history and current session
 * Updates: When new message arrives or history cleared
 * Cost: Full array updates (expensive, but infrequent)
 * Subscribers: ChatHistory panel, conversation display
 */
interface ChatHistoryContextType {
  messages: Message[];
  fullResponse: string;
  appendResponse: (text: string) => void;
  appendAIMessage: (text: string, name: string, avatar?: string) => void;
  clearHistory: () => void;
}

/**
 * Medium frequency: VAD/microphone state
 * Updates: When mic state changes, VAD detects speech
 * Cost: Boolean + metadata
 * Subscribers: Mic button, audio input indicator
 */
interface VADContextType {
  isMicOn: boolean;
  isListening: boolean;
  setMicOn: (on: boolean) => void;
  setListening: (listening: boolean) => void;
}

/**
 * Medium frequency: Backend synthesis state 
 * Updates: When backend finishes generating response
 * Cost: Boolean
 * Subscribers: Audio playback orchestrator
 */
interface BackendSynthContextType {
  backendSynthComplete: boolean;
  setBackendSynthComplete: (complete: boolean) => void;
}

// ============================================================================
// LOW FREQUENCY (Updates only on configuration change)
// ============================================================================
/**
 * Low frequency: Live2D model configuration (IMMUTABLE READ)
 * Updates: When model changes, happens rarely
 * Cost: Large object (but rarely changes)
 * Subscribers: All components using model info
 * KEY: DO NOT include any setter - this should be a purely read context
 */
interface Live2DConfigContextType {
  modelInfo: ModelConfigInfo | null;
  // NO setModelInfo() here - use a separate action context
}

/**
 * Low frequency: Static configuration and initialization
 * Updates: Once at app startup, never changes
 * Cost: One-time setup
 * Subscribers: Any component that needs app-level config
 */
interface AppConfigContextType {
  websocketUrl: string;
  apiTimeouts: { asr: number; tts: number };
  isElectron: boolean;
  platform: 'web' | 'electron';
}

/**
 * Low frequency: Camera/screen capture configuration
 * Updates: Only when user explicitly changes settings
 * Cost: Metadata objects
 * Subscribers: Capture-related components
 */
interface CaptureContextType {
  cameraEnabled: boolean;
  screenCaptureEnabled: boolean;
  setCameraEnabled: (enabled: boolean) => void;
  setScreenCaptureEnabled: (enabled: boolean) => void;
}

// ============================================================================
// OPTIMIZED PROVIDER STRUCTURE
// ============================================================================

/*
RECOMMENDED App.tsx structure after optimization:

function App() {
  return (
    // Initialization contexts (once at startup)
    <AppConfigProvider>
      {/* Static model configuration */}
      <Live2DConfigProvider>
        
        {/* Container for high-frequency states that update together */}
        <PlaybackStateProvider>
          {/* Contains: aiState, subtitleText, playbackStatus */}
          
          {/* Container for connection state */}
          <ConnectionStateProvider>
            {/* Contains: isConnected, error state */}
            
            <ChatHistoryProvider>
              <VADProvider>
                <CaptureContextProvider>
                  <AppContent />
                </CaptureContextProvider>
              </VADProvider>
            </ChatHistoryProvider>
          </ConnectionStateProvider>
        </PlaybackStateProvider>
      </Live2DConfigProvider>
    </AppConfigProvider>
  );
}

CRITICAL OPTIMIZATION PATTERNS:

1. Constants-only providers (wrap in React.memo)
   ```typescript
   export const AppConfigProvider = React.memo(({ children }) => (
     <AppConfigContext.Provider value={config}>
       {children}
     </AppConfigContext.Provider>
   ));
   ```

2. Dispatch-only actions (separate from state)
   ```typescript
   // Instead of:
   <AIStateContext value={{ aiState, setAiState }} />
   
   // Use:
   <AIStateContext value={{ aiState }} />
   <AIDispatchContext value={{ setAiState }} /> // Only <Header /> subscribes
   
   // Why: <Canvas /> doesn't care about setAiState
   ```

3. Memoize subscribers
   ```typescript
   const AudioPlayback = React.memo(() => {
     const { subtitleText } = useSubtitle(); // Subscribed
     return <div>{subtitleText}</div>;
   }, (prevProps, nextProps) => {
     // Custom comparison if needed
     return prevProps === nextProps;
   });
   ```

4. Use useTransition for heavy updates
   ```typescript
   const [isPending, startTransition] = useTransition();
   
   const handleLargeUpdate = (data) => {
     startTransition(() => {
       setChatHistory([...messages, data]); // Low priority
     });
   };
   ```
*/

// ============================================================================
// MIGRATION CHECKLIST
// ============================================================================

export const CONTEXT_OPTIMIZATION_CHECKLIST = `
Performance Optimization Checklist for Context API

[ ] Phase 1: Measure Current State
    [ ] Profile with React DevTools - record baseline render times
    [ ] Check node module dependencies in each Context
    [ ] List all components subscribing to each Context
    [ ] Identify high-frequency state changes

[ ] Phase 2: Separate High/Low Frequency
    [ ] Extract aiState to separate context from config
    [ ] Separate subtitle display from chat history
    [ ] Create WebSocketConnectionContext (connection only)
    [ ] Mark Live2DConfigProvider as @immutable

[ ] Phase 3: Implement Optimizations
    [ ] Add React.memo to low-frequency providers
    [ ] Use useMemoCompare for complex objects in context value
    [ ] Create dispatch-only contexts for setters
    [ ] Add useTransition for bulk updates

[ ] Phase 4: Component-Level Optimization
    [ ] Wrap display components with React.memo()
    [ ] Use custom hook for selective subscription (cherry-pick parts of context)
    [ ] Verify memoization with React DevTools "Highlight updates"

[ ] Phase 5: Verify Performance
    [ ] Re-profile with React DevTools - compare with baseline
    [ ] Test long conversation (100+ messages) for memory growth
    [ ] Check frame rate during playback (target: 55+ FPS)
    [ ] Monitor GC pause times

Example: Custom Hook for Selective Subscription
------------------------------------------
// Instead of getting entire context:
const { aiState, subtitle, history } = useAppState(); // Re-renders on ANY change

// Use selective subscription:
export function useAiStateOnly() {
  const { aiState } = useContext(AiStateContext);
  return aiState; // Only re-renders when aiState changes
}

// In component:
const Button = React.memo(() => {
  const aiState = useAiStateOnly(); // Not subtitle, not history
  return <button>{aiState}</button>; // Only re-renders for aiState changes
});
`;

export default CONTEXT_OPTIMIZATION_CHECKLIST;
