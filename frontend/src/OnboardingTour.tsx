import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Command, FolderKanban, NotebookPen, Sparkles, Users, X, Zap } from 'lucide-react';

const STEPS = [
  { icon: Sparkles, title: 'Welcome to Zynckle', body: 'Projects, documents, code, files and an AI that knows your workspace, in one place. This takes under a minute.', cta: null },
  { icon: FolderKanban, title: 'Start with a project', body: 'Projects hold tasks on a board, list, timeline or calendar. Create one, or load the starter workspace from the Overview to explore with real data.', cta: { label: 'Open Projects', to: '/projects' } },
  { icon: Command, title: 'Everything is one keystroke away', body: 'Press Ctrl K (⌘K on Mac) to jump anywhere, search everything, or ask the AI a question and get an answer from your own documents. Press ? to see every shortcut.', cta: null },
  { icon: Zap, title: 'Capture without breaking focus', body: 'Press C anywhere to add a task in plain words, like “Ship onboarding fri !high @ada”. Ctrl E opens a scratchpad for loose notes.', cta: null },
  { icon: NotebookPen, title: 'Let the AI do the busywork', body: 'Paste meeting notes into Zynckle AI → Meeting notes and approve the tasks it proposes. The Overview writes a daily brief and a weekly team report.', cta: { label: 'Try meeting notes', to: '/ai?mode=meeting' } },
  { icon: Users, title: 'Bring your team', body: 'Invite teammates from Team. Documents co-edit live, and changes appear for everyone instantly.', cta: { label: 'Invite people', to: '/team' } },
];

/** First-run tour: a short, skippable sequence of cards. Shown once per account in this browser. */
export default function OnboardingTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const last = step === STEPS.length - 1;
  const { icon: Icon, title, body, cta } = STEPS[step];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => { primary.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && !last) setStep(s => s + 1);
      else if (e.key === 'ArrowLeft' && step > 0) setStep(s => s - 1);
      else if (e.key === 'Tab' && dialog.current) {
        // Keep focus inside the dialog.
        const items = [...dialog.current.querySelectorAll<HTMLElement>('button')];
        const first = items[0], end = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
        else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, step, onClose]);

  return <div className="modal-backdrop zy-tour-backdrop">
    <div className="modal zy-tour" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <button className="icon-button zy-tour-close" onClick={onClose} aria-label="Skip the tour"><X size={16}/></button>
      <span className="zy-tour-icon" aria-hidden="true"><Icon size={22}/></span>
      <div className="eyebrow">STEP {step + 1} OF {STEPS.length}</div>
      <h2 id="tour-title">{title}</h2>
      <p id="tour-body">{body}</p>
      {cta && <button className="text-button zy-tour-cta" onClick={() => { onClose(); navigate(cta.to); }}>{cta.label} <ArrowRight size={13}/></button>}
      <div className="zy-tour-dots" aria-hidden="true">{STEPS.map((_, i) => <i key={i} className={i === step ? 'active' : ''}/>)}</div>
      <div className="modal-actions">
        {step > 0 ? <button className="button-secondary" onClick={() => setStep(s => s - 1)}><ArrowLeft size={14}/> Back</button> : <button className="button-secondary" onClick={onClose}>Skip tour</button>}
        <button ref={primary} className="button-primary" onClick={() => last ? onClose() : setStep(s => s + 1)}>{last ? 'Get started' : <>Next <ArrowRight size={14}/></>}</button>
      </div>
    </div>
  </div>;
}
