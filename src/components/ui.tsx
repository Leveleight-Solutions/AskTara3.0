import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X, Heart, ArrowUpRight, ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../context';
import type { Destination, Experience, Stay } from '../../shared/types';
import { money } from '../api';
export function TaraMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M24 3C26.6 15.2 32.8 21.4 45 24C32.8 26.6 26.6 32.8 24 45C21.4 32.8 15.2 26.6 3 24C15.2 21.4 21.4 15.2 24 3Z"
        fill="currentColor"
      />
      <path
        d="M39 2C39.6 5.3 41.7 7.4 45 8C41.7 8.6 39.6 10.7 39 14C38.4 10.7 36.3 8.6 33 8C36.3 7.4 38.4 5.3 39 2Z"
        fill="currentColor"
      />
    </svg>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useLayoutEffect(() => {
    const el = dialog.current!;
    const opener = document.activeElement;
    el.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      closeHandler.current();
    };
    el.addEventListener('cancel', cancel);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      el.removeEventListener('cancel', cancel);
      el.close();
      document.body.style.overflow = previous;
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        !document.querySelector('dialog[open]')
      )
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function SaveButton({
  type,
  id,
  label,
}: {
  type: 'destination' | 'stay' | 'experience';
  id: string;
  label: string;
}) {
  const { isSaved, toggleSave } = useApp();
  const saved = isSaved(type, id);
  return (
    <button
      className={`save-button ${saved ? 'is-saved' : ''}`}
      aria-label={`${saved ? 'Unsave' : 'Save'} ${label}`}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggleSave(type, id);
      }}
    >
      <Heart size={17} fill={saved ? 'currentColor' : 'none'} strokeWidth={1.7} />
    </button>
  );
}
export function DestinationCard({ destination: d }: { destination: Destination }) {
  return (
    <article className="destination-card">
      <Link to={`/destinations/${d.id}`} className="card-photo">
        <img src={d.image} alt={`${d.name}, ${d.country}`} loading="lazy" />
        <span className="photo-vibe">{d.tags[0]}</span>
        <span className="photo-arrow">
          <ArrowUpRight size={19} />
        </span>
      </Link>
      <SaveButton type="destination" id={d.id} label={d.name} />
      <div className="destination-card-text">
        <span className="eyebrow">{d.country}</span>
        <Link to={`/destinations/${d.id}`}>
          <h3>{d.name}</h3>
        </Link>
        <p>{d.description}</p>
      </div>
    </article>
  );
}
export function StayCard({ stay: s, onSelect }: { stay: Stay; onSelect: () => void }) {
  const { catalog } = useApp();
  return (
    <article className="stay-card">
      <button className="card-photo" onClick={onSelect} aria-label={`View ${s.name}`}>
        <img src={s.image} alt={s.name} loading="lazy" />
        <span className="photo-vibe">{s.style}</span>
      </button>
      <SaveButton type="stay" id={s.id} label={s.name} />
      <span className="eyebrow">
        {catalog.destinations.find((d) => d.id === s.destinationId)?.name}
      </span>
      <button className="plain-button card-title" onClick={onSelect}>
        {s.name}
      </button>
      <p>{s.description}</p>
      <div className="price-line">
        <span>
          From <strong>{money(s.price)}</strong>
          <span className="muted"> / night</span>
        </span>
        <span className="sample-label">Sample stay</span>
      </div>
    </article>
  );
}
export function ExperienceCard({
  experience: e,
  onSelect,
}: {
  experience: Experience;
  onSelect: () => void;
}) {
  const { catalog } = useApp();
  return (
    <article className="experience-card">
      <button className="card-photo" onClick={onSelect} aria-label={`View ${e.name}`}>
        <img src={e.image} alt={e.name} loading="lazy" />
        <span className="photo-vibe">{e.category}</span>
      </button>
      <SaveButton type="experience" id={e.id} label={e.name} />
      <span className="eyebrow">
        {catalog.destinations.find((d) => d.id === e.destinationId)?.name} · {e.duration}
      </span>
      <button className="plain-button card-title" onClick={onSelect}>
        {e.name}
      </button>
      <div className="price-line">
        <span>
          Estimate <strong>{money(e.price)}</strong>
          <span className="muted"> / person</span>
        </span>
        <ArrowUpRight size={17} />
      </div>
    </article>
  );
}
export function EmptyState({
  title,
  description,
  action,
  to,
}: {
  title: string;
  description: string;
  action: string;
  to: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Sparkles size={28} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <Link className="button button-primary" to={to}>
        {action}
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
export function Spinner({ label = 'Finding a little inspiration…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="spinner" />
      <p>{label}</p>
    </div>
  );
}
