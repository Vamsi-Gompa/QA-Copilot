import { useState, useCallback, useRef } from 'react';
import type { AgentEvent } from '../types';

export interface AgentStreamState {
  events: AgentEvent[];
  isStreaming: boolean;
  isComplete: boolean;
  error: string | null;
  generatedCount: number;
}

export function useAgentStream() {
  const [state, setState] = useState<AgentStreamState>({
    events: [],
    isStreaming: false,
    isComplete: false,
    error: null,
    generatedCount: 0,
  });
  const esRef = useRef<EventSource | null>(null);

  const start = useCallback((url: string) => {
    if (esRef.current) {
      esRef.current.close();
    }

    setState({ events: [], isStreaming: true, isComplete: false, error: null, generatedCount: 0 });

    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: AgentEvent = JSON.parse(e.data);
        setState(prev => {
          const newState = {
            ...prev,
            events: [...prev.events, event],
          };
          if (event.type === 'test_generated') {
            newState.generatedCount = prev.generatedCount + 1;
          }
          if (event.type === 'complete' || event.type === 'error') {
            newState.isStreaming = false;
            newState.isComplete = event.type === 'complete';
            if (event.type === 'error') newState.error = event.content;
            es.close();
          }
          return newState;
        });
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: 'Stream connection lost',
      }));
      es.close();
    };
  }, []);

  const stop = useCallback(() => {
    esRef.current?.close();
    setState(prev => ({ ...prev, isStreaming: false }));
  }, []);

  const reset = useCallback(() => {
    esRef.current?.close();
    setState({ events: [], isStreaming: false, isComplete: false, error: null, generatedCount: 0 });
  }, []);

  return { ...state, start, stop, reset };
}
