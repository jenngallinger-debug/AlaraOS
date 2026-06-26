'use client';

import { useState } from 'react';
import type { EducationCard } from '../lib/education';

type DepthLevel = 'summary' | 'detail' | 'examples' | 'expert';

interface Props {
  card: EducationCard;
}

const DEPTH_ORDER: DepthLevel[] = ['summary', 'detail', 'examples', 'expert'];
const DEPTH_LABELS: Record<DepthLevel, string> = {
  summary: 'Overview',
  detail: 'More detail',
  examples: 'Examples',
  expert: 'Expert view',
};

export default function EducationCardComponent({ card }: Props) {
  const [depth, setDepth] = useState<DepthLevel>('summary');
  const [expanded, setExpanded] = useState(false);

  const currentIdx = DEPTH_ORDER.indexOf(depth);
  const hasMore = currentIdx < DEPTH_ORDER.length - 1;

  return (
    <article className="ed-card">
      <button
        className="ed-card__header"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <div className="ed-card__header-inner">
          <h3 className="ed-card__title">{card.title}</h3>
          <p className="ed-card__tagline">{card.tagline}</p>
        </div>
        <span className="ed-card__toggle" aria-hidden="true">
          {expanded ? '−' : '+'}
        </span>
      </button>

      {expanded && (
        <div className="ed-card__body">
          {/* Depth tabs */}
          <div className="ed-card__tabs" role="tablist">
            {DEPTH_ORDER.map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={depth === d}
                className={`ed-card__tab ${depth === d ? 'ed-card__tab--active' : ''}`}
                onClick={() => setDepth(d)}
              >
                {DEPTH_LABELS[d]}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="ed-card__content" role="tabpanel">
            {depth === 'summary' && (
              <p className="ed-card__text">{card.summary}</p>
            )}
            {depth === 'detail' && (
              <p className="ed-card__text">{card.detail}</p>
            )}
            {depth === 'examples' && (
              <ul className="ed-card__examples">
                {card.examples.map((ex, i) => (
                  <li key={i}>{ex}</li>
                ))}
              </ul>
            )}
            {depth === 'expert' && (
              <div className="ed-card__expert">
                <p className="ed-card__text">{card.expertNote}</p>
              </div>
            )}

            {/* Go deeper */}
            {hasMore && (
              <button
                className="ed-card__deeper"
                onClick={() => setDepth(DEPTH_ORDER[currentIdx + 1])}
              >
                {DEPTH_LABELS[DEPTH_ORDER[currentIdx + 1]]} →
              </button>
            )}
          </div>

          {/* Resources */}
          {card.resources.length > 0 && (
            <div className="ed-card__resources">
              {card.resources.map((r, i) => (
                r.url ? (
                  <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="ed-card__resource">
                    {r.label} ↗
                  </a>
                ) : (
                  <span key={i} className="ed-card__resource ed-card__resource--cta">
                    {r.label}
                  </span>
                )
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        .ed-card {
          background: white;
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          transition: box-shadow 0.2s;
        }
        .ed-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.06); }

        .ed-card__header {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 20px 24px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
        }
        .ed-card__header:hover .ed-card__title { color: var(--sage); }
        .ed-card__header-inner { flex: 1; }
        .ed-card__title {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 400;
          color: var(--text);
          margin-bottom: 4px;
          transition: color 0.2s;
        }
        .ed-card__tagline {
          font-size: 14px;
          color: var(--text-mid);
          line-height: 1.4;
        }
        .ed-card__toggle {
          font-size: 20px;
          color: var(--sage);
          flex-shrink: 0;
          width: 28px;
          text-align: center;
        }

        .ed-card__body {
          border-top: 1px solid var(--border);
          padding: 0 24px 20px;
          animation: fadeDown 0.25s ease both;
        }

        .ed-card__tabs {
          display: flex;
          gap: 0;
          padding: 16px 0 12px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .ed-card__tabs::-webkit-scrollbar { display: none; }
        .ed-card__tab {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-soft);
          background: none;
          border: none;
          padding: 4px 10px;
          cursor: pointer;
          border-radius: 20px;
          transition: color 0.15s, background 0.15s;
          white-space: nowrap;
          font-family: var(--font-body);
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .ed-card__tab--active {
          color: var(--sage);
          background: var(--sage-bg);
        }
        .ed-card__tab:not(.ed-card__tab--active):hover {
          color: var(--text-mid);
          background: var(--bg);
        }

        .ed-card__content { margin-bottom: 16px; }
        .ed-card__text {
          font-size: 15px;
          color: var(--text-mid);
          line-height: 1.65;
        }
        .ed-card__examples {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .ed-card__examples li {
          font-size: 14px;
          color: var(--text-mid);
          padding-left: 16px;
          border-left: 2px solid var(--sage-light);
          line-height: 1.5;
        }
        .ed-card__expert {
          background: var(--amber-bg);
          border-radius: 8px;
          padding: 14px 16px;
        }
        .ed-card__expert .ed-card__text {
          color: var(--text);
        }

        .ed-card__deeper {
          font-size: 13px;
          color: var(--sage);
          background: none;
          border: none;
          cursor: pointer;
          font-weight: 500;
          margin-top: 12px;
          padding: 0;
          font-family: var(--font-body);
          transition: opacity 0.15s;
        }
        .ed-card__deeper:hover { opacity: 0.7; }

        .ed-card__resources {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }
        .ed-card__resource {
          font-size: 13px;
          color: var(--sage);
          text-decoration: none;
          border: 1px solid var(--sage-light);
          border-radius: 20px;
          padding: 4px 12px;
          transition: background 0.15s;
          cursor: pointer;
        }
        a.ed-card__resource:hover { background: var(--sage-bg); }
        .ed-card__resource--cta {
          background: var(--sage);
          color: white;
          border-color: var(--sage);
        }

        @keyframes fadeDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </article>
  );
}
