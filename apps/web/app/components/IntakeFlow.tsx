'use client';

import { useState, useRef, useEffect } from 'react';
import { startConversation } from '../lib/api-client';
import type { ConversationResult } from '../lib/api-client';

// ─── Visitor type inference ───────────────────────────────────────────────────

const VISITOR_HINTS: { keywords: string[]; type: string; programHint?: string }[] = [
  { keywords: ['eeoicpa', 'white card', 'doe', 'department of energy', 'hanford', 'nuclear', 'uranium'], type: 'eeoicpa_beneficiary', programHint: 'EEOICPA' },
  { keywords: ['va', 'veteran', 'veterans', 'military', 'served', 'service'], type: 'veteran', programHint: 'VA' },
  { keywords: ['owcp', 'federal worker', 'postal', 'feca', 'workers comp'], type: 'federal_worker', programHint: 'OWCP' },
  { keywords: ['doctor', 'physician', 'referring', 'patient of mine', 'my patient', 'discharge', 'referral'], type: 'physician' },
  { keywords: ['my mom', 'my dad', 'my father', 'my mother', 'my husband', 'my wife', 'my parent', 'caring for', 'caregiver'], type: 'family_caregiver' },
  { keywords: ['case manager', 'social worker', 'discharge planner', 'coordinator'], type: 'case_manager' },
  { keywords: ['attorney', 'lawyer', 'legal', 'representation'], type: 'attorney' },
];

function inferVisitorType(text: string): { type: string; programHint?: string } {
  const lower = text.toLowerCase();
  for (const hint of VISITOR_HINTS) {
    if (hint.keywords.some(k => lower.includes(k))) {
      return { type: hint.type, programHint: hint.programHint };
    }
  }
  return { type: 'general' };
}

// ─── Follow-up prompts based on inferred context ─────────────────────────────

function getFollowUpQuestion(text: string, visitorType: string): string | null {
  const lower = text.toLowerCase();
  if (lower.length < 20) return 'Can you tell us a little more about the situation?';
  if (!lower.match(/\b(i|my|we|he|she|they)\b/)) return null;
  if (visitorType === 'eeoicpa_beneficiary' && !lower.includes('name'))
    return "What's your name so we can get a Care Guide ready for your call?";
  if (visitorType === 'family_caregiver' && !lower.includes('name'))
    return "And your name — so our team knows who to expect when they call?";
  if (visitorType === 'physician' || visitorType === 'case_manager')
    return "What's the best number to reach you for follow-up?";
  if (!lower.match(/\bname\b|\bi('m| am)\b/))
    return "What's your name? It helps our team know who's reaching out.";
  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'idle' | 'typing' | 'followup' | 'collecting_name' | 'collecting_phone' | 'submitting' | 'confirmed';

interface Message {
  role: 'user' | 'alara';
  text: string;
  id: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function IntakeFlow() {
  const [step, setStep] = useState<Step>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitorType, setVisitorType] = useState('general');
  const [programHint, setProgramHint] = useState<string | undefined>();
  const [result, setResult] = useState<ConversationResult | null>(null);
  const [msgCounter, setMsgCounter] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function addMessage(role: 'user' | 'alara', text: string) {
    setMsgCounter(c => {
      const id = c + 1;
      setMessages(m => [...m, { role, text, id }]);
      return id;
    });
  }

  async function handleInitialSubmit(text: string) {
    if (!text.trim()) return;
    setInitialMessage(text);
    addMessage('user', text);
    setInput('');
    setStep('typing');

    const inferred = inferVisitorType(text);
    setVisitorType(inferred.type);
    if (inferred.programHint) setProgramHint(inferred.programHint);

    await new Promise(r => setTimeout(r, 700));

    const followUp = getFollowUpQuestion(text, inferred.type);
    if (followUp) {
      addMessage('alara', followUp);
      setStep('followup');
    } else {
      addMessage('alara', "What's your name so our team knows who to expect?");
      setStep('collecting_name');
    }
  }

  async function handleFollowUp(text: string) {
    addMessage('user', text);
    setInput('');
    setStep('typing');
    await new Promise(r => setTimeout(r, 500));
    addMessage('alara', "Thank you. What's your name?");
    setStep('collecting_name');
  }

  async function handleName(text: string) {
    const name = text.trim();
    setVisitorName(name);
    addMessage('user', name);
    setInput('');
    setStep('typing');
    await new Promise(r => setTimeout(r, 500));
    addMessage('alara', `${name.split(' ')[0]}, what's the best number to reach you?`);
    setStep('collecting_phone');
  }

  async function handlePhone(text: string) {
    setVisitorPhone(text.trim());
    addMessage('user', text);
    setInput('');
    setStep('submitting');

    addMessage('alara', "Give us just a moment while we get everything ready for your Care Guide…");

    const res = await startConversation({
      message: initialMessage,
      visitorType,
      phone: text.trim(),
      name: visitorName,
      programHint,
    });

    setResult(res);
    setStep('confirmed');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSubmit() {
    const text = input.trim();
    if (!text) return;
    switch (step) {
      case 'idle': handleInitialSubmit(text); break;
      case 'followup': handleFollowUp(text); break;
      case 'collecting_name': handleName(text); break;
      case 'collecting_phone': handlePhone(text); break;
    }
  }

  const isActive = !['submitting', 'confirmed'].includes(step);
  const placeholder =
    step === 'collecting_name' ? 'Your name…' :
    step === 'collecting_phone' ? 'Phone number…' :
    step === 'followup' ? 'Tell us more…' :
    "Tell us what's going on…";

  return (
    <div className="intake-flow">
      {/* Message thread */}
      {messages.length > 0 && (
        <div className="intake-messages" role="log" aria-live="polite">
          {messages.map(m => (
            <div key={m.id} className={`intake-message intake-message--${m.role}`}>
              {m.role === 'alara' && (
                <span className="intake-avatar" aria-hidden="true">A</span>
              )}
              <p>{m.text}</p>
            </div>
          ))}
          {step === 'submitting' && (
            <div className="intake-message intake-message--alara">
              <span className="intake-avatar" aria-hidden="true">A</span>
              <p className="intake-typing"><span /><span /><span /></p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Confirmed state */}
      {step === 'confirmed' && result && (
        <div className="intake-confirmed">
          <div className="intake-confirmed__check" aria-hidden="true">✓</div>
          <h3>Someone is already on it.</h3>
          <p className="intake-confirmed__message">{result.confirmationMessage}</p>
          <div className="intake-confirmed__steps">
            {result.nextSteps.map((s, i) => (
              <div key={i} className="intake-confirmed__step">
                <span>{i + 1}</span>
                <p>{s}</p>
              </div>
            ))}
          </div>
          <div className="intake-confirmed__meta">
            <p>Owned by <strong>{result.ownerLabel}</strong></p>
            <p>Expected contact: <strong>{result.expectedContactWindow}</strong></p>
            <p className="intake-confirmed__ref">Reference: {result.referenceId}</p>
          </div>
          <a href="tel:+1-800-ALARA-00" className="intake-confirmed__call">
            Want to talk now? Call us
          </a>
        </div>
      )}

      {/* Input */}
      {isActive && (
        <div className={`intake-input-wrap ${messages.length > 0 ? 'intake-input-wrap--thread' : ''}`}>
          <textarea
            ref={inputRef}
            className="intake-input"
            placeholder={placeholder}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={step === 'idle' ? 3 : 2}
            aria-label={placeholder}
            disabled={step === 'submitting'}
          />
          <button
            className="intake-submit"
            onClick={handleSubmit}
            disabled={!input.trim() || step === 'submitting'}
            aria-label="Send"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}

      <style>{`
        .intake-flow {
          width: 100%;
          max-width: 640px;
          margin: 0 auto;
        }
        .intake-messages {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-bottom: 20px;
        }
        .intake-message {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          animation: fadeUp 0.3s ease both;
        }
        .intake-message--user {
          flex-direction: row-reverse;
        }
        .intake-message--user p {
          background: var(--sage);
          color: white;
          border-radius: 18px 18px 4px 18px;
          padding: 10px 16px;
          font-size: 15px;
          max-width: 80%;
        }
        .intake-message--alara p {
          background: white;
          border: 1px solid var(--border);
          border-radius: 18px 18px 18px 4px;
          padding: 10px 16px;
          font-size: 15px;
          max-width: 80%;
          color: var(--text);
        }
        .intake-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--sage);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 500;
          flex-shrink: 0;
          font-family: var(--font-body);
        }
        .intake-typing {
          display: flex !important;
          gap: 4px;
          align-items: center;
          padding: 14px 16px !important;
        }
        .intake-typing span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-soft);
          animation: bounce 1.2s infinite;
          display: block;
        }
        .intake-typing span:nth-child(2) { animation-delay: 0.2s; }
        .intake-typing span:nth-child(3) { animation-delay: 0.4s; }

        .intake-input-wrap {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          background: white;
          border: 1.5px solid var(--border);
          border-radius: 16px;
          padding: 12px;
          transition: border-color 0.2s;
        }
        .intake-input-wrap:focus-within {
          border-color: var(--sage);
        }
        .intake-input-wrap--thread {
          border-radius: 12px;
        }
        .intake-input {
          flex: 1;
          border: none;
          outline: none;
          resize: none;
          font-family: var(--font-body);
          font-size: 15px;
          color: var(--text);
          background: transparent;
          line-height: 1.5;
        }
        .intake-input::placeholder { color: var(--text-soft); }
        .intake-submit {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--sage);
          color: white;
          border: none;
          cursor: pointer;
          font-size: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 0.2s, opacity 0.2s;
        }
        .intake-submit:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .intake-submit:not(:disabled):hover {
          background: var(--sage-light);
        }

        /* Confirmed state */
        .intake-confirmed {
          text-align: center;
          padding: 32px 24px;
          background: white;
          border: 1px solid var(--border);
          border-radius: 16px;
          animation: fadeUp 0.4s ease both;
        }
        .intake-confirmed__check {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: var(--sage-bg);
          color: var(--sage);
          font-size: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
        }
        .intake-confirmed h3 {
          font-family: var(--font-display);
          font-size: 22px;
          font-weight: 400;
          margin-bottom: 8px;
          color: var(--text);
        }
        .intake-confirmed__message {
          color: var(--text-mid);
          font-size: 15px;
          margin-bottom: 24px;
        }
        .intake-confirmed__steps {
          display: flex;
          flex-direction: column;
          gap: 12px;
          text-align: left;
          margin-bottom: 24px;
        }
        .intake-confirmed__step {
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .intake-confirmed__step span {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--sage-bg);
          color: var(--sage);
          font-size: 12px;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .intake-confirmed__step p {
          font-size: 14px;
          color: var(--text-mid);
          padding-top: 2px;
        }
        .intake-confirmed__meta {
          padding: 16px;
          background: var(--bg);
          border-radius: 8px;
          margin-bottom: 20px;
          font-size: 14px;
          color: var(--text-mid);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .intake-confirmed__ref {
          color: var(--text-soft);
          font-size: 12px;
          margin-top: 4px;
        }
        .intake-confirmed__call {
          display: inline-block;
          color: var(--sage);
          font-size: 14px;
          font-weight: 500;
          text-decoration: none;
          border-bottom: 1px solid var(--sage);
          padding-bottom: 1px;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.7); }
          40%           { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
