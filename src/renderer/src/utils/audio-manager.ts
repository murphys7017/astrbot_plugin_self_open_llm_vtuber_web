/**
 * Global audio manager for handling audio playback and interruption
 * This ensures all components share the same audio reference
 */
class AudioManager {
  private currentAudio: HTMLAudioElement | null = null;
  private currentModel: any | null = null;
  private currentStopHandler: (() => void) | null = null;
  private audioPool: Set<HTMLAudioElement> = new Set();

  /**
   * Set the current playing audio
   */
  setCurrentAudio(audio: HTMLAudioElement, model: any, onStop?: () => void) {
    this.currentAudio = audio;
    this.currentModel = model;
    this.currentStopHandler = onStop ?? null;
  }

  /**
   * Stop current audio playback and lip sync
   */
  stopCurrentAudioAndLipSync() {
    if (this.currentAudio) {
      console.log('[AudioManager] Stopping current audio and lip sync');
      const audio = this.currentAudio;
      
      // Stop audio playback with proper cleanup
      try {
        audio.pause();
        audio.src = '';
        audio.load();
        // Remove all event listeners to prevent memory leaks
        audio.replaceWith(audio.cloneNode(true));
      } catch (e) {
        console.warn('[AudioManager] Error cleaning up audio playback:', e);
      }

      // Stop Live2D lip sync
      const model = this.currentModel;
      if (model && model._wavFileHandler) {
        try {
          // Release PCM data to stop lip sync calculation in update()
          model._wavFileHandler.releasePcmData();
          console.log('[AudioManager] Called _wavFileHandler.releasePcmData()');

          model._wavFileHandler._syncAudioElement = null;

          // Additional reset of state variables as fallback
          model._wavFileHandler._lastRms = 0.0;
          model._wavFileHandler._sampleOffset = 0;
          model._wavFileHandler._userTimeSeconds = 0.0;
          console.log('[AudioManager] Also reset _lastRms, _sampleOffset, _userTimeSeconds as fallback');
        } catch (e) {
          console.error('[AudioManager] Error stopping/resetting wavFileHandler:', e);
        }
      } else if (model) {
        console.warn('[AudioManager] Current model does not have _wavFileHandler to stop/reset.');
      } else {
        console.log('[AudioManager] No associated model found to stop lip sync.');
      }

      const stopHandler = this.currentStopHandler;

      // Clear references before invoking stop handler so repeated cleanup is safe.
      this.currentAudio = null;
      this.currentModel = null;
      this.currentStopHandler = null;

      stopHandler?.();
    } else {
      console.log('[AudioManager] No current audio playing to stop.');
    }
  }

  /**
   * Clear the current audio reference (called when audio ends naturally)
   */
  clearCurrentAudio(audio: HTMLAudioElement) {
    if (this.currentAudio === audio) {
      // Proper cleanup of audio element
      try {
        audio.pause();
        audio.src = '';
        audio.load();
        // Remove all event listeners to prevent memory leaks
        audio.replaceWith(audio.cloneNode(true));
      } catch (e) {
        console.warn('[AudioManager] Error cleaning up audio element:', e);
      }

      if (this.currentModel?._wavFileHandler) {
        this.currentModel._wavFileHandler._syncAudioElement = null;
      }
      this.currentAudio = null;
      this.currentModel = null;
      this.currentStopHandler = null;
    }
  }

  /**
   * Check if there's currently playing audio
   */
  hasCurrentAudio(): boolean {
    return this.currentAudio !== null;
  }

  /**
   * Check whether the provided audio element is still the active one.
   */
  isCurrentAudio(audio: HTMLAudioElement): boolean {
    return this.currentAudio === audio;
  }

  /**
   * Cleanup abandoned audio elements to prevent memory leaks
   */
  cleanupOrphanedAudioElements() {
    for (const audio of this.audioPool) {
      if (this.currentAudio !== audio) {
        try {
          audio.pause();
          audio.src = '';
          audio.load();
          audio.replaceWith(audio.cloneNode(true));
        } catch (e) {
          console.warn('[AudioManager] Error cleaning orphaned audio:', e);
        }
      }
    }
    this.audioPool.clear();
  }
}

// Export singleton instance
export const audioManager = new AudioManager();

// Cleanup on window unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    audioManager.cleanupOrphanedAudioElements();
  });
}
