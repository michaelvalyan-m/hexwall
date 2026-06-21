import { useLayoutEffect, useRef } from 'react';
import type { LogLine } from '@tessera/shared';

interface LogLinesProps {
  lines: LogLine[];
  testid?: string;
  scroll?: boolean; // cap height with an internal scrollbar (don't grow the page)
  autoScroll?: boolean; // stick to the bottom as new lines stream in
}

// Render highlighted log lines: crit spans red, warn spans amber, plain default (UI_SPEC §4).
export function LogLines({ lines, testid, scroll, autoScroll }: LogLinesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    if (!autoScroll) return;
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    // "stuck to bottom" if the user is within a small threshold of the end
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
  }

  return (
    <div
      ref={ref}
      className={`logs${scroll ? ' logs-scroll' : ''}`}
      data-testid={testid}
      onScroll={scroll ? onScroll : undefined}
    >
      {lines.map((line, i) => (
        <div className="log-line" data-testid="log-line" key={i}>
          {line.spans.length === 0 ? (
            <span className="log-plain"> </span>
          ) : (
            line.spans.map((s, j) => (
              <span className={`log-${s.kind}`} data-kind={s.kind} key={j}>
                {s.text}
              </span>
            ))
          )}
        </div>
      ))}
      {lines.length === 0 && <span className="muted">no log lines</span>}
    </div>
  );
}
