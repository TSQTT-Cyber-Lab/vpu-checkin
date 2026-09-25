import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PHASE_LABEL, type Phase } from '@/lib/domain';

type Tone = 'ok' | 'bad' | 'warn' | 'info';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok border-ok/25',
  bad: 'bg-bad-soft text-bad border-bad/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  info: 'bg-secondary text-secondary-foreground border-primary/15',
};

export function Notice({ tone, title, children, className }: { tone: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cn('rounded-md border px-3.5 py-3 text-sm leading-relaxed', TONE[tone], className)}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cn(title && 'mt-0.5 opacity-90')}>{children}</div>}
    </div>
  );
}

export function PhasePill({ phase }: { phase: Phase }) {
  const cls = phase === 'open' ? 'bg-bad-soft text-bad' : phase === 'upcoming' ? 'bg-ok-soft text-ok' : 'bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', cls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current', phase === 'open' && 'animate-pulse')} />
      {PHASE_LABEL[phase]}
    </span>
  );
}

/** One line of the three-part eligibility checklist. */
export function CheckLine({ state, label, detail }: { state: 'pass' | 'fail' | 'wait' | 'idle'; label: string; detail?: ReactNode }) {
  const mark = { pass: '✓', fail: '✕', wait: '…', idle: '○' }[state];
  const color = { pass: 'text-ok bg-ok-soft', fail: 'text-bad bg-bad-soft', wait: 'text-warn bg-warn-soft', idle: 'text-muted-foreground bg-muted' }[state];
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span aria-hidden className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold', color)}>{mark}</span>
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {detail && <div className="text-[13px] text-muted-foreground break-words">{detail}</div>}
      </div>
    </li>
  );
}
